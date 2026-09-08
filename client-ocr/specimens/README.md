# Specimen accuracy tests

This directory holds real (or specimen/sample) ID photos plus hand-authored ground
truth, for `npm run test:specimens` to run through the actual demo in a real browser
(via Playwright) and report per-field accuracy - the automated version of the manual
"run the demo, paste the JSON back" workflow.

Unlike `scripts/field-extraction-test.mjs` (fast, logic-only, runs on hand-crafted OCR
line data, gates every push), this is slower and needs network access to fetch the
OCR models - use it to track accuracy against real specimens over time, not as a
pre-push gate.

## Layout

```
specimens/
  <ID_TYPE>/            e.g. PHILSYS, UMID, PRC, POSTAL, PHILHEALTH, SENIOR_CITIZEN...
    <case-name>/         a short, descriptive name for this specific specimen
      front.jpg           (or .jpeg/.png/.webp) - required
      back.jpg             optional, same extensions accepted
      expected.json         optional ground truth - see below
```

A case with no `expected.json` still runs (useful to eyeball a new specimen's raw
output before you've hand-verified any fields), it just has nothing to compare
against.

## expected.json

Only include fields you've actually verified against the card - an incomplete or
partly-illegible specimen should have a partial `expected.json`, not one padded with
guesses. Unlisted fields are skipped, not treated as "must be empty".

```json
{
  "id_type": "PHILSYS",
  "common_fields": {
    "last_name": "DELA CRUZ",
    "first_name": "JUAN",
    "middle_name": "SANTOS",
    "date_of_birth": "1990/01/15"
  },
  "variant_fields": {
    "id_number": "1234-5678-9012-3456"
  }
}
```

## Privacy

Real ID photos - and most "specimen"/"sample" images found online - can depict a real
person's actual PII. `specimens/**/*.{jpg,jpeg,png,webp}` is gitignored so images
never get committed; only this README and the directory structure/`expected.json`
files (which should themselves avoid copying anything sensitive beyond what's needed
to check the field values) are tracked. Treat every specimen the same way regardless
of source - delete it once you're done if you don't need to keep re-testing against it.

## Running

```
npm run test:specimens
```

Needs network access to fetch onnxruntime-web's WASM binaries and the det/rec model
files (same as the demo does normally) - it drives a real Chromium against the real
`example/` page, not a mock.
