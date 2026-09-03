import { configureOrtWasmPaths, runIdOcr, mergeIdOcrResults } from "../src/index";

// onnxruntime-web's wasm binaries, served from a CDN for this example so it runs with
// zero extra setup. In your real app, host these yourself instead (README setup step 2)
// rather than depending on a third-party CDN at runtime.
configureOrtWasmPaths("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/");

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
    output.textContent = JSON.stringify(mergeIdOcrResults(results), null, 2);
  } catch (err) {
    output.textContent = `Error: ${(err as Error).message}`;
    console.error(err);
  }
});
