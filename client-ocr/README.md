# id-ocr-web

Client-side (browser) OCR + field extraction for Philippine ID scans. Runs entirely
on-device via [`onnxruntime-web`](https://github.com/microsoft/onnxruntime) (WASM
backend) using genuine PaddleOCR PP-OCRv5 mobile detection/recognition models — the
image never leaves the device. The only network calls are the initial (cached)
downloads of the model assets from a public GCS bucket.

## Status — read this before integrating

- **Now running genuine PP-OCRv5 mobile models, confirmed** — `idscan_ocr/v1.1/`
  (`config.ts`'s `DEFAULT_MODEL_BASE_URL`). Downloaded the real `rec_model.onnx` and
  inspected its ONNX graph directly: output layer is 18,385-wide, exactly matching
  `ppocrv5_dict.txt`'s 18,383 entries + blank + space. (`v1.0/`, the previous default,
  turned out to be a PP-OCRv3/v4-generation model despite its naming — see git history
  if you need that story. It's still in the bucket but no longer the default.)
- **Run end-to-end against these exact v1.1 weights** via `npm run check:live-models`
  (see below) — correctly detected and decoded a test string with 0.985 confidence.
  That validates detection, the from-scratch DB post-processing geometry, cropping, and
  CTC decoding all at once, against the real deployed files, not a guess.
- **Tested against a real DRIVERS_LICENSE FRONT photo** (via `npm run example`, outside
  this environment, which has no camera/browser). Recognition itself worked — every
  wrong/missing field traced back to `fieldExtraction.ts`, not the det/rec models. Real
  issues found and fixed: label text garbled character-by-character by recognition noise
  ("Sex" → "SRX", "Date of Birth" → "Date af Birth", "First Name" → "Fint Nama") that
  exact substring matching couldn't survive — now handled by fuzzy (edit-distance)
  label matching; a label recognized well enough to *steal* a short field's match by
  coincidence (see `fuzzyMatchPrefix`'s comment in `fieldExtraction.ts` for the "sex"
  vs. "Expiration Date" false-positive this guards against); a label garbled past any
  recovery ("Nationality" → "Ma") while its value stayed put in the row, which broke the
  grid-row matcher's rank-based label/value pairing — now paired by nearest column
  instead; and the text detector fusing two adjacent cells (License No. + Expiration
  Date) into one OCR line — recovered by pattern-matching the fused shape directly in
  `splitCompoundIdExpiry`. A later run of the same card surfaced a different class of
  bug: fields resolving to whatever unused line was geometrically nearest, with nothing
  checking whether it was a *plausible* value at all — `last_name` resolved to the text
  "Nationality" (literally another field's own label), `weight` resolved to an address
  placeholder line, `expiry_date` resolved to a single stray character. Fixed with two
  general checks in `fieldExtraction.ts`: `isLabelOnlyText` rejects a candidate that's
  itself, in full, some other field's label, and `FIELD_VALUE_VALIDATORS` rejects a
  candidate that doesn't even look like the right shape (weight/height must be numeric,
  dates must look date-shaped) before accepting it — trying the next-nearest candidate
  instead of settling for a bad one. A fourth run of the same card, with those fixes in
  place, came back with every field correct except one: the printed name resolves as
  one comma-separated line ("DELA CRUZ, JUAN PEDRO GARCIA") — PH IDs' standard
  `"LASTNAME, FIRSTNAME MIDDLENAME"` format — which was being kept whole as `last_name`,
  leaving `first_name`/`middle_name` empty. Fixed with `splitCommaSeparatedName`, a
  dedicated post-process step; split from the *end* of the part after the comma, not the
  start — Philippine naming convention has a single-word middle name (customarily the
  mother's maiden surname) with the given name itself free to be more than one word, so
  "JUAN PEDRO GARCIA" is first_name "JUAN PEDRO" + middle_name "GARCIA", not the other
  way around. This run also confirmed the position template (`nationality`, `sex`,
  `date_of_birth`, `id_number`, `blood_type`, `license_restrictions`) and the generic
  label/grid-row/plausibility logic all held up together on a real, complete detection
  pass — not just each fix in isolation. Still unvalidated: any id_type other than
  DRIVERS_LICENSE, and the BACK side.
- **Confidence scores are now meaningful** (fixed while validating v1.0, and re-confirmed
  against v1.1's differently-named output tensor). Some PaddleOCR rec exports apply
  softmax internally, in which case using the raw output values as confidence directly
  is correct; `recognize.ts` now auto-detects this per-timestep (checks whether a row
  already sums to ~1) rather than assuming, so it works correctly across both the v1.0
  and v1.1 model exports despite their different internal op-naming conventions.

## Run the field-extraction regression test

```sh
npm install
npm install --save-dev tsx
npm run test:field-extraction
```

Pure logic test (no model, no browser, no network) with five scenarios, each
reproducing a real bug report:

1. Several short field labels printed in a row with a matching value row below (e.g.
   "Nationality / Sex / Date of Birth"), a label with an inline unit suffix ("Weight
   (kg)"), and a merged label line ("Last Name. First Name.Middle Name" — the
   "First Name" remainder left after stripping the "Last Name" prefix is itself another
   field's label, not a value).
2. `idTemplates.ts`'s position-based matching, directly against that same bug report's
   real, unshifted coordinates, with **no label lines present at all** — the actual
   failure mode, since the labels on that card were misread too badly for label-matching
   alone to ever fix.
3. A second real photo's specific failures: labels garbled character-by-character
   ("Sex" → "SRX", "Date of Birth" → "Date af Birth", the merged name label → "Last
   Name.Fint Nama.Middie Name"), a label garbled past recovery while its value stayed in
   the row (breaks rank-based label/value pairing if not paired by nearest column
   instead), and two adjacent cells (License No. + Expiration Date) fused into one OCR
   line by the text detector.
4. A third run of the same card resolving fields to whatever unused line was nearest,
   without checking whether it was even a plausible value: `last_name` grabbing the
   literal text "Nationality" (another field's own label), `weight` grabbing an address
   placeholder line, `expiry_date` grabbing a single stray character.
5. A full end-to-end replay of every line a real run actually detected on the specimen
   card at once (not a reconstructed subset) — including that the printed name comes as
   one comma-separated line, `"LASTNAME, FIRSTNAME MIDDLENAME"`, that needs splitting
   into `last_name`/`first_name`/`middle_name` rather than being kept whole as
   `last_name` with `first_name` left empty.

Fast to re-run any time `fieldExtraction.ts` or `idTemplates.ts` changes — worth running
before trusting a change to the field-matching logic, since this kind of bug doesn't show
up as a crash, just confidently-wrong output.

## Run the live model check

This needs two extra dev tools (`tsx` to run TypeScript directly, `sharp` for image
decoding) that aren't part of the default install, since they're only needed for this
one verification script, not for actually using the library or running the demo:

```sh
npm install
npm install --save-dev tsx sharp
npm run check:live-models
```

Fetches the real `det_model.onnx`/`rec_model.onnx`/dictionary from the live bucket and
runs them (via `onnxruntime-web`'s wasm backend, in plain Node — no browser required)
against a synthetic "DELA CRUZ" text image, reusing the real detection geometry from
`src/geometry.ts` unmodified. Prints the detected box, decoded text, and confidence —
currently decodes correctly with confidence 0.985. Re-run this any time the bucket's
model files change, as a fast sanity check before touching a real ID scan. See
`scripts/live-model-check.mjs`.

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
(`det_model.onnx`, `rec_model.onnx`, `ppocrv5_dict.txt`, all under a `v1.1/` prefix).
Those are multi-MB binary
assets deliberately kept *out* of the JS bundle so the app's initial load stays small
— this code `fetch()`s them lazily at runtime (the first time `runIdOcr()` needs them)
and caches them in the browser. Don't put the TypeScript/compiled JS in that bucket;
don't put the model weights in your app bundle.

`onnxruntime-web`'s `.wasm` binaries are a third, separate thing this code needs at
runtime (see step 2 below) — neither app code nor a PaddleOCR model, just static
assets to host wherever you serve the rest of your app's static files from.

## Setup

1. ~~Make the model files public-read~~ **Done** — confirmed via anonymous fetch.
   `cls_model.onnx` is uploaded too but not used by this module — orientation
   classification is skipped since input images already arrive
   edge-straightened/upright.
2. **Host `onnxruntime-web`'s `.wasm` binaries** somewhere your app serves static
   assets from (they ship in `node_modules/onnxruntime-web/dist/`), or point at a CDN
   build. Call `configureOrtWasmPaths(url)` once at app startup before the first
   `runIdOcr` call.

   **The version in that URL/path must exactly match the `onnxruntime-web` version in
   your `package.json`.** A mismatch doesn't fail cleanly — it throws opaque errors deep
   in their JS/WASM interop layer (e.g. `"X.getValue is not a function"`), because the JS
   bindings and the WASM binary disagree about each other's internal structure. This is
   exactly what happens if `onnxruntime-web` is left as a version *range* (`^1.19.2`) in
   `package.json` — a plain `npm install` months later can silently resolve to a much
   newer version than whatever's hardcoded in your `configureOrtWasmPaths` call. That's
   why `package.json` here pins an exact version rather than a range; keep it that way,
   and update both places together if you ever bump it.
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

The printed JSON also includes a `debug_lines` key (not part of the real
`ph-id-schema` payload — `mergeIdOcrResults` doesn't produce it, the demo adds it on
top) with every text line the detector found on each side, label lines included, each
with its own bounding box. If a field comes out wrong, include this in a bug report
alongside the rest of the output: the box on just the one wrong value is often not
enough to tell whether the bug is in label matching, position, or something else, and
guessing at other lines' positions from context (as several fixes so far had to)
is a lot less reliable than having the real ones.

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

**Confirmed**: when OCR genuinely cannot read one of those three required fields,
`mergeIdOcrResults()` fills it with `{ value: "", confidence: 0 }` rather than a null
or omitting it (since the schema requires the key to exist) — a total OCR failure
produces the minimum-required, mostly-empty shape rather than a bloated one. Example
output for a driver's license scanned front-only:

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

## Sending to registration-service

`src/registration.ts` is a small, separate module (not part of the core OCR pipeline
— `runIdOcr`/`mergeIdOcrResults` never call it) that POSTs a result to
`registration-service`'s `/api/v1/register`:

```ts
import { registerId, RegistrationError } from "id-ocr-web";

try {
  const response = await registerId(result); // result = mergeIdOcrResults(...) output
  console.log(response.status, response.message, response.id_type);
} catch (err) {
  if (err instanceof RegistrationError) {
    console.error(`registration-service ${err.httpStatus}:`, err.body);
  } else {
    throw err;
  }
}
```

**What this does and doesn't cover, as of the latest contract round-trip:**
- Confirmed and implemented: the request envelope is exactly `{ "id_data": <payload> }`
  (no other top-level keys — sending extras today would silently vanish rather than
  error, since the service doesn't yet reject unknown properties), and the 201
  response is `{ status, message, id_type }` with no ID or timestamp.
- **Deliberately not implemented yet**: a `client_reference` and `consent` field on
  the request, and a `registration_id`/`created_at` on the response. Both are agreed
  to be needed (see the questions sent back to the service owner) but aren't live on
  the service yet — `RegistrationEnvelope`/`RegistrationSuccessResponse` in
  `registration.ts` intentionally don't include them, specifically so nothing here can
  silently rely on fields the server will just drop. Once the service's contract
  actually declares them, extend both types and `registerId`'s signature together.
- No authentication is sent, matching the service's current (unauthenticated) state —
  update this once auth is added server-side.
- There's currently no way to look up a submission after `registerId()` returns — no
  registration ID comes back, and there's no documented read path. Don't build any
  "check on this submission later" flow on top of this until that's resolved.

## How it works

1. **Detect** (`det_model.onnx`, DB-based) — probability map → threshold → connected
   components → `minAreaRect` per blob → score/size filter → unclip → text-line boxes.
2. **Crop & straighten** each box out of the source image via a two-triangle affine
   warp (`perspective.ts`), then **recognize** (`rec_model.onnx`) with greedy CTC
   decoding against `ppocrv5_dict.txt`.
3. **Classify `id_type`** via keyword hits across the recognized text (override with
   `runIdOcr(image, side, { idType: "PASSPORT" })` if the caller already knows it).
4. **Extract fields** (`fieldExtraction.ts`): for `id_type` + side combinations with a
   known-good position template (`idTemplates.ts`), match template fields first by
   location alone — no label text needed, so this still works when a label was
   misread or merged with a neighbor. Everything the template doesn't cover falls back
   to label matching: each field's label aliases (English + Filipino) are matched
   against recognized lines — tolerating some recognition noise via edit-distance
   fuzzy matching (`fuzzyMatchPrefix`), not just an exact substring — and the value is
   taken from the same line or the nearest line to the right/below, with the line's
   bounding box attached, but only if that candidate actually looks like a plausible
   value for the field: not itself just another field's label (`isLabelOnlyText`), and
   matching the field's expected shape where one exists (`FIELD_VALUE_VALIDATORS` —
   weight/height numeric, dates date-shaped). Rows of short labels with a value row
   below them are matched by nearest column, not left-to-right rank, so one label in
   the row failing to match at all doesn't shift every field after it onto the wrong
   value. Two pattern-based passes run last: `splitCompoundIdExpiry` recovers
   `id_number`/`expiry_date` when the text detector fuses their two cells into one OCR
   line, and `splitCommaSeparatedName` splits the printed name — one line, PH IDs'
   standard `"LASTNAME, FIRSTNAME MIDDLENAME"` format — into `last_name`/`first_name`/
   `middle_name` rather than leaving it whole as `last_name`. For `PASSPORT`, also
   parses the TD3 MRZ and uses it (checksum-validated) to fill in anything
   template/label-matching missed.

## Known approximations / next steps for your team

- **DB unclip** offsets each detected box as a rectangle (exact for a `minAreaRect`
  output) rather than pulling in a full polygon-clipping library — matches PaddleOCR's
  default `box_type="quad"` behavior; swap in a real polygon clipper if you start
  seeing curved/irregular text blobs it doesn't handle well.
- **Position templates** (`idTemplates.ts`) currently cover only six fields on
  `DRIVERS_LICENSE`/`FRONT` (`nationality`, `sex`, `date_of_birth`, `id_number`,
  `blood_type`, `license_restrictions`), taken from one real specimen scan (600×410px,
  confirmed in a bug report) — the only fields with a real, confirmed-correct bounding
  box to build a region from. Deliberately left out of that template: `weight`,
  `height`, `expiry_date`, `address`, and the name fields — those still fall back to
  label matching, which is a real gap for `address`/`weight`/`height`/`expiry_date`
  (no confirmed-good position for them yet) and mostly moot for the name fields, since
  the merged-label fix above now separates the "Last Name"/"First Name" labels from
  each other without needing a template at all. Add more field regions here (or a
  template for another id_type/side) as real, confirmed-correct bounding boxes turn
  up — normalize pixel coordinates against the specimen's actual image dimensions the
  same way the existing entries do; don't guess at a region without one, since a wrong
  position is worse than no template (it silently claims the line before label-matching
  ever gets a chance to try).
- **`id_type` detection and field-label aliases** (`idTypeAliases.ts`) are a starting
  point covering the 12 PH ID types you specified; PHILSYS/UMID/PRC/POSTAL/VOTERS/SSS/
  TIN/PHILHEALTH weren't part of the original PaddleOCR-vs-Tesseract benchmark, so
  expect to expand these lists once you're testing against real cards.
- **SENIOR_CITIZEN and PWD IDs are issued per-LGU**, not by one national agency —
  layout and label wording vary by city/municipality far more than the other types
  here. Field recall on these two will likely be lower regardless of tuning; the
  keyword-based (rather than fixed-position) extraction approach here is meant to be
  the more robust choice for that reason.
- **Validated against a synthetic test string, not yet a real ID photo.** See Status
  above — `npm run check:live-models` proves the pipeline works against the real
  deployed weights, but a clean rendered "DELA CRUZ" string is a much easier case than
  a real photo (perspective distortion, glare, lower contrast, a laminated/glossy
  surface). Running `npm run example` against an actual ID scan is the next real test,
  and the one that will actually tell you what field-recall to expect.
- **No batching** — each detected text line runs through the rec model one at a time.
  Fine for a single ID scan; worth batching if you see this pipeline used somewhere
  latency-sensitive with many lines.
