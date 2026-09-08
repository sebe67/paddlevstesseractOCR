// Drives the real browser demo (example/) with Playwright against specimen ID images
// under specimens/<ID_TYPE>/<case>/, comparing extracted fields to a hand-authored
// expected.json ground truth. This is the automated counterpart to the manual
// "run npm run example, paste the JSON back" workflow used for every bug fixed in this
// project so far - once a specimen and its ground truth are on disk, re-checking it
// (e.g. after a fieldExtraction.ts change) is one command instead of a manual repro,
// and every specimen gets re-checked together instead of one at a time.
//
// This calls the exact same runIdOcr()/mergeIdOcrResults() pipeline as a real user's
// browser, through the same demo page, in a real Chromium - not a mock. It needs
// network access to fetch onnxruntime-web's WASM binaries and the det/rec model files
// (see src/config.ts's DEFAULT_MODEL_BASE_URL), same as the demo does in a normal
// browser.
//
// Specimen images are real ID photos - even "specimen"/sample ones found online may
// depict a real person - so specimens/**/*.{jpg,jpeg,png,webp} is gitignored and never
// committed. Only the directory structure and hand-written expected.json ground truth
// (which should itself avoid storing anything a real specimen didn't already make
// public) are tracked.
//
// Usage: npm run test:specimens
import { createServer } from "vite";
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const specimensDir = path.resolve(rootDir, "specimens");
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function findImage(dir, base) {
  for (const ext of IMAGE_EXTENSIONS) {
    const p = path.join(dir, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function discoverCases() {
  if (!fs.existsSync(specimensDir)) return [];
  const cases = [];
  for (const idType of fs.readdirSync(specimensDir)) {
    const idTypeDir = path.join(specimensDir, idType);
    if (!fs.statSync(idTypeDir).isDirectory()) continue;
    for (const caseName of fs.readdirSync(idTypeDir)) {
      const caseDir = path.join(idTypeDir, caseName);
      if (!fs.statSync(caseDir).isDirectory()) continue;
      const front = findImage(caseDir, "front");
      if (!front) continue;
      const back = findImage(caseDir, "back");
      const expectedPath = path.join(caseDir, "expected.json");
      const expected = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, "utf8")) : null;
      cases.push({ idType, caseName, front, back, expected });
    }
  }
  return cases;
}

function normalizeValue(v) {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : v;
}

function diffFields(actualGroup, expectedGroup) {
  const results = [];
  for (const [field, expectedValue] of Object.entries(expectedGroup ?? {})) {
    const actualValue = actualGroup?.[field]?.value ?? null;
    results.push({ field, expected: expectedValue, actual: actualValue, ok: normalizeValue(actualValue) === normalizeValue(expectedValue) });
  }
  return results;
}

async function runCase(page, baseUrl, testCase) {
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.setInputFiles("#front", testCase.front);
  if (testCase.back) await page.setInputFiles("#back", testCase.back);
  await page.click("#run");
  await page.waitForFunction(
    () => {
      const text = document.querySelector("#output")?.textContent ?? "";
      return text !== "Running..." && text !== "(waiting)";
    },
    { timeout: 90000 },
  );
  const outputText = await page.textContent("#output");
  if (outputText.startsWith("Error:")) return { error: outputText };
  try {
    return { payload: JSON.parse(outputText) };
  } catch (err) {
    return { error: `Could not parse output as JSON: ${err.message}\n${outputText.slice(0, 500)}` };
  }
}

async function main() {
  const cases = discoverCases();
  if (cases.length === 0) {
    console.log(
      "No specimens found under specimens/<ID_TYPE>/<case>/front.<ext> - nothing to run.\n" +
        "See specimens/README.md for how to add one.",
    );
    return;
  }

  console.log(`Found ${cases.length} specimen case(s). Starting dev server...\n`);
  const server = await createServer({
    root: path.resolve(rootDir, "example"),
    server: { fs: { allow: [rootDir] } },
    logLevel: "silent",
  });
  await server.listen();
  const baseUrl = `http://localhost:${server.httpServer.address().port}/`;

  const browser = await chromium.launch();
  const page = await browser.newPage();

  let totalFields = 0;
  let totalMatched = 0;
  const byIdType = new Map();

  for (const testCase of cases) {
    process.stdout.write(`--- ${testCase.idType}/${testCase.caseName} `);
    const result = await runCase(page, baseUrl, testCase);
    if (result.error) {
      console.log("ERROR");
      console.log(`    ${result.error}`);
      continue;
    }

    console.log(`(detected id_type: ${result.payload.id_type})`);

    if (!testCase.expected) {
      console.log("    no expected.json - ran OCR only, nothing to compare against.");
      continue;
    }

    const diffs = [...diffFields(result.payload.common_fields, testCase.expected.common_fields), ...diffFields(result.payload.variant_fields, testCase.expected.variant_fields)];
    if (testCase.expected.id_type) {
      diffs.unshift({ field: "id_type", expected: testCase.expected.id_type, actual: result.payload.id_type, ok: testCase.expected.id_type === result.payload.id_type });
    }

    const stats = byIdType.get(testCase.idType) ?? { matched: 0, total: 0 };
    for (const d of diffs) {
      totalFields++;
      stats.total++;
      if (d.ok) {
        totalMatched++;
        stats.matched++;
      }
      console.log(`    ${d.ok ? "PASS" : "FAIL"}  ${d.field}: got ${JSON.stringify(d.actual)}, expected ${JSON.stringify(d.expected)}`);
    }
    byIdType.set(testCase.idType, stats);
  }

  await browser.close();
  await server.close();

  console.log("\n=== Summary ===");
  for (const [idType, stats] of byIdType) {
    console.log(`  ${idType}: ${stats.matched}/${stats.total} fields matched`);
  }
  if (totalFields > 0) {
    console.log(`  TOTAL: ${totalMatched}/${totalFields} fields matched (${((totalMatched / totalFields) * 100).toFixed(1)}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
