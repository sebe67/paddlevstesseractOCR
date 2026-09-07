// Regression test reproducing a real driver's-license extraction bug report: multiple
// short field labels in a row (Nationality/Sex/Date of Birth, License No./Expiration
// Date/Agency Code) with a matching value row below, plus a label with an inline unit
// suffix (Weight(kg), Height(m)). Uses the exact value bounding boxes from that bug
// report where available. Pure logic, no model/browser needed - fast to re-run any
// time fieldExtraction.ts changes.
//
// Usage: npm run test:field-extraction
import { extractFields } from "../src/fieldExtraction.ts";

function line(text, box, confidence = 0.95) {
  return { text, confidence, boundingBox: box };
}

const lines = [
  // --- Nationality / Sex / Date of Birth row (label row, y ~130-148) ---
  // Date of Birth is deliberately WIDE and starts to the left of Sex - this is the exact
  // shape that broke both the original left-edge-distance search and my first attempt
  // at fixing it (which also sorted by left edge).
  line("Nationality", [200, 130, 280, 148]),
  line("Date of Birth", [270, 130, 400, 148]),
  line("Sex", [290, 130, 320, 148]),
  // value row (y ~179-201, real boxes from the bug report)
  line("PHL", [216.43304559977318, 178.92689649045485, 251.6272553598082, 200.79520030087542]),
  line("M", [297.05068779904303, 181.35735358391608, 317.7519437799043, 198.0897618006993]),
  line("1987/10/04", [338.7050860323887, 181.5641179733728, 418.2028087044534, 197.88299741124263]),

  // --- Weight(kg) / Height(m) row (unit-suffix bug), y ~230-252 (real boxes, shifted) ---
  line("Weight(kg)", [433, 230, 510, 252]),
  line("Height(m)", [503, 230, 559, 252]),
  // value row below, y ~262-280
  line("70", [440, 262, 465, 280]),
  line("1.55", [510, 262, 540, 280]),

  // --- License No. / Expiration Date / Agency Code row, y ~330-347 ---
  line("License No.", [190, 330, 280, 347]),
  line("Expiration Date", [300, 330, 430, 347]),
  line("Agency Code", [445, 330, 516, 347]),
  // value row below, y ~360-377 (real id_number box, shifted to this band)
  line("N03-12-123456", [217, 360, 325, 377]),
  line("2022/10/04", [340, 360, 420, 377]),
  line("N32", [440, 360, 470, 377]),

  // --- Merged-label bug: "Last Name" and "First Name" labels run together as one OCR
  // line ("Last Name. First Name.Middle Name"), y ~60-78. The remainder left after
  // stripping the "Last Name" prefix ("First Name.Middle Name") is itself another
  // field's label, not a value - this line should be treated as label-only for
  // last_name, and the real value pulled from the line below it instead.
  line("Last Name. First Name.Middle Name", [50, 60, 300, 78]),
  line("DELA CRUZ", [50, 90, 150, 108]),
];

const { common_fields, variant_fields } = extractFields(lines, "DRIVERS_LICENSE", "FRONT");

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  return ok;
}

console.log("=== Grid-row + unit-suffix regression test ===\n");
let allPass = true;
allPass = check("sex", common_fields.sex?.value, "M") && allPass;
allPass = check("date_of_birth", common_fields.date_of_birth?.value, "1987/10/04") && allPass;
allPass = check("nationality", variant_fields.nationality?.value, "PHL") && allPass;
allPass = check("weight", variant_fields.weight?.value, "70") && allPass;
allPass = check("height", variant_fields.height?.value, "1.55") && allPass;
allPass = check("id_number", variant_fields.id_number?.value, "N03-12-123456") && allPass;
allPass = check("expiry_date", variant_fields.expiry_date?.value, "2022/10/04") && allPass;
allPass = check("last_name", common_fields.last_name?.value, "DELA CRUZ") && allPass;

console.log(`\n${allPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!allPass) {
  console.log("\nFull output:", JSON.stringify({ common_fields, variant_fields }, null, 2));
}

// === Template regression test ===
// Same DRIVERS_LICENSE FRONT bug report, but this time reproducing the actual failure
// mode as closely as possible: only the VALUE lines are present, at their real, unshifted
// bounding boxes from that bug report - no label lines at all. Real cards misread labels
// this badly in practice ("Restnictions", the merged "Last Name. First Name.Middle Name"
// line eating the actual "Nationality"/"Sex"/"Date of Birth" labels' row, etc.), so a fix
// that still depends on reading a label correctly doesn't actually cover this report. The
// position template (idTemplates.ts) is keyed off confirmed real coordinates for exactly
// this id_type + side, and needs no label at all - proving that requires testing it with
// none available.
const templateLines = [
  line("PHL", [216.43304559977318, 178.92689649045485, 251.6272553598082, 200.79520030087542]),
  line("M", [297.05068779904303, 181.35735358391608, 317.7519437799043, 198.0897618006993]),
  line("1987/10/04", [338.7050860323887, 181.5641179733728, 418.2028087044534, 197.88299741124263]),
  line("N03-12-123456", [217.20068892750746, 267.1866495827286, 324.57562686196616, 283.7508504172714]),
  line("O+", [241.69736842105263, 299.5365384615385, 266.52631578947364, 315.46346153846156]),
  line("NONE", [311.84210526315786, 331.1538461538462, 361.1842105263158, 348.8942307692308]),
];

const templateResult = extractFields(templateLines, "DRIVERS_LICENSE", "FRONT", { width: 600, height: 410 });

console.log("\n=== Template regression test (labels absent, real bug-report coordinates) ===\n");
let templatePass = true;
templatePass = check("nationality", templateResult.variant_fields.nationality?.value, "PHL") && templatePass;
templatePass = check("sex", templateResult.common_fields.sex?.value, "M") && templatePass;
templatePass = check("date_of_birth", templateResult.common_fields.date_of_birth?.value, "1987/10/04") && templatePass;
templatePass = check("id_number", templateResult.variant_fields.id_number?.value, "N03-12-123456") && templatePass;
templatePass = check("blood_type", templateResult.common_fields.blood_type?.value, "O+") && templatePass;
templatePass = check("license_restrictions", templateResult.variant_fields.license_restrictions?.value, "NONE") && templatePass;

console.log(`\n${templatePass ? "ALL PASSED" : "SOME FAILED"}`);
if (!templatePass) {
  console.log("\nFull output:", JSON.stringify(templateResult, null, 2));
}

allPass = allPass && templatePass;
process.exit(allPass ? 0 : 1);
