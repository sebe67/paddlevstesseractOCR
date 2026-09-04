// Fetches the real det_model.onnx/rec_model.onnx/dictionary from the live bucket and
// runs them (via onnxruntime-web's wasm backend, in plain Node - no browser needed)
// against a synthetic "DELA CRUZ" text image, reusing the actual detection geometry
// from src/geometry.ts unmodified. Prints the decoded text and confidence so you can
// eyeball whether the deployed model files, dictionary, and detection math still agree
// with each other - run this any time the bucket's model files change.
//
// Usage: npm run check:live-models
import * as ort from "onnxruntime-web";
import sharp from "sharp";
import {
  findConnectedComponents,
  convexHull,
  minAreaRect,
  unclipRect,
  orderQuadPoints,
} from "../src/geometry.ts";


const BASE = "https://storage.googleapis.com/idscan_ocr/v1.0/";

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

console.log("Fetching real model files from the live bucket...");
const [detBytes, recBytes, keysText] = await Promise.all([
  fetchBytes(BASE + "det_model.onnx"),
  fetchBytes(BASE + "rec_model.onnx"),
  fetchText(BASE + "ppocr_keys_v1.txt"),
]);
console.log(`det_model.onnx: ${detBytes.length} bytes`);
console.log(`rec_model.onnx: ${recBytes.length} bytes`);
const dictLines = keysText.split(/\r?\n/).filter((l) => l.length > 0);
const charset = ["", ...dictLines, " "];
console.log(`ppocr_keys_v1.txt: ${dictLines.length} entries -> charset length ${charset.length}`);

console.log("\nCreating inference sessions...");
const detSession = await ort.InferenceSession.create(detBytes, { executionProviders: ["wasm"] });
const recSession = await ort.InferenceSession.create(recBytes, { executionProviders: ["wasm"] });
console.log("det input/output names:", detSession.inputNames, detSession.outputNames);
console.log("rec input/output names:", recSession.inputNames, recSession.outputNames);

// --- Build the synthetic test image (same "DELA CRUZ" render Playwright made earlier) ---
const svg = `
<svg width="400" height="120" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>
  <text x="20" y="75" font-family="Arial" font-size="40" fill="black">DELA CRUZ</text>
</svg>`;
const srcImg = sharp(Buffer.from(svg)).ensureAlpha();
const srcMeta = await srcImg.metadata();
const srcRaw = await srcImg.raw().toBuffer(); // RGBA
console.log(`\nSynthetic test image: ${srcMeta.width}x${srcMeta.height}`);

// --- Detection preprocessing (mirrors imageUtils.computeDetResizeDims + normalization) ---
function computeDetResizeDims(width, height, limitSideLen = 960) {
  const maxSide = Math.max(width, height);
  const ratio = maxSide > limitSideLen ? limitSideLen / maxSide : 1;
  const resizeH = Math.max(32, Math.round((height * ratio) / 32) * 32);
  const resizeW = Math.max(32, Math.round((width * ratio) / 32) * 32);
  return { width: resizeW, height: resizeH };
}

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

async function toNormalizedTensor(rawRgba, srcW, srcH, targetW, targetH, mode) {
  const resized = await sharp(rawRgba, { raw: { width: srcW, height: srcH, channels: 4 } })
    .resize(targetW, targetH, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer(); // RGB, targetW*targetH*3

  const chw = new Float32Array(3 * targetW * targetH);
  const plane = targetW * targetH;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const px = (y * targetW + x) * 3;
      const idx = y * targetW + x;
      for (let c = 0; c < 3; c++) {
        const raw = resized[px + c] / 255;
        const v = mode === "0-1" ? (raw - IMAGENET_MEAN[c]) / IMAGENET_STD[c] : (raw - 0.5) / 0.5;
        chw[c * plane + idx] = v;
      }
    }
  }
  return chw;
}

const { width: resizeW, height: resizeH } = computeDetResizeDims(srcMeta.width, srcMeta.height);
console.log(`Detection resize target: ${resizeW}x${resizeH}`);
const detTensorData = await toNormalizedTensor(srcRaw, srcMeta.width, srcMeta.height, resizeW, resizeH, "0-1");

console.log("\nRunning detection model...");
const detInput = new ort.Tensor("float32", detTensorData, [1, 3, resizeH, resizeW]);
const detOutputs = await detSession.run({ [detSession.inputNames[0]]: detInput });
const probMap = detOutputs[detSession.outputNames[0]];
console.log("det output dims:", probMap.dims);

const probData = probMap.data;
const dims = probMap.dims;
const probH = dims[dims.length - 2];
const probW = dims[dims.length - 1];

let maxProb = 0;
for (let i = 0; i < probData.length; i++) maxProb = Math.max(maxProb, probData[i]);
console.log(`Probability map max value: ${maxProb.toFixed(4)} (sanity: should be well above 0.3 if the model fires on text at all)`);

const THRESH = 0.3;
const binary = new Uint8Array(probW * probH);
let litPixels = 0;
for (let i = 0; i < binary.length; i++) {
  binary[i] = probData[i] > THRESH ? 1 : 0;
  if (binary[i]) litPixels++;
}
console.log(`Pixels above threshold ${THRESH}: ${litPixels} / ${binary.length}`);

const components = findConnectedComponents(binary, probW, probH);
console.log(`Connected components found: ${components.length}`);

const scaleX = srcMeta.width / resizeW;
const scaleY = srcMeta.height / resizeH;
const boxes = [];
for (const comp of components) {
  const hull = convexHull(comp);
  if (hull.length < 3) continue;
  const rect = minAreaRect(hull);
  let sum = 0;
  for (const p of comp) sum += probData[p.y * probW + p.x];
  const score = sum / comp.length;
  const unclipped = unclipRect(rect, 1.5);
  const corners = orderQuadPoints(unclipped.corners.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })));
  boxes.push({ score, width: rect.width * scaleX, height: rect.height * scaleY, corners });
}
console.log(`\nDetected boxes (score, approx size, corners):`);
for (const b of boxes) {
  console.log(
    `  score=${b.score.toFixed(3)} size=${b.width.toFixed(0)}x${b.height.toFixed(0)} corners=${JSON.stringify(
      b.corners.map((p) => [Math.round(p.x), Math.round(p.y)])
    )}`
  );
}

if (boxes.length === 0) {
  console.log("\nNo boxes survived detection - stopping before recognition.");
  process.exit(0);
}

// Use the highest-score box, crop it out (axis-aligned bounding box is fine for this
// horizontal synthetic line - the real perspective.ts triangle-warp isn't exercised here).
const best = boxes.reduce((a, b) => (b.score > a.score ? b : a));
const xs = best.corners.map((p) => p.x);
const ys = best.corners.map((p) => p.y);
const cropX = Math.max(0, Math.floor(Math.min(...xs)));
const cropY = Math.max(0, Math.floor(Math.min(...ys)));
const cropW = Math.min(srcMeta.width - cropX, Math.ceil(Math.max(...xs) - cropX));
const cropH = Math.min(srcMeta.height - cropY, Math.ceil(Math.max(...ys) - cropY));
console.log(`\nCropping best box for recognition: x=${cropX} y=${cropY} w=${cropW} h=${cropH}`);

const cropRaw = await sharp(srcRaw, { raw: { width: srcMeta.width, height: srcMeta.height, channels: 4 } })
  .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
  .raw()
  .toBuffer();

const REC_HEIGHT = 48;
const recTargetWidth = Math.max(REC_HEIGHT, Math.round(REC_HEIGHT * (cropW / cropH)));
const recTensorData = await toNormalizedTensor(cropRaw, cropW, cropH, recTargetWidth, REC_HEIGHT, "-1-1");

console.log(`\nRunning recognition model on ${recTargetWidth}x${REC_HEIGHT} crop...`);
const recInput = new ort.Tensor("float32", recTensorData, [1, 3, REC_HEIGHT, recTargetWidth]);
const recOutputs = await recSession.run({ [recSession.inputNames[0]]: recInput });
const logits = recOutputs[recSession.outputNames[0]];
console.log("rec output dims:", logits.dims);

const [, T, C] = logits.dims;
console.log(`Recognition output classes: ${C} (charset length: ${charset.length}) -> ${C === charset.length ? "MATCH" : "MISMATCH"}`);

const logitData = logits.data;
let prevIdx = -1;
const chars = [];
let confSum = 0;
let confCount = 0;
for (let t = 0; t < T; t++) {
  const offset = t * C;
  let maxVal = -Infinity;
  let maxIdx = 0;
  let rowSum = 0;
  for (let c = 0; c < C; c++) {
    const v = logitData[offset + c];
    rowSum += v;
    if (v > maxVal) {
      maxVal = v;
      maxIdx = c;
    }
  }
  let prob;
  if (Math.abs(rowSum - 1) < 0.01) {
    prob = maxVal;
  } else {
    let expSum = 0;
    for (let c = 0; c < C; c++) expSum += Math.exp(logitData[offset + c] - maxVal);
    prob = 1 / expSum;
  }
  if (maxIdx !== 0 && maxIdx !== prevIdx) {
    chars.push(charset[maxIdx] ?? "");
    confSum += prob;
    confCount += 1;
  }
  prevIdx = maxIdx;
}

console.log(`\n=== DECODED TEXT: "${chars.join("")}" ===`);
console.log(`Average confidence: ${confCount > 0 ? (confSum / confCount).toFixed(3) : "n/a"}`);
console.log(`(Ground truth rendered: "DELA CRUZ")`);
