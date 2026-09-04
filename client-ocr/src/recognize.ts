import * as ort from "onnxruntime-web";
import { canvasRegionToNormalizedTensor } from "./imageUtils";

export interface RecCharset {
  /** Index 0 is the reserved CTC blank; the rest mirrors the loaded dictionary file (ppocrv5_dict.txt for PP-OCRv5 mobile) plus a trailing space. */
  chars: string[];
}

/** PaddleOCR's CTCLabelDecode charset: ['blank', ...dict lines, ' ']. */
export function buildCharset(keysFileText: string): RecCharset {
  const lines = keysFileText.split(/\r?\n/).filter((l) => l.length > 0);
  return { chars: ["", ...lines, " "] };
}

export interface RecognizedText {
  text: string;
  confidence: number;
}

const REC_HEIGHT = 48;
const MAX_REC_WIDTH = 800;

/**
 * Runs the PP-OCRv5 recognition model on one already-cropped/straightened text-line
 * image and greedy-CTC-decodes the output against the PaddleOCR character dictionary.
 */
export async function recognizeLine(
  session: ort.InferenceSession,
  lineCanvas: HTMLCanvasElement,
  charset: RecCharset
): Promise<RecognizedText> {
  const aspect = lineCanvas.width / Math.max(1, lineCanvas.height);
  const targetWidth = Math.min(MAX_REC_WIDTH, Math.max(REC_HEIGHT, Math.round(REC_HEIGHT * aspect)));
  const tensor = canvasRegionToNormalizedTensor(lineCanvas, targetWidth, REC_HEIGHT, undefined, undefined, "-1-1");

  const inputName = session.inputNames[0];
  const input = new ort.Tensor("float32", tensor.data, [1, 3, REC_HEIGHT, targetWidth]);
  const outputs = await session.run({ [inputName]: input });
  const logits = outputs[session.outputNames[0]];
  const dims = logits.dims; // [1, T, C]
  const T = dims[1];
  const C = dims[2];

  if (C !== charset.chars.length) {
    console.warn(
      `id-ocr-web: rec model outputs ${C} classes but the loaded charset has ${charset.chars.length} entries ` +
        "(blank + dictionary file + space). Decoded text will be misaligned — confirm the dictionary file " +
        "loaded via OcrModelConfig.keysUrl matches the deployed rec_model.onnx's training dictionary " +
        "(PP-OCRv5 mobile needs ppocrv5_dict.txt's 18,383 entries, NOT the older ppocr_keys_v1.txt's 6,623)."
    );
  }

  const data = logits.data as Float32Array;
  let prevIdx = -1;
  const chars: string[] = [];
  let confSum = 0;
  let confCount = 0;

  for (let t = 0; t < T; t++) {
    const offset = t * C;
    let maxVal = -Infinity;
    let maxIdx = 0;
    for (let c = 0; c < C; c++) {
      const v = data[offset + c];
      if (v > maxVal) {
        maxVal = v;
        maxIdx = c;
      }
    }
    let expSum = 0;
    for (let c = 0; c < C; c++) expSum += Math.exp(data[offset + c] - maxVal);
    const prob = 1 / expSum; // softmax probability of the argmax class

    // Standard CTC greedy decode: drop blanks (index 0), collapse consecutive repeats.
    if (maxIdx !== 0 && maxIdx !== prevIdx) {
      chars.push(charset.chars[maxIdx] ?? "");
      confSum += prob;
      confCount += 1;
    }
    prevIdx = maxIdx;
  }

  return {
    text: chars.join(""),
    confidence: confCount > 0 ? confSum / confCount : 0,
  };
}
