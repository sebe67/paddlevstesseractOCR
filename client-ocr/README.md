# id-ocr-web

Client-side (browser) OCR + field extraction for Philippine ID scans. Runs entirely
on-device via [`onnxruntime-web`](https://github.com/microsoft/onnxruntime) (WASM
backend) using PaddleOCR PP-OCRv5 mobile detection/recognition models — the image
never leaves the device. The only network calls are the initial (cached) downloads of
the three model assets from a public GCS bucket.

## Setup

1. **Make the model files public-read** in the `idscan_ocr` bucket — this code fetches
   them directly from the browser with no credentials, so `det_model.onnx`,
   `rec_model.onnx`, and `ppocr_keys_v1.txt` must be publicly readable
   (`gsutil iam ch allUsers:objectViewer gs://idscan_ocr`, or set object ACLs). `cls_model.onnx`
   is not used — orientation classification is skipped since input images already
   arrive edge-straightened/upright.
2. **Host `onnxruntime-web`'s `.wasm` binaries** somewhere your app serves static
   assets from (they ship in `node_modules/onnxruntime-web/dist/`), or point at a CDN
   build. Call `configureOrtWasmPaths(url)` once at app startup before the first
   `runIdOcr` call.
3. `npm install && npm run build`.

## Usage

```ts
import { configureOrtWasmPaths, runIdOcr, mergeIdOcrResults } from "id-ocr-web";

configureOrtWasmPaths("/onnxruntime-wasm/"); // wherever you host the .wasm files

// `frontImage`/`backImage` are already-cropped/edge-straightened captures
// (Blob, HTMLImageElement, HTMLCanvasElement, or ImageBitmap).
const front = await runIdOcr(frontImage, "FRONT");
const back = await runIdOcr(backImage, "BACK");

const result = mergeIdOcrResults([front, back]); // matches the ph-id-schema JSON schema
```

Call `runIdOcr` with just the front image (`mergeIdOcrResults([front])`) if a
document type has no useful text on the back.

## How it works

1. **Detect** (`det_model.onnx`, DB-based) — probability map → threshold → connected
   components → `minAreaRect` per blob → score/size filter → unclip → text-line boxes.
2. **Crop & straighten** each box out of the source image via a two-triangle affine
   warp (`perspective.ts`), then **recognize** (`rec_model.onnx`) with greedy CTC
   decoding against `ppocr_keys_v1.txt`.
3. **Classify `id_type`** via keyword hits across the recognized text (override with
   `runIdOcr(image, side, { idType: "PASSPORT" })` if the caller already knows it).
4. **Extract fields**: match each field's label aliases (English + Filipino) against
   recognized lines, take the value from the same line or the nearest line to the
   right/below, and attach the line's bounding box. For `PASSPORT`, also parses the
   TD3 MRZ and uses it (checksum-validated) to fill in anything label-matching missed.

## Known approximations / next steps for your team

- **DB unclip** offsets each detected box as a rectangle (exact for a `minAreaRect`
  output) rather than pulling in a full polygon-clipping library — matches PaddleOCR's
  default `box_type="quad"` behavior; swap in a real polygon clipper if you start
  seeing curved/irregular text blobs it doesn't handle well.
- **`id_type` detection and field-label aliases** (`idTypeAliases.ts`) are a starting
  point covering the 12 PH ID types you specified; PHILSYS/UMID/PRC/POSTAL/VOTERS/SSS/
  TIN/PHILHEALTH weren't part of the original PaddleOCR-vs-Tesseract benchmark, so
  expect to expand these lists once you're testing against real cards.
- **SENIOR_CITIZEN and PWD IDs are issued per-LGU**, not by one national agency —
  layout and label wording vary by city/municipality far more than the other types
  here. Field recall on these two will likely be lower regardless of tuning; the
  keyword-based (rather than fixed-position) extraction approach here is meant to be
  the more robust choice for that reason.
- **Untested against onnxruntime-web at runtime** — this was built and typechecked
  against the real `onnxruntime-web` types, but not run in a browser against the
  actual model weights (no browser/model access in the environment this was written
  in). Test the full pipeline against a handful of real ID scans before shipping;
  the most likely sources of mismatch are the detection model's exact input tensor
  name/shape and the recognition model's output class count vs. `ppocr_keys_v1.txt`
  length (a runtime warning fires in `recognize.ts` if those disagree).
- **No batching** — each detected text line runs through the rec model one at a time.
  Fine for a single ID scan; worth batching if you see this pipeline used somewhere
  latency-sensitive with many lines.
