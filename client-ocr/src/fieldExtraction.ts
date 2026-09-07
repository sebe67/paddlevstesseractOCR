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

function levenshtein(a: string, b: string): number {
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) dp.push(new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// How much of an alias's characters may differ (proportionally, rounded, minimum 1) and
// still count as the same label. Real-world recognition noise on this font/model garbles
// labels character-by-character in ways an exact substring match can't survive - "Sex" ->
// "SRX", "Date of Birth" -> "Date af Birth", "First Name" -> "Fint Nama" - all seen in a
// real bug report. 30% is loose enough to catch that without being so loose it starts
// matching unrelated short values (verified against real field values in this file's
// regression test).
const FUZZY_EDIT_RATIO = 0.3;

// Aliases at or under this length only ever get compared at their own exact length (see
// fuzzyMatchPrefix's comment) - long enough to still cover every short single-word alias
// in idTypeAliases.ts ("sex", "weight", "height", "tin", "pin", "crn", "dob", "id no", ...).
const SHORT_ALIAS_MAX_LENGTH = 6;

/**
 * Fuzzy prefix match: does `text` start with something close enough to `alias` to call it
 * the same label? Tries exact match first (fast path), then - since a garbled label can
 * come out a different length than the real one (a dropped or inserted character) - the
 * edit distance from `alias` against several nearby prefix lengths of `text`, keeping
 * whichever length scores lowest. Returns the length of `text` that was consumed as the
 * label, so the caller can slice off exactly that much rather than assuming it's
 * `alias.length`.
 */
function fuzzyMatchPrefix(text: string, alias: string): { matched: boolean; matchedLength: number } {
  if (text.startsWith(alias)) return { matched: true, matchedLength: alias.length };

  const threshold = Math.max(1, Math.round(alias.length * FUZZY_EDIT_RATIO));
  // Short aliases (a single short word, like "sex") are only ever compared at their own
  // exact length. Letting them match a shorter text prefix too is what let "Expiration
  // Date" collide with "sex": its first two characters, "ex", are edit-distance 1 from
  // "sex" purely because both strings being compared are tiny, not because they mean the
  // same thing. Longer, usually multi-word aliases get a wider length window, since
  // recovering a real character drop (a missing OCR'd space, e.g. "Fint Nama.Middie Name"
  // for "First Name.Middle Name") needs a text prefix shorter or longer than the alias's
  // own length to line up correctly - and there the length difference is a much smaller
  // fraction of the total, so the coincidental-match risk is proportionally far lower.
  const isShortAlias = alias.length <= SHORT_ALIAS_MAX_LENGTH;
  const lo = isShortAlias ? alias.length : Math.max(1, alias.length - 2);
  const hi = isShortAlias ? alias.length : alias.length + 3;
  let best: { len: number; dist: number } | undefined;
  for (let len = lo; len <= Math.min(hi, text.length); len++) {
    const dist = levenshtein(text.slice(0, len), alias);
    if (!best || dist < best.dist) best = { len, dist };
  }
  if (best && best.dist <= threshold) return { matched: true, matchedLength: best.len };
  return { matched: false, matchedLength: 0 };
}

/**
 * True if `text` is itself, on its own, nothing but a known field's label (i.e. would
 * match some field's aliases with an empty remainder). Used to catch merged-label OCR
 * lines like "Last Name. First Name.Middle Name", where stripping "Last Name" leaves
 * "First Name.Middle Name" - text that isn't a value at all, but another field's label
 * (possibly itself garbled, e.g. "Fint Nama.Middie Name") run together with a third
 * label's leftover text. Without this check that remainder gets accepted as the first
 * field's value outright.
 */
function isKnownLabelText(text: string, allAliasLists: string[][]): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  return allAliasLists.some((aliases) => aliases.some((alias) => fuzzyMatchPrefix(norm, normalize(alias)).matched));
}

/**
 * True if `text` is, on its own, entirely and only some known field's label - nothing
 * left over (unlike isKnownLabelText above, which also counts a label that's merely a
 * *prefix* of a longer line). Used to stop a nearby-line search (findValueNear,
 * resolveGridRows) from accepting a candidate that's obviously not a value at all: a real
 * bug report had "Last Name"'s value resolve to the text "Nationality" - the nearest
 * unused line below it - purely because nothing checked whether that candidate was
 * itself just another field's label.
 */
function isLabelOnlyText(text: string, allAliasLists: string[][]): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  return allAliasLists.some((aliases) =>
    aliases.some((alias) => {
      const { matched, matchedLength } = fuzzyMatchPrefix(norm, normalize(alias));
      return matched && matchedLength >= norm.length;
    })
  );
}

// A value that plainly isn't the right shape for its field is worse than no value at all
// - a bug report had "weight" resolve to an address placeholder line ("UNIT/HOUSE
// NO.BUILDING, STREET NAME,") and "expiry_date" resolve to a single stray character
// ("h"), both just because they were the nearest unused line, with nothing checking
// whether they looked anything like a weight or a date. Intentionally loose (a real OCR
// value can still have noise) - this only screens out candidates that couldn't possibly
// be right, not ones that merely look unusual.
const NUMERIC_VALUE_PATTERN = /^\d+(\.\d+)?\s*[a-zA-Z]{0,3}$/;
const DATE_VALUE_PATTERN = /\d{2,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/;

const FIELD_VALUE_VALIDATORS: Partial<Record<string, (text: string) => boolean>> = {
  weight: (text) => NUMERIC_VALUE_PATTERN.test(text.trim()),
  height: (text) => NUMERIC_VALUE_PATTERN.test(text.trim()),
  date_of_birth: (text) => DATE_VALUE_PATTERN.test(text),
  issue_date: (text) => DATE_VALUE_PATTERN.test(text),
  expiry_date: (text) => DATE_VALUE_PATTERN.test(text),
};

/** If `lineText` starts with (or closely resembles the start of) one of `aliases` as a label, returns what's left after stripping it. */
function matchLabel(
  lineText: string,
  aliases: string[],
  allAliasLists: string[][]
): { matched: boolean; remainder: string } {
  const norm = normalize(lineText);
  for (const alias of aliases) {
    const a = normalize(alias);
    const { matched, matchedLength } = fuzzyMatchPrefix(norm, a);
    if (!matched) continue;
    if (matchedLength >= norm.length) return { matched: true, remainder: "" };
    const remainder = lineText.slice(matchedLength).replace(/^[\s:.\-]+/, "").trim();
    if (UNIT_ANNOTATION_PATTERN.test(remainder) || isKnownLabelText(remainder, allAliasLists)) {
      return { matched: true, remainder: "" };
    }
    return { matched: true, remainder };
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
  usedIndices: Set<number>,
  isAcceptable: (line: RecognizedTextLine) => boolean = () => true
): { line: RecognizedTextLine; index: number } | undefined {
  const labelCenter = boxCenter(labelLine.boundingBox);
  const labelHeight = labelLine.boundingBox[3] - labelLine.boundingBox[1];
  let best: { line: RecognizedTextLine; index: number; dist: number } | undefined;

  candidates.forEach((cand, idx) => {
    if (usedIndices.has(idx) || cand === labelLine || !isAcceptable(cand)) return;
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
function resolveGridRows(
  lines: RecognizedTextLine[],
  used: Set<number>,
  fieldTargets: FieldTarget[],
  side: DocumentSide,
  allAliasLists: string[][]
): void {
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
      // skip already-used lines, other labels, and lines that are themselves clearly
      // some other field's label rather than a value (see isLabelOnlyText's comment)
      if (used.has(i) || hitsByLine.has(i) || isLabelOnlyText(lines[i].text, allAliasLists)) continue;
      const top = lines[i].boundingBox[1];
      if (top > rowBottom - 2 && top < rowBottom + rowHeight * 5) belowCandidates.push(i);
    }
    if (belowCandidates.length < 2) continue;

    const valueRows = clusterIntoRows(lines, belowCandidates);
    const valueRow = valueRows[0]; // nearest row below
    if (valueRow.length < 2) continue;

    // Pair by nearest x-center column, not by rank (label[k] <-> value[k]): if one label in
    // the row wasn't recognized (garbled past even the fuzzy match, e.g. "Nationality"
    // read as just "Ma"), its value is still sitting in the value row, and rank pairing
    // would shift every label after it onto the wrong value. Matching each label to
    // whichever remaining value column is horizontally closest survives that - the
    // recognized labels still land on their own true values regardless of a gap earlier
    // in the row.
    const valueRemaining = new Set(valueRow);
    for (const labelIdx of labelRow) {
      const hit = hitsByLine.get(labelIdx)!;
      if (hit.target[hit.field]) continue;
      const labelCx = (lines[labelIdx].boundingBox[0] + lines[labelIdx].boundingBox[2]) / 2;
      const validator = FIELD_VALUE_VALIDATORS[hit.field];

      let bestValueIdx: number | undefined;
      let bestDist = Infinity;
      for (const valueIdx of valueRemaining) {
        if (validator && !validator(lines[valueIdx].text)) continue;
        const valueCx = (lines[valueIdx].boundingBox[0] + lines[valueIdx].boundingBox[2]) / 2;
        const dist = Math.abs(valueCx - labelCx);
        if (dist < bestDist) {
          bestDist = dist;
          bestValueIdx = valueIdx;
        }
      }
      if (bestValueIdx === undefined) continue;

      const valueLine = lines[bestValueIdx];
      hit.target[hit.field] = toOcrField(valueLine.text, valueLine.confidence, valueLine.boundingBox, side);
      used.add(labelIdx);
      used.add(bestValueIdx);
      valueRemaining.delete(bestValueIdx);
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

// PH driver's license id_number ("N03-12-123456") immediately followed, with no
// separator, by an expiry_date ("2022/10/04"). Seen in a real bug report where the
// detector's box-merging (DB unclip pulling two close, same-row text boxes into one)
// fused the id_number and expiry_date cells into a single OCR line - the two values
// never existed as separate lines to match against, so no amount of label/position
// matching over `lines` can recover them; only recognizing the fused shape itself can.
const ID_NUMBER_PATTERN = /^[A-Z]\d{2}-\d{2}-\d{6}$/;
const COMPOUND_ID_EXPIRY_PATTERN = /^([A-Z]\d{2}-\d{2}-\d{6})(\d{4}\/\d{2}\/\d{2})$/;

/**
 * Recovers id_number/expiry_date from a single fused OCR line matching the compound
 * shape above (see its comment). Always trusts the split expiry_date over whatever's
 * already there - a value that fits this exact fused shape is itself evidence the
 * existing one is the same merged garbage - but only overwrites id_number if its current
 * value doesn't already look like a clean id_number on its own (e.g. from the position
 * template), since a template match is likely correct.
 */
function splitCompoundIdExpiry(lines: RecognizedTextLine[], variant: Record<string, OcrField | undefined>, side: DocumentSide): void {
  for (const line of lines) {
    const match = COMPOUND_ID_EXPIRY_PATTERN.exec(line.text.replace(/\s+/g, ""));
    if (!match) continue;
    variant.expiry_date = toOcrField(match[2], line.confidence, line.boundingBox, side);
    if (!variant.id_number || !ID_NUMBER_PATTERN.test(variant.id_number.value)) {
      variant.id_number = toOcrField(match[1], line.confidence, line.boundingBox, side);
    }
    return;
  }
}

/**
 * Label-keyword + bounding-box heuristic field extractor. Three passes: first
 * resolveFromTemplate claims fields a known-good position template covers (see its doc
 * comment); then resolveGridRows handles rows of 2+ short field labels with a matching
 * value row below (see its doc comment); then the remaining fields fall back to the
 * simpler per-field search - a line matching one of its label aliases, then the value
 * either from the rest of that same line (e.g. "Sex: F") or the nearest unused line to
 * its right/below (e.g. a solo label with the value printed underneath). Finally,
 * splitCompoundIdExpiry recovers id_number/expiry_date from a fused detection box, when
 * one of the fields those apply to is applicable to this id_type.
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

  const allAliasLists = fieldTargets.map((f) => f.aliases);

  resolveFromTemplate(lines, used, fieldTargets, idType, side, imageSize);
  resolveGridRows(lines, used, fieldTargets, side, allAliasLists);

  function assign(target: Record<string, OcrField | undefined>, field: string, aliases: string[]) {
    if (target[field]) return; // already resolved by resolveGridRows
    const validator = FIELD_VALUE_VALIDATORS[field];
    const isAcceptableValue = (l: RecognizedTextLine) =>
      !isLabelOnlyText(l.text, allAliasLists) && (!validator || validator(l.text));

    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const { matched, remainder } = matchLabel(lines[i].text, aliases, allAliasLists);
      if (!matched) continue;

      if (remainder.length >= 1 && isAcceptableValue({ text: remainder, confidence: lines[i].confidence, boundingBox: lines[i].boundingBox })) {
        used.add(i);
        target[field] = toOcrField(remainder, lines[i].confidence, lines[i].boundingBox, side);
        return;
      }

      const found = findValueNear(lines[i], lines, used, isAcceptableValue);
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

  if (applicableVariantFields.includes("id_number") && applicableVariantFields.includes("expiry_date")) {
    splitCompoundIdExpiry(lines, variantTarget, side);
  }

  return { common_fields: common, variant_fields: variant };
}
