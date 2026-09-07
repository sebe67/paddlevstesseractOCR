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
  // line ("Last Name. First Name.Middle Name"), y ~60-78 (kept well clear of the
  // Nationality/Sex/DOB row above, which uses synthetic - not real - y~130-148
  // coordinates in this scenario), plus the comma-separated name-splitting fix: the
  // real value text below it, "DELA CRUZ, JUAN PEDRO GARCIA", is PH IDs' standard
  // "LASTNAME, FIRSTNAME MIDDLENAME" format on one line, and needs splitting into all
  // three fields, not just accepted whole as last_name.
  line("Last Name. First Name.Middle Name", [50, 60, 300, 78]),
  line("DELA CRUZ, JUAN PEDRO GARCIA", [50, 90, 350, 108]),
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
allPass = check("first_name", common_fields.first_name?.value, "JUAN") && allPass;
allPass = check("middle_name", common_fields.middle_name?.value, "PEDRO GARCIA") && allPass;

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
realPhotoPass = check("last_name", realPhotoResult.common_fields.last_name?.value, "SILVA") && realPhotoPass;
realPhotoPass = check("first_name", realPhotoResult.common_fields.first_name?.value, "SEBASTIAN") && realPhotoPass;
realPhotoPass =
  check("middle_name", realPhotoResult.common_fields.middle_name?.value, "VINCENT PABLO QUE") && realPhotoPass;
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
    "DELA CRUZ" // split apart by splitCommaSeparatedName - see the dedicated test above
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

// === Full end-to-end specimen test ===
// Every line the detector actually found on the real 600x410 specimen card in one real
// run (from that run's debug_lines output), not a reconstructed subset - the strongest
// regression guard available, since it's the whole real input at once rather than a
// scenario built to isolate one fix. Covers the position template, fuzzy label
// matching, nearest-column grid pairing, and the comma-separated name split all
// exercising each other simultaneously, the way they actually do in production.
const specimenLines = [
  line("REPUBLIC OF THE PHILIPPINES", [181.48026315789474, 43.26682692307693, 426.4144736842105, 60.21875000000001]),
  line("DEPARTMENT OF TRANSPORTATION", [177.52764970990467, 61.987550158994544, 431.3539292374637, 78.94994984100546]),
  line("LAND TRANSPORTATION OFFICE", [188.39781178489702, 76.78608382107024, 418.51008295194504, 93.71872387123746]),
  line("NON-PROFESSIONAL DRIVER'S LICENSE", [137.02855603448276, 96.44422455238727, 483.6951281760435, 113.48366006299736]),
  line("Last Name. First Name.Middle Name", [218.72358194709574, 128.7556670984456, 411.8685233160621, 143.2635636707852]),
  line("DELA CRUZ, JUAN PEDRO GARCIA", [219.24515235457062, 143.07464574898785, 504.11011080332406, 162.4542004048583]),
  line("Nationality", [218.4600802854594, 165.9444263363755, 278.9083407671722, 181.96422750977837]),
  line("Sex", [293.50622650375936, 165.99051339285717, 321.296405075188, 183.88929429945057]),
  line("Date of Birth", [337.78661958204333, 166.84875212104072, 407.27916989164083, 183.031055571267]),
  line("Weight(kg)", [433.4136127439231, 164.6327425511558, 510.018304204411, 185.87457925547798]),
  line("Height(m)", [503.71436403508767, 167.97242254273505, 559.1145833333334, 183.87853899572653]),
  line("PHL", [216.43304559977318, 178.92689649045485, 251.6272553598082, 200.79520030087542]),
  line("M", [297.05068779904303, 181.35735358391608, 317.7519437799043, 198.0897618006993]),
  line("1987/10/04", [338.7050860323887, 181.5641179733728, 418.2028087044534, 197.88299741124263]),
  line("70", [452.0594965675057, 182.4174331103679, 474.5852402745995, 198.01525919732444]),
  line("1.55", [509.6168730650154, 181.75197963800906, 544.3304953560372, 198.68071266968326]),
  line("AUTODEAL", [104.25000000000001, 211.54423076923078, 180.9473684210526, 229.9942307692308]),
  line("Address", [217.61410361842104, 201.56588040865387, 266.9253700657895, 217.30431189903848]),
  line("UNIT/HOUSE NO.BUILDING, STREET NAME,", [217.97921926587688, 216.7141818052796, 488.5997281025442, 233.69447204087427]),
  line("BARANGAY,CITY/MUNICIPALITY", [218.02763819095478, 232.53176942404332, 417.49867759851884, 249.4153459605721]),
  line("License No.", [220.0091673856773, 254.22229665825978, 282.29346419327, 268.13347257250945]),
  line("Expiration Date", [352.5092516447369, 252.51404747596158, 434.00390624999994, 268.8561448317308]),
  line("Agency Code", [445.34467963386726, 252.58622491638798, 515.8395308924486, 268.7839673913044]),
  line("N03-12-123456", [217.20068892750746, 267.1866495827286, 324.57562686196616, 283.7508504172714]),
  line("2022/10/04", [351.5224095394737, 266.3121243990385, 433.0170641447368, 282.6542217548077]),
  line("N32", [461.30382775119614, 266.5537587412587, 494.9461722488038, 283.3981643356644]),
  line("8017/11/2", [110.86454796264856, 295.0252985421837, 174.33282045840406, 311.10450915012404]),
  line("Blood Type", [219.48006989011512, 284.2426640752605, 279.79125355883997, 304.36702827241265]),
  line("BLACK", [306.2514685150376, 296.9886461195055, 363.8143209586466, 317.0257769574176]),
  line("Eyes Color", [308.92105263157896, 287.8278846153847, 360.1578947368421, 301.5471153846154]),
  line("O+", [241.69736842105263, 299.5365384615385, 266.52631578947364, 315.46346153846156]),
  line("MOS--MDELACMUZ ANPEOMOGAMCSA", [76.38157894736842, 312.82211538461536, 201.90789473684208, 324.84615384615387]),
  line("Restnictions", [219.43667763157893, 318.69861778846155, 280.892269736842, 334.73888221153845]),
  line("Conditions", [308.3074162679426, 318.75349650349654, 364.71889952153106, 334.6840034965035]),
  line("xin", [468.0401593700002, 316.24101286100404, 508.0047322708666, 341.3706952837923]),
  line("1,2", [237.91401996370234, 331.23880968169766, 266.3622958257713, 350.78042108753317]),
  line("NONE", [311.84210526315786, 331.1538461538462, 361.1842105263158, 348.8942307692308]),
  line("cwb", [99.51523545706372, 339.03846153846155, 130.41897506925207, 345.9375]),
  line("EDGARC", [384.3191410129096, 341.4466164731495, 438.70717477656405, 357.327421988389]),
  line("GALVANTE", [433.0133735979293, 340.79957440100884, 495.6050474547023, 358.9600409836066]),
  line("Signature of Licensee", [83.46350263514516, 352.89169321627094, 195.77195810700857, 372.1854394132463]),
  line("Assistany", [383.359133126935, 355.2714932126697, 435.719814241486, 371.0986990950226]),
  line("Secretary", [429.27025351244333, 354.4997296665532, 486.5236012687938, 372.72477515714706]),
];

const specimenResult = extractFields(specimenLines, "DRIVERS_LICENSE", "FRONT", { width: 600, height: 410 });

console.log("\n=== Full end-to-end specimen test ===\n");
let specimenPass = true;
specimenPass = check("last_name", specimenResult.common_fields.last_name?.value, "DELA CRUZ") && specimenPass;
specimenPass = check("first_name", specimenResult.common_fields.first_name?.value, "JUAN") && specimenPass;
specimenPass = check("middle_name", specimenResult.common_fields.middle_name?.value, "PEDRO GARCIA") && specimenPass;
specimenPass = check("sex", specimenResult.common_fields.sex?.value, "M") && specimenPass;
specimenPass = check("date_of_birth", specimenResult.common_fields.date_of_birth?.value, "1987/10/04") && specimenPass;
specimenPass = check("blood_type", specimenResult.common_fields.blood_type?.value, "O+") && specimenPass;
specimenPass = check("nationality", specimenResult.variant_fields.nationality?.value, "PHL") && specimenPass;
specimenPass = check("weight", specimenResult.variant_fields.weight?.value, "70") && specimenPass;
specimenPass = check("height", specimenResult.variant_fields.height?.value, "1.55") && specimenPass;
specimenPass = check("id_number", specimenResult.variant_fields.id_number?.value, "N03-12-123456") && specimenPass;
specimenPass = check("expiry_date", specimenResult.variant_fields.expiry_date?.value, "2022/10/04") && specimenPass;
specimenPass =
  check("license_restrictions", specimenResult.variant_fields.license_restrictions?.value, "NONE") && specimenPass;

console.log(`\n${specimenPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!specimenPass) {
  console.log("\nFull output:", JSON.stringify(specimenResult, null, 2));
}

allPass = allPass && specimenPass;
process.exit(allPass ? 0 : 1);
