import { configureOrtWasmPaths, runIdOcr, mergeIdOcrResults } from "../src/index";

// onnxruntime-web's wasm binaries, served from a CDN for this example so it runs with
// zero extra setup. In your real app, host these yourself instead (README setup step 2)
// rather than depending on a third-party CDN at runtime.
//
// IMPORTANT: this version number must exactly match the onnxruntime-web version actually
// installed (package.json's "dependencies") - a mismatch between the JS bindings and the
// WASM binary throws opaque errors deep in their interop layer (e.g. "X.getValue is not a
// function"). package.json now pins an exact version specifically to prevent this drifting
// apart silently on a fresh `npm install`.
configureOrtWasmPaths("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/");

const frontInput = document.querySelector<HTMLInputElement>("#front")!;
const backInput = document.querySelector<HTMLInputElement>("#back")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const output = document.querySelector<HTMLPreElement>("#output")!;

runButton.addEventListener("click", async () => {
  const frontFile = frontInput.files?.[0];
  const backFile = backInput.files?.[0];
  if (!frontFile) {
    output.textContent = "Pick a front image first.";
    return;
  }

  output.textContent = "Running...";
  try {
    const results = [await runIdOcr(frontFile, "FRONT")];
    if (backFile) results.push(await runIdOcr(backFile, "BACK"));

    // `debug_lines` isn't part of the ph-id-schema payload (mergeIdOcrResults strips
    // it) - it's every text line the detector found on each side, label lines
    // included, with its own bounding box. When a field comes out wrong, the box on
    // the wrong value alone often isn't enough to tell whether the bug is in label
    // matching, position, or something else; the full line list is what a bug report
    // actually needs to diagnose it precisely instead of guessing at positions.
    const payload = {
      ...mergeIdOcrResults(results),
      debug_lines: Object.fromEntries(results.map((r) => [r.provenance.side, r.lines])),
    };
    output.textContent = JSON.stringify(payload, null, 2);
  } catch (err) {
    output.textContent = `Error: ${(err as Error).message}`;
    console.error(err);
  }
});
