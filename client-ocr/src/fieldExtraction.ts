import type { CommonFields, DocumentSide, IdType, OcrField, RecognizedTextLine, VariantFields } from "./types";
import {
  COMMON_FIELD_ALIASES,
  ID_TYPE_DETECTION_KEYWORDS,
  VARIANT_FIELDS_BY_ID_TYPE,
  VARIANT_FIELD_ALIASES,
} from "./idTypeAliases";
import { ID_TEMPLATES } from "./idTemplates";

/** Pixel dimensions of the straightened card image `extractFields` was given, needed to scale a template's normalized regions back to real pixel coordinates. */
export interface ImageSize {
  width: number;
  height: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Best-effort id_type guess from keyword hits across all recognized text. Callers can override this. */
export function detectIdType(lines: RecognizedTextLine[]): IdType | undefined {
  const fullText = normalize(lines.map((l) => l.text).join(" "));
  let best: { type: IdType; hits: number } | undefined;
  for (const [type, keywords] of Object.entries(ID_TYPE_DETECTION_KEYWORDS) as [IdType, string[]][]) {
    const hits = keywords.filter((kw) => fullText.includes(kw)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { type, hits };
  }
  return best?.type;
}

// Matches a same-line "remainder" that's just a unit annotation stuck to the label
// (e.g. "Weight(kg)" -> remainder "(kg)", "Height(m)" -> "(m)") rather than an actual
// value. Letters/degree-sign only inside parens, no digits - real values wouldn't match
// this. Without this check that remainder gets accepted as the field's value outright.
const UNIT_ANNOTATION_PATTERN = /^\([a-zA-Z°]{1,6}\)$/;

/**
 * True if `text` is itself, on its own, nothing but a known field's label (i.e. would
 * match some field's aliases with an empty remainder). Used to catch merged-label OCR
 * lines like "Last Name. First Name.Middle Name", where stripping "Last Name" leaves
 * "First Name.Middle Name" - text that isn't a value at all, but another field's label
 * run together with a third label's leftover text. Without this check that remainder
 * gets accepted as the first field's value outright.
 */
function isKnownLabelText(text: string, allAliasLists: string[][]): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  return allAliasLists.some((aliases) => aliases.some((alias) => norm.startsWith(normalize(alias))));
}

/** If `lineText` starts with one of `aliases` (as a label), returns what's left after stripping it. */
function matchLabel(
  lineText: string,
  aliases: string[],
  allAliasLists: string[][]
): { matched: boolean; remainder: string } {
  const norm = normalize(lineText);
  for (const alias of aliases) {
    const a = normalize(alias);
    if (norm === a) return { matched: true, remainder: "" };
    if (norm.startsWith(a)) {
      const remainder = lineText.slice(alias.length).replace(/^[\s:.\-]+/, "").trim();
      if (UNIT_ANNOTATION_PATTERN.test(remainder) || isKnownLabelText(remainder, allAliasLists)) {
        return { matched: true, remainder: "" };
      }
      return { matched: true, remainder };
    }
  }
  return { matched: false, remainder: "" };
}

function boxCenter(box: [number, number, number, number]): Point2 {
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
}

interface Point2 {
  x: number;
  y: number;
}

/**
 * Finds the nearest not-yet-used line that plausibly holds a label's value: either to
 * the right on the same row, or below and roughly left-aligned with the label (the
 * common ID-layout pattern where a label sits on its own line above the value).
 */
function findValueNear(
  labelLine: RecognizedTextLine,
  candidates: RecognizedTextLine[],
  usedIndices: Set<number>
): { line: RecognizedTextLine; index: number } | undefined {
  const labelCenter = boxCenter(labelLine.boundingBox);
  const labelHeight = labelLine.boundingBox[3] - labelLine.boundingBox[1];
  let best: { line: RecognizedTextLine; index: number; dist: number } | undefined;

  candidates.forEach((cand, idx) => {
    if (usedIndices.has(idx) || cand === labelLine) return;
    const c = boxCenter(cand.boundingBox);
    const sameRow = Math.abs(c.y - labelCenter.y) < labelHeight * 0.7;
    const toRight = c.x > labelLine.boundingBox[2] - 2;
    const below = c.y > labelLine.boundingBox[3] - 2 && Math.abs(c.x - labelLine.boundingBox[0]) < labelHeight * 15;

    if (!((sameRow && toRight) || below)) return;

    const dist =
      sameRow && toRight
        ? c.x - labelLine.boundingBox[2]
        : (c.y - labelLine.boundingBox[3]) * 3 + Math.abs(c.x - labelLine.boundingBox[0]);
    if (dist < 0) return;

    if (!best || dist < best.dist) best = { line: cand, index: idx, dist };
  });

  return best;
}

function toOcrField(text: string, confidence: number, box: [number, number, number, number], side: DocumentSide): OcrField {
  return { value: text.trim(), confidence, source_side: side, bounding_box: box };
}

interface FieldTarget {
  target: Record<string, OcrField | undefined>;
  field: string;
  aliases: string[];
}

interface LabelHit {
  lineIndex: number;
  target: Record<string, OcrField | undefined>;
  field: string;
}

/**
 * Groups line indices into left-to-right rows by y-center proximity (within ~0.6x a
 * line's own height of each other) - the same "is this roughly the same printed row"
 * test used elsewhere, factored out here since both the label side and the value side
 * of the grid-matching step below need it. Returns rows top-to-bottom.
 */
function clusterIntoRows(lines: RecognizedTextLine[], indices: number[]): number[][] {
  const withY = indices
    .map((i) => ({
      i,
      cy: (lines[i].boundingBox[1] + lines[i].boundingBox[3]) / 2,
      h: lines[i].boundingBox[3] - lines[i].boundingBox[1],
    }))
    .sort((a, b) => a.cy - b.cy);

  const rows: { indices: number[]; y: number }[] = [];
  for (const item of withY) {
    const row = rows.find((r) => Math.abs(r.y - item.cy) < item.h * 0.6);
    if (row) {
      row.indices.push(item.i);
      row.y = (row.y * (row.indices.length - 1) + item.cy) / row.indices.length;
    } else {
      rows.push({ indices: [item.i], y: item.cy });
    }
  }

  // Sort by center x, not left edge - a wide box (e.g. "Date of Birth") can start to
  // the left of a narrower box that's visually after it (e.g. "Sex"), which left-edge
  // sorting would get backwards.
  for (const row of rows) {
    row.indices.sort((a, b) => {
      const ax = (lines[a].boundingBox[0] + lines[a].boundingBox[2]) / 2;
      const bx = (lines[b].boundingBox[0] + lines[b].boundingBox[2]) / 2;
      return ax - bx;
    });
  }
  return rows.sort((a, b) => a.y - b.y).map((r) => r.indices);
}

/** Every not-yet-used line that is, on its own, nothing but a known field's label (empty remainder). */
function findLabelOnlyHits(lines: RecognizedTextLine[], used: Set<number>, fieldTargets: FieldTarget[]): LabelHit[] {
  const allAliasLists = fieldTargets.map((f) => f.aliases);
  const hits: LabelHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    for (const { target, field, aliases } of fieldTargets) {
      if (target[field]) continue;
      const { matched, remainder } = matchLabel(lines[i].text, aliases, allAliasLists);
      if (matched && remainder.length === 0) {
        hits.push({ lineIndex: i, target, field });
        break;
      }
    }
  }
  return hits;
}

/**
 * Handles the case findValueNear's one-field-at-a-time nearest-neighbor search gets
 * wrong: several short field labels printed in a row (e.g. "Nationality / Sex / Date of
 * Birth"), with their values in a matching row underneath. Matching each label
 * independently to "whichever unused line is nearest" breaks down here - labels are
 * often more tightly spaced than the values below them, so the nearest-by-distance
 * value for label N can actually belong to label N-1 or N+1, and because fields are
 * resolved one at a time, an earlier field can end up greedily claiming a later field's
 * value out from under it (this is exactly what produced the swapped
 * nationality/sex/date_of_birth values this was written to fix).
 *
 * Instead: find rows containing 2+ label-only hits, find the nearest row of unused
 * lines below that row, and pair them by rank (leftmost label with leftmost value, and
 * so on) - the same left-to-right correspondence a human reads the row with, rather
 * than per-field nearest-distance search.
 */
function resolveGridRows(lines: RecognizedTextLine[], used: Set<number>, fieldTargets: FieldTarget[], side: DocumentSide): void {
  const labelHits = findLabelOnlyHits(lines, used, fieldTargets);
  if (labelHits.length < 2) return;

  const hitsByLine = new Map(labelHits.map((h) => [h.lineIndex, h]));
  const labelLineIndices = labelHits.map((h) => h.lineIndex);
  const labelRows = clusterIntoRows(lines, labelLineIndices);

  for (const labelRow of labelRows) {
    if (labelRow.length < 2) continue; // solo labels: leave for the existing per-field search

    const rowBottom = Math.max(...labelRow.map((i) => lines[i].boundingBox[3]));
    const rowHeight = Math.max(...labelRow.map((i) => lines[i].boundingBox[3] - lines[i].boundingBox[1]));

    const belowCandidates: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i) || hitsByLine.has(i)) continue; // skip already-used lines and other labels
      const top = lines[i].boundingBox[1];
      if (top > rowBottom - 2 && top < rowBottom + rowHeight * 5) belowCandidates.push(i);
    }
    if (belowCandidates.length < 2) continue;

    const valueRows = clusterIntoRows(lines, belowCandidates);
    const valueRow = valueRows[0]; // nearest row below
    if (valueRow.length < 2) continue;

    const pairCount = Math.min(labelRow.length, valueRow.length);
    for (let k = 0; k < pairCount; k++) {
      const hit = hitsByLine.get(labelRow[k])!;
      if (hit.target[hit.field]) continue;
      const valueLine = lines[valueRow[k]];
      hit.target[hit.field] = toOcrField(valueLine.text, valueLine.confidence, valueLine.boundingBox, side);
      used.add(labelRow[k]);
      used.add(valueRow[k]);
    }
  }
}

// How far outside a template region's own box (as a fraction of that box's width/height)
// a candidate line's center may still fall and count as a match. Covers minor scale/
// registration drift between the reference specimen and a real scanned card without this
// step in the extreme picking up neighboring fields' values.
const TEMPLATE_MATCH_MARGIN = 0.3;

/**
 * Matches fields against a known-good positional template for this exact id_type + side
 * (see idTemplates.ts), when one exists and the caller told us the image's pixel size.
 * Runs before the label-based heuristics below and claims lines outright: template
 * regions are captured from a confirmed-correct real specimen, so for the fields they
 * cover they're more trustworthy than proximity-to-a-label guessing - and unlike the
 * label heuristics, this doesn't depend on the label text being read correctly at all,
 * which is exactly what breaks it (see idTemplates.ts's doc comment).
 */
function resolveFromTemplate(
  lines: RecognizedTextLine[],
  used: Set<number>,
  fieldTargets: FieldTarget[],
  idType: IdType | undefined,
  side: DocumentSide,
  imageSize: ImageSize | undefined
): void {
  if (!idType || !imageSize) return;
  const template = ID_TEMPLATES[idType]?.[side];
  if (!template) return;

  for (const { target, field } of fieldTargets) {
    if (target[field]) continue;
    const region = template[field];
    if (!region) continue;

    const pixelBox: [number, number, number, number] = [
      region.box[0] * imageSize.width,
      region.box[1] * imageSize.height,
      region.box[2] * imageSize.width,
      region.box[3] * imageSize.height,
    ];
    const marginX = (pixelBox[2] - pixelBox[0]) * TEMPLATE_MATCH_MARGIN;
    const marginY = (pixelBox[3] - pixelBox[1]) * TEMPLATE_MATCH_MARGIN;
    const targetCenter = boxCenter(pixelBox);

    let best: { index: number; dist: number } | undefined;
    lines.forEach((line, i) => {
      if (used.has(i)) return;
      const c = boxCenter(line.boundingBox);
      if (c.x < pixelBox[0] - marginX || c.x > pixelBox[2] + marginX) return;
      if (c.y < pixelBox[1] - marginY || c.y > pixelBox[3] + marginY) return;
      const dist = Math.hypot(c.x - targetCenter.x, c.y - targetCenter.y);
      if (!best || dist < best.dist) best = { index: i, dist };
    });

    if (best) {
      const line = lines[best.index];
      target[field] = toOcrField(line.text, line.confidence, line.boundingBox, side);
      used.add(best.index);
    }
  }
}

/**
 * Label-keyword + bounding-box heuristic field extractor. Three passes: first
 * resolveFromTemplate claims fields a known-good position template covers (see its doc
 * comment); then resolveGridRows handles rows of 2+ short field labels with a matching
 * value row below (see its doc comment); then the remaining fields fall back to the
 * simpler per-field search - a line matching one of its label aliases, then the value
 * either from the rest of that same line (e.g. "Sex: F") or the nearest unused line to
 * its right/below (e.g. a solo label with the value printed underneath).
 */
export function extractFields(
  lines: RecognizedTextLine[],
  idType: IdType | undefined,
  side: DocumentSide,
  imageSize?: ImageSize
): { common_fields: CommonFields; variant_fields: VariantFields } {
  const common: CommonFields = {};
  const variant: VariantFields = {};
  const used = new Set<number>();

  const commonTarget = common as Record<string, OcrField | undefined>;
  const variantTarget = variant as Record<string, OcrField | undefined>;

  const applicableVariantFields = idType ? VARIANT_FIELDS_BY_ID_TYPE[idType] : Object.keys(VARIANT_FIELD_ALIASES);

  const fieldTargets: FieldTarget[] = [
    ...Object.entries(COMMON_FIELD_ALIASES).map(([field, aliases]) => ({ target: commonTarget, field, aliases })),
    ...applicableVariantFields
      .map((field) => ({ target: variantTarget, field, aliases: VARIANT_FIELD_ALIASES[field] }))
      .filter((f): f is FieldTarget => Boolean(f.aliases)),
  ];

  resolveFromTemplate(lines, used, fieldTargets, idType, side, imageSize);
  resolveGridRows(lines, used, fieldTargets, side);

  const allAliasLists = fieldTargets.map((f) => f.aliases);

  function assign(target: Record<string, OcrField | undefined>, field: string, aliases: string[]) {
    if (target[field]) return; // already resolved by resolveGridRows
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const { matched, remainder } = matchLabel(lines[i].text, aliases, allAliasLists);
      if (!matched) continue;

      if (remainder.length >= 1) {
        used.add(i);
        target[field] = toOcrField(remainder, lines[i].confidence, lines[i].boundingBox, side);
        return;
      }

      const found = findValueNear(lines[i], lines, used);
      if (found) {
        used.add(i);
        used.add(found.index);
        target[field] = toOcrField(found.line.text, found.line.confidence, found.line.boundingBox, side);
        return;
      }
    }
  }

  for (const { target, field, aliases } of fieldTargets) {
    assign(target, field, aliases);
  }

  return { common_fields: common, variant_fields: variant };
}
