# id-ocr-web

Client-side (browser) OCR + field extraction for Philippine ID scans. Runs entirely
on-device via [`onnxruntime-web`](https://github.com/microsoft/onnxruntime) (WASM
backend) using PaddleOCR PP-OCRv5 mobile detection/recognition models — the image
never leaves the device. The only network calls are the initial (cached) downloads of
the three model assets from a public GCS bucket.

## Status — read this before integrating

- **The `idscan_ocr` bucket is not yet public.** All three model URLs currently return
  403 to an anonymous fetch. This repo/module has no GCP credentials and cannot change
  bucket IAM itself — someone with access to the `idscan_ocr` bucket needs to run:
  ```sh
  gsutil iam ch allUsers:objectViewer gs://idscan_ocr
  ```
  (or set equivalent object-level ACLs). Until this is done, nothing in this module can
  run past the initial model fetch.
- **The dictionary filename was wrong and has been fixed.** `config.ts` previously
  pointed at `ppocr_keys_v1.txt` (6,623 entries — the PP-OCRv3/v4 dictionary). The rec
  model this module targets is PP-OCRv5 mobile, whose correct dictionary is
  `ppocrv5_dict.txt` (18,383 entries, confirmed against PaddleOCR's own repo). `config.ts`
  now requests `ppocrv5_dict.txt` — **make sure that file (not `ppocr_keys_v1.txt`) is
  what's actually uploaded to the bucket under that name.** This was caught by a
  code-review comparison of entry counts, not by running the pipeline (see below) — if
  your `rec_model.onnx` turns out to actually be a v3/v4 export rather than v5, it's the
  dictionary claim that's wrong, not this fix; see "how to check" below.
- **This has never been run end-to-end against real model weights.** Everything here
  was built, typechecked, and build-verified (`tsc --noEmit`, `vite build` resolving all
  imports) in an environment with no browser and no access to the actual `idscan_ocr`
  bucket contents — so the *code* compiles and the *wiring* resolves, but the
  detection/recognition math has not been validated against real ONNX outputs. Once the
  bucket is public, running `npm run example` against a real ID photo is the first real
  end-to-end test this pipeline will get. Please report back what breaks.

**How to check the rec model's actual version**, once you can read the bucket: open
`rec_model.onnx` in [Netron](https://netron.app/) (drag-and-drop, no install) and check
the final output node's shape — the last dimension is the class count. It should read
18,383 (+ blank + space = charset length in `recognize.ts`) if this is genuinely
PP-OCRv5 mobile. If it reads ~6,625 instead, the model is actually v3/v4 and
`ppocr_keys_v1.txt` was the correct file all along — flip `config.ts` back and let me
know so I can also fix the README/comments claiming this is v5 throughout.

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
(`det_model.onnx`, `rec_model.onnx`, `ppocrv5_dict.txt`). Those are multi-MB binary
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
   `rec_model.onnx`, and `ppocrv5_dict.txt` must be publicly readable
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
autocomplete/type-checking on the result), not a separate format — and now actually
enforces the schema's `required: ["first_name", "last_name", "date_of_birth"]` at the
type level: `PhIdOcrResult.common_fields` is `RequiredCommonFields`, not the looser
`CommonFields` used for a single side's in-progress result, so code that tries to send
an incomplete object fails to compile instead of failing server-side with a 422.

**Open question, not yet answered**: when OCR genuinely cannot read one of those three
required fields, `mergeIdOcrResults()` fills it with `{ value: "", confidence: 0 }`
rather than a null or omitting it (since the schema requires the key to exist).
Whether that's actually what `/api/v1/register` wants signaled for "could not read
this" — versus, say, rejecting the submission client-side before it's ever sent, or a
different sentinel value — needs an answer from whoever owns `registration-service`;
it's not something this repo can determine on its own. Example output for a driver's
license scanned front-only:

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
   decoding against `ppocrv5_dict.txt`.
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
- **Untested against real model weights at runtime** — see the Status section at the
  top; this is the single biggest open risk and the reason to run `npm run example`
  against a real scan before building further on top of this.
- **No batching** — each detected text line runs through the rec model one at a time.
  Fine for a single ID scan; worth batching if you see this pipeline used somewhere
  latency-sensitive with many lines.
