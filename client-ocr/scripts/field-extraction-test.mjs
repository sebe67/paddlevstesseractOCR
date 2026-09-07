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

// === Real-photo regression test ===
// A second, real driver's-license photo (not the specimen) came back with several
// fields still wrong or empty: "Sex" OCR'd as "SRX", "Date of Birth" as "Date af
// Birth", the merged name label as "Last Name.Fint Nama.Middie Name" (worse than the
// specimen's version - the remainder no longer even starts with a clean "First Name"),
// and the License No./Expiration Date values fused by the text detector into one line,
// "N01-25-0235302030/04/10", instead of two. All of this is the real misread text from
// that report's raw_ocr_text; the bounding boxes are representative placements in the
// same row/column shape (this report only included field-level boxes for whichever line
// each field wrongly grabbed, not a full per-line box dump), since what's being tested
// here is the fuzzy label matching, nearest-column grid pairing, and the compound-value
// split, not position. "Nationality"'s label was garbled past recovery too, down to just
// "Ma" - included here unmatched, on purpose: its value ("PHL") still sits in the value
// row even though its own label never resolves to a field, which is exactly the case
// that broke rank-based label/value pairing (see resolveGridRows's nearest-column
// comment) before this fix.
const realPhotoLines = [
  line("Last Name.Fint Nama.Middie Name", [50, 60, 500, 78]),
  line("SILVA, SEBASTIAN VINCENT PABLO QUE", [50, 90, 400, 108]),

  line("Ma", [200, 130, 230, 148]),
  line("SRX", [240, 130, 270, 148]),
  line("Date af Birth", [280, 130, 410, 148]),
  line("PHL", [206, 160, 236, 178]),
  line("M", [246, 160, 264, 178]),
  line("2008/04/10", [286, 160, 366, 178]),

  line("N01-25-0235302030/04/10", [200, 300, 450, 318]),
];

const realPhotoResult = extractFields(realPhotoLines, "DRIVERS_LICENSE", "FRONT");

console.log("\n=== Real-photo regression test (garbled labels + fused id/expiry line) ===\n");
let realPhotoPass = true;
realPhotoPass = check("sex", realPhotoResult.common_fields.sex?.value, "M") && realPhotoPass;
realPhotoPass = check("date_of_birth", realPhotoResult.common_fields.date_of_birth?.value, "2008/04/10") && realPhotoPass;
realPhotoPass =
  check("last_name", realPhotoResult.common_fields.last_name?.value, "SILVA, SEBASTIAN VINCENT PABLO QUE") &&
  realPhotoPass;
realPhotoPass = check("id_number", realPhotoResult.variant_fields.id_number?.value, "N01-25-023530") && realPhotoPass;
realPhotoPass = check("expiry_date", realPhotoResult.variant_fields.expiry_date?.value, "2030/04/10") && realPhotoPass;

console.log(`\n${realPhotoPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!realPhotoPass) {
  console.log("\nFull output:", JSON.stringify(realPhotoResult, null, 2));
}

allPass = allPass && realPhotoPass;

// === Implausible-value rejection test ===
// A third real run of the same specimen card (after the fixes above) came back with
// three fields resolved to values that were simply the nearest unused line, with nothing
// checking whether they looked anything like a plausible value: last_name resolved to
// the text "Nationality" (another field's own label - real box confirmed in that
// report), weight resolved to the address placeholder line ("UNIT/HOUSE NO.BUILDING,
// STREET NAME,"), and expiry_date resolved to a single stray character ("h"). Each
// scenario places the wrong-but-nearer candidate closer to the label than the real
// value, so a pass proves the value is rejected on its own merits, not just losing a
// distance tiebreak. Run as three separate extractFields() calls, each with its own
// `lines` array - not one combined array like the scenarios above - because "Nationality"
// (used here to test last_name's rejection of it) is itself a real label for the actual
// nationality field, and having all three cases share one array let the nationality
// field, quietly resolving in the background, scavenge "70" as its own value.
function checkImplausible(name, testLines, field, target, expected) {
  const result = extractFields(testLines, "DRIVERS_LICENSE", "FRONT");
  const actual = target === "common" ? result.common_fields[field]?.value : result.variant_fields[field]?.value;
  const ok = check(name, actual, expected);
  if (!ok) console.log("  Full output:", JSON.stringify(result, null, 2));
  return ok;
}

console.log("\n=== Implausible-value rejection test ===\n");
let implausibleValuePass = true;
implausibleValuePass =
  checkImplausible(
    "last_name",
    [
      line("Last Name. First Name.Middle Name", [50, 60, 500, 78]),
      line("Nationality", [218.4600802854594, 165.9444263363755, 278.9083407671722, 181.96422750977837]), // real wrong-candidate box
      line("DELA CRUZ, JUAN PEDRO GARCIA", [50, 190, 400, 208]), // farther below, but the real value
    ],
    "last_name",
    "common",
    "DELA CRUZ, JUAN PEDRO GARCIA"
  ) && implausibleValuePass;
implausibleValuePass =
  checkImplausible(
    "weight",
    [
      line("Weight(kg)", [433, 400, 510, 418]),
      line("UNIT/HOUSE NO.BUILDING, STREET NAME,", [433, 430, 700, 448]), // closer, but not numeric
      line("70", [433, 460, 460, 478]), // farther, but the real value
    ],
    "weight",
    "variant",
    "70"
  ) && implausibleValuePass;
implausibleValuePass =
  checkImplausible(
    "expiry_date",
    [
      line("Expiration Date", [433, 500, 560, 518]),
      line("h", [433, 530, 450, 548]), // closer, but not date-shaped
      line("2022/10/04", [433, 560, 513, 578]), // farther, but the real value
    ],
    "expiry_date",
    "variant",
    "2022/10/04"
  ) && implausibleValuePass;

console.log(`\n${implausibleValuePass ? "ALL PASSED" : "SOME FAILED"}`);

allPass = allPass && implausibleValuePass;
process.exit(allPass ? 0 : 1);
