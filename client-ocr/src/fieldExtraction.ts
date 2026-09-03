import type { CommonFields, DocumentSide, IdType, OcrField, RecognizedTextLine, VariantFields } from "./types";
import {
  COMMON_FIELD_ALIASES,
  ID_TYPE_DETECTION_KEYWORDS,
  VARIANT_FIELDS_BY_ID_TYPE,
  VARIANT_FIELD_ALIASES,
} from "./idTypeAliases";

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

/** If `lineText` starts with one of `aliases` (as a label), returns what's left after stripping it. */
function matchLabel(lineText: string, aliases: string[]): { matched: boolean; remainder: string } {
  const norm = normalize(lineText);
  for (const alias of aliases) {
    const a = normalize(alias);
    if (norm === a) return { matched: true, remainder: "" };
    if (norm.startsWith(a)) {
      const remainder = lineText.slice(alias.length).replace(/^[\s:.\-]+/, "").trim();
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

/**
 * Label-keyword + bounding-box heuristic field extractor: for each known field, find a
 * line that matches one of its label aliases, then take the value either from the rest
 * of that same line (e.g. "Sex: F") or from the nearest unused line to its right/below
 * (e.g. a label on its own line with the value printed underneath).
 */
export function extractFields(
  lines: RecognizedTextLine[],
  idType: IdType | undefined,
  side: DocumentSide
): { common_fields: CommonFields; variant_fields: VariantFields } {
  const common: CommonFields = {};
  const variant: VariantFields = {};
  const used = new Set<number>();

  function assign(target: Record<string, OcrField | undefined>, field: string, aliases: string[]) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const { matched, remainder } = matchLabel(lines[i].text, aliases);
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

  const commonTarget = common as Record<string, OcrField | undefined>;
  const variantTarget = variant as Record<string, OcrField | undefined>;

  for (const [field, aliases] of Object.entries(COMMON_FIELD_ALIASES)) {
    assign(commonTarget, field, aliases);
  }

  const applicableVariantFields = idType ? VARIANT_FIELDS_BY_ID_TYPE[idType] : Object.keys(VARIANT_FIELD_ALIASES);
  for (const field of applicableVariantFields) {
    const aliases = VARIANT_FIELD_ALIASES[field];
    if (aliases) assign(variantTarget, field, aliases);
  }

  return { common_fields: common, variant_fields: variant };
}
