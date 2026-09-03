# id-ocr-web

Client-side (browser) OCR + field extraction for Philippine ID scans. Runs entirely
on-device via [`onnxruntime-web`](https://github.com/microsoft/onnxruntime) (WASM
backend) using PaddleOCR PP-OCRv5 mobile detection/recognition models — the image
never leaves the device. The only network calls are the initial (cached) downloads of
the three model assets from a public GCS bucket.

## Where this code lives vs. where the models live

This `src/` directory is **application source code**, not something users download on
its own — it gets bundled by your app's normal build tool (Vite, webpack, Next.js,
whatever you're already using) into your app's JS bundle, and reaches the user's
device the same way the rest of your frontend already does. Wire it in by copying
`src/*.ts` into your app, adding this directory as a local workspace package, or
publishing it to a private registry and installing it as a dependency — then
`import { runIdOcr, mergeIdOcrResults, configureOrtWasmPaths } from "id-ocr-web"`
like any other module.

The `idscan_ocr` **GCS bucket only holds the three model weight files**
(`det_model.onnx`, `rec_model.onnx`, `ppocr_keys_v1.txt`). Those are multi-MB binary
assets deliberately kept *out* of the JS bundle so the app's initial load stays small
— this code `fetch()`s them lazily at runtime (the first time `runIdOcr()` needs them)
and caches them in the browser. Don't put the TypeScript/compiled JS in that bucket;
don't put the model weights in your app bundle.

`onnxruntime-web`'s `.wasm` binaries are a third, separate thing this code needs at
runtime (see step 2 below) — neither app code nor a PaddleOCR model, just static
assets to host wherever you serve the rest of your app's static files from.

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

## Try it locally first

Before wiring this into your app, run the included demo page to confirm the pipeline
actually works end-to-end against your bucket:

```sh
npm install
npm run example   # starts a local dev server and opens example/index.html
```

Pick a front (and optional back) image of an already-cropped ID and click "Run OCR" —
the page calls the exact same `runIdOcr`/`mergeIdOcrResults` functions your app will,
and prints the resulting JSON. It needs step 1 above done (public bucket) to actually
produce output; if that step isn't done yet, the page still loads, but OCR calls will
fail with a fetch error naming the model URL that couldn't be reached — which itself
confirms whether bucket access is the problem. See `example/main.ts` for the ~20 lines
of wiring it takes.

## Usage

```ts
import { configureOrtWasmPaths, runIdOcr, mergeIdOcrResults } from "id-ocr-web";

configureOrtWasmPaths("/onnxruntime-wasm/"); // wherever you host the .wasm files

// `frontImage`/`backImage` are already-cropped/edge-straightened captures
// (Blob, HTMLImageElement, HTMLCanvasElement, or ImageBitmap).
const front = await runIdOcr(frontImage, "FRONT");
const back = await runIdOcr(backImage, "BACK");

const result = mergeIdOcrResults([front, back]);
// result is a plain JS object matching schema/ph-id-schema.json - JSON.stringify(result)
// is exactly the payload to send wherever this needs to go next.
```

Call `runIdOcr` with just the front image (`mergeIdOcrResults([front])`) if a
document type has no useful text on the back.

## Output

`mergeIdOcrResults()` returns a plain object matching
[`schema/ph-id-schema.json`](schema/ph-id-schema.json) — the exact schema you gave me —
so `JSON.stringify(result)` is the payload. The `PhIdOcrResult` TypeScript type in
[`src/types.ts`](src/types.ts) is a hand-written mirror of that same schema (so you get
autocomplete/type-checking on the result), not a separate format. Example output for a
driver's license scanned front-only:

```json
{
  "id_type": "DRIVERS_LICENSE",
  "common_fields": {
    "first_name": { "value": "JUAN", "confidence": 0.94, "source_side": "FRONT", "bounding_box": [120, 88, 240, 110] },
    "last_name": { "value": "DELA CRUZ", "confidence": 0.93, "source_side": "FRONT", "bounding_box": [120, 60, 310, 82] },
    "date_of_birth": { "value": "01/15/1990", "confidence": 0.91, "source_side": "FRONT", "bounding_box": [120, 140, 230, 160] },
    "sex": { "value": "M", "confidence": 0.88, "source_side": "FRONT", "bounding_box": [120, 170, 145, 190] }
  },
  "variant_fields": {
    "id_number": { "value": "N01-23-456789", "confidence": 0.9, "source_side": "FRONT", "bounding_box": [120, 200, 260, 220] },
    "expiry_date": { "value": "01/15/2028", "confidence": 0.87, "source_side": "FRONT", "bounding_box": [120, 230, 230, 250] }
  },
  "document_provenance": [
    { "side": "FRONT", "image_hash": "9f2e...c1a4", "raw_ocr_text": "...", "engine_version": "id-ocr-web/ppocrv5-mobile-onnxruntime-web@1.0.0" }
  ]
}
```

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
