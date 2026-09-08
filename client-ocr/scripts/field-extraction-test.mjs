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
allPass = check("first_name", common_fields.first_name?.value, "JUAN PEDRO") && allPass;
allPass = check("middle_name", common_fields.middle_name?.value, "GARCIA") && allPass;

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
realPhotoPass =
  check("first_name", realPhotoResult.common_fields.first_name?.value, "SEBASTIAN VINCENT PABLO") && realPhotoPass;
realPhotoPass = check("middle_name", realPhotoResult.common_fields.middle_name?.value, "QUE") && realPhotoPass;
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
specimenPass = check("first_name", specimenResult.common_fields.first_name?.value, "JUAN PEDRO") && specimenPass;
specimenPass = check("middle_name", specimenResult.common_fields.middle_name?.value, "GARCIA") && specimenPass;
specimenPass = check("sex", specimenResult.common_fields.sex?.value, "M") && specimenPass;
specimenPass = check("date_of_birth", specimenResult.common_fields.date_of_birth?.value, "1987/10/04") && specimenPass;
specimenPass = check("blood_type", specimenResult.common_fields.blood_type?.value, "O+") && specimenPass;
specimenPass =
  check(
    "address",
    specimenResult.common_fields.address?.value,
    "UNIT/HOUSE NO.BUILDING, STREET NAME, BARANGAY,CITY/MUNICIPALITY"
  ) && specimenPass;
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

// === Short-alias false-positive test (real PASSPORT bug report) ===
// The driver's-license fixes above live in fieldExtraction.ts, which every id_type
// shares - so they also apply (and can also break things) for PASSPORT. A real run
// against a passport photo came back with sex = "ASTIAN VINCENT PABLO" (literally
// "SEBASTIAN VINCENT PABLO" with "SEB" sliced off the front) and id_number = "V 2022"
// (literally "15 NOV 2022" with "15 NO" sliced off). Both are the same root cause: the
// short alias "sex" fuzzy-matched the first 3 characters of "SEBASTIAN..." ("seb",
// edit-distance 1), and "id no" fuzzy-matched the first 5 characters of "15 NOV 2022"
// ("15 NO", edit-distance 2) - in both cases treating a real, unrelated line's prefix as
// the label and everything after it as the value. Passports have no printed "Sex"/
// "ID No" labels in this layout (those fields normally come from MRZ parsing, a
// separate step not exercised here) - lines from the real debug_lines dump for this
// report, so a pass here means sex/id_number are correctly left unresolved rather than
// populated with garbage that would silently block the MRZ fallback (which only fills
// in fields still empty).
const passportLines = [
  line("REPUBUIKA NG PILIPINASREPUBLICOFTHE PHILIPPINESO", [52.062284902924404, 246.88919941615688, 336.0610571382968, 260.8166931135134]),
  line("PASAPORTE/", [49.51388888888889, 260.6666666666667, 94.23611111111111, 272.3333333333333]),
  line("PASSPONT", [56.91263440860216, 269.38709677419354, 87.79569892473118, 278.61290322580646]),
  line("p ", [119.71438172043011, 260.9193548387097, 149.57728494623657, 281.0806451612903]),
  line("PHL", [156.54656862745097, 268.3529411764706, 173.1200980392157, 278.6470588235294]),
  line("P2370563C", [235.33580508474577, 269.56779661016947, 293.6641949152542, 281.43220338983053]),
  line("STLVA", [121.60919540229887, 286.8965517241379, 150.55747126436782, 298.1034482758621]),
  line("SEBASTIAN VINCENT PABLO", [122.10149572649573, 305.4102564102564, 236.31517094017096, 317.5897435897436]),
  line("QUE", [122.94618055555556, 326.2916666666667, 140.59548611111111, 336.7083333333333]),
  line("10 APR 2008", [122.28694968553461, 343.60377358490564, 174.79638364779873, 355.39622641509436]),
  line("FILIPINO", [214.3861788617886, 343.7073170731707, 255.19715447154468, 355.2926829268293]),
  line("PASIG CITY", [163.1421568627451, 363.2352941176471, 213.4828431372549, 372.7647058823529]),
  line("15 NOV 2022", [122.30024509803923, 381.61764705882354, 172.86642156862746, 393.38235294117646]),
  line("K NOV 2027", [122.9013605442177, 401.2448979591837, 171.30697278911566, 410.7551020408163]),
  line("DFA NANILA", [213.92948717948718, 401.2307692307692, 265.23717948717945, 410.7692307692308]),
  line("P<PHLSILVA<<SEBASTIAN<VINCENT<PABLO<<<<<<<<<", [29.128755266851176, 422.7087953405206, 331.2025431549567, 437.0109177154335]),
  line("P2370563C1PHL0804105M2711140<<<<<<<<<<<<<<08", [28.888969090863995, 439.95827390503746, 331.44433522404904, 454.0339441116166]),
];

const passportResult = extractFields(passportLines, "PASSPORT", "FRONT");

console.log("\n=== Short-alias false-positive test (real PASSPORT bug report) ===\n");
let passportPass = true;
passportPass = check("sex", passportResult.common_fields.sex?.value, undefined) && passportPass;
passportPass = check("id_number", passportResult.variant_fields.id_number?.value, undefined) && passportPass;

console.log(`\n${passportPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!passportPass) {
  console.log("\nFull output:", JSON.stringify(passportResult, null, 2));
}

allPass = allPass && passportPass;

// === Bilingual merged-label test (second real PASSPORT bug report) ===
// PH passports print bilingual Filipino/English labels on one line, separated by "/"
// ("Kasarian/Sex" - "Kasarian" is Filipino for "sex"). Matching the Filipino half left
// "/Sex" as the remainder, and since the leading-separator strip didn't remove "/", the
// remainder never got recognized as *also* being a known label (the same field's own
// English name, not a value) - "/Sex" was accepted as sex's value outright. Real line
// from that report.
const bilingualLabelLines = [line("Kasarian/Sex", [341.40394088669956, 1063.834051724138, 430.9710591133005, 1084.3659482758621])];
const bilingualLabelResult = extractFields(bilingualLabelLines, "PASSPORT", "FRONT");

console.log("\n=== Bilingual merged-label test (real PASSPORT bug report) ===\n");
const bilingualLabelPass = check("sex", bilingualLabelResult.common_fields.sex?.value, undefined);

console.log(`\n${bilingualLabelPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!bilingualLabelPass) {
  console.log("\nFull output:", JSON.stringify(bilingualLabelResult, null, 2));
}

allPass = allPass && bilingualLabelPass;

// === Left-align distance metric test (real DRIVERS_LICENSE bug report) ===
// The specimen card's address resolved to "AUTODEAL" - a short, unrelated line sitting
// far to the left near the ID photo placeholder - instead of the real address value
// directly below the "Address" label. findValueNear's "below" distance measured the
// candidate's CENTER x against the label's LEFT edge: "AUTODEAL" is a narrow box, so its
// center ends up closer to the label's left edge by that measure, even though the real
// (wide) address value's own LEFT edge lines up with the label almost exactly.
// Real boxes from that report.
const addressLines = [
  line("Address", [217.61410361842104, 201.56588040865387, 266.9253700657895, 217.30431189903848]),
  line("AUTODEAL", [104.25000000000001, 211.54423076923078, 180.9473684210526, 229.9942307692308]),
  line("UNIT/HOUSE NO.BUILDING, STREET NAME,", [217.97921926587688, 216.7141818052796, 488.5997281025442, 233.69447204087427]),
];
const addressResult = extractFields(addressLines, "DRIVERS_LICENSE", "FRONT");

console.log("\n=== Left-align distance metric test (real DRIVERS_LICENSE bug report) ===\n");
const addressPass = check("address", addressResult.common_fields.address?.value, "UNIT/HOUSE NO.BUILDING, STREET NAME,");

console.log(`\n${addressPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!addressPass) {
  console.log("\nFull output:", JSON.stringify(addressResult, null, 2));
}

allPass = allPass && addressPass;

// === Multi-line address continuation test ===
// A real PH address wraps across more than one detected line ("UNIT/HOUSE
// NO.BUILDING, STREET NAME," then "BARANGAY,CITY/MUNICIPALITY" directly below,
// left-aligned). extendMultilineValue is supposed to pull in that continuation line -
// but must stop before swallowing the next field's label too, even though "License No."
// sits close below with a similar left edge (real boxes: the gap between the address
// continuation line and "License No." is under 5px, well inside how far a real
// continuation line is allowed to be). isLabelOnlyText is what has to draw that line.
const multilineAddressLines = [
  line("Address", [217.61410361842104, 201.56588040865387, 266.9253700657895, 217.30431189903848]),
  line("UNIT/HOUSE NO.BUILDING, STREET NAME,", [217.97921926587688, 216.7141818052796, 488.5997281025442, 233.69447204087427]),
  line("BARANGAY,CITY/MUNICIPALITY", [218.02763819095478, 232.53176942404332, 417.49867759851884, 249.4153459605721]),
  line("License No.", [220.0091673856773, 254.22229665825978, 282.29346419327, 268.13347257250945]),
  line("N03-12-123456", [217.20068892750746, 267.1866495827286, 324.57562686196616, 283.7508504172714]),
];
const multilineAddressResult = extractFields(multilineAddressLines, "DRIVERS_LICENSE", "FRONT");

console.log("\n=== Multi-line address continuation test ===\n");
let multilineAddressPass = true;
multilineAddressPass =
  check(
    "address",
    multilineAddressResult.common_fields.address?.value,
    "UNIT/HOUSE NO.BUILDING, STREET NAME, BARANGAY,CITY/MUNICIPALITY"
  ) && multilineAddressPass;
multilineAddressPass =
  check("id_number", multilineAddressResult.variant_fields.id_number?.value, "N03-12-123456") && multilineAddressPass;

console.log(`\n${multilineAddressPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!multilineAddressPass) {
  console.log("\nFull output:", JSON.stringify(multilineAddressResult, null, 2));
}

allPass = allPass && multilineAddressPass;

// === Sex value-shape test (third real PASSPORT bug report) ===
// With the bilingual-label fix in place, "Kasarian/Sex" correctly reduces to a solo
// label with no other label nearby forming a row (its own row-mate, "Kapanganakan/Place
// of Birth", is garbled past recognition as "anganakanf Ploce of" - not a bug this
// scenario is about). Falling back to findValueNear's plain nearest-line search, it
// picked "MANILA" - the real place-of-birth value, sitting geometrically nearest with no
// separately-detected "F"/"M" character to find instead - purely because nothing
// checked whether "MANILA" looked anything like a sex value. Real boxes from that
// report.
const sexShapeLines = [
  line("Kasarian/Sex", [341.40394088669956, 1063.834051724138, 430.9710591133005, 1084.3659482758621]),
  line("anganakanf Ploce of", [544.9389275332226, 1066.0267714389536, 676.2485724667774, 1083.6326035610466]),
  line("MANILA", [456.72534496753246, 1078.925887784091, 558.6942978896104, 1102.8397372159093]),
];
const sexShapeResult = extractFields(sexShapeLines, "PASSPORT", "FRONT");

console.log("\n=== Sex value-shape test (real PASSPORT bug report) ===\n");
const sexShapePass = check("sex", sexShapeResult.common_fields.sex?.value, undefined);

console.log(`\n${sexShapePass ? "ALL PASSED" : "SOME FAILED"}`);
if (!sexShapePass) {
  console.log("\nFull output:", JSON.stringify(sexShapeResult, null, 2));
}

allPass = allPass && sexShapePass;

// === Value-above-label test (real PWD ID bug report) ===
// Most PH ID layouts print the label above the value; a PWD ID's "NAME" and "TYPE OF
// DISABILITY" print the opposite way around - the real value sits above a ruled line,
// with the label printed below that line. findValueNear previously only ever searched
// right or below a label, so "TYPE OF DISABILITY" found "SIGNATURE" (the nearest thing
// below it, further down the card) instead of "PSYCHOSOCIAL", its real value directly
// above. Real boxes from that report.
const valueAboveLabelLines = [
  line("JUAN DELA CRUZ", [260.49484536082474, 281.24876220835597, 655.5051546391752, 320.1788693705914]),
  line("NAME", [399.7738095238095, 339.0752613956767, 516.2261904761904, 372.7915149201128]),
  line("PSYCHOSOCIAL", [282.8078431372549, 383.3514125386997, 629.192156862745, 418.9956269349845]),
  line("TYPE OF DISABILITY", [265.020023557126, 441.443913311326, 648.3133097762072, 474.00345510972664]),
  line("SIGNATURE", [347.9506172839506, 557.4688109161793, 569.3827160493827, 589.5015838206629]),
];
const valueAboveLabelResult = extractFields(valueAboveLabelLines, "PWD", "FRONT");

console.log("\n=== Value-above-label test (real PWD ID bug report) ===\n");
let valueAboveLabelPass = true;
valueAboveLabelPass =
  check("pwd_disability_type", valueAboveLabelResult.variant_fields.pwd_disability_type?.value, "PSYCHOSOCIAL") &&
  valueAboveLabelPass;
// "NAME" is a deliberately deferred, last-resort match for last_name (see
// resolveStandaloneNameLabel's comment) - checking it here, in the same scenario as
// pwd_disability_type rather than in isolation, is the point: an earlier version of
// this fix resolved last_name to "PSYCHOSOCIAL" (stealing pwd_disability_type's own
// value) because "name" was tried as a regular alias in the normal per-field pass,
// before pwd_disability_type got a chance to claim it. A real bug this scenario caught.
valueAboveLabelPass = check("last_name", valueAboveLabelResult.common_fields.last_name?.value, "DELA CRUZ") && valueAboveLabelPass;
valueAboveLabelPass = check("first_name", valueAboveLabelResult.common_fields.first_name?.value, "JUAN") && valueAboveLabelPass;

console.log(`\n${valueAboveLabelPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!valueAboveLabelPass) {
  console.log("\nFull output:", JSON.stringify(valueAboveLabelResult, null, 2));
}

allPass = allPass && valueAboveLabelPass;

// === Undivided-name surname-prefix split test ===
// Synthetic (not from a specific bug report), covering splitUndividedName's compound-
// surname handling on its own: a multi-word prefix ("DE LOS SANTOS"), and the no-prefix
// fallback (a plain surname with no compound marker splits on the last word alone).
function checkUndividedName(name, fullName, expectedFirst, expectedLast) {
  const testLines = [line("NAME", [400, 339, 516, 373]), line(fullName, [260, 281, 656, 320])];
  const result = extractFields(testLines, "PWD", "FRONT");
  const firstOk = check(`${name} first_name`, result.common_fields.first_name?.value, expectedFirst);
  const lastOk = check(`${name} last_name`, result.common_fields.last_name?.value, expectedLast);
  return firstOk && lastOk;
}

console.log("\n=== Undivided-name surname-prefix split test ===\n");
let undividedNamePass = true;
undividedNamePass = checkUndividedName("compound", "MARIA DE LOS SANTOS", "MARIA", "DE LOS SANTOS") && undividedNamePass;
undividedNamePass = checkUndividedName("plain", "JUAN SANTOS", "JUAN", "SANTOS") && undividedNamePass;

console.log(`\n${undividedNamePass ? "ALL PASSED" : "SOME FAILED"}`);

allPass = allPass && undividedNamePass;

// === Real TIN ID bug report ===
// Two real bugs at once, both from the same underlying cause: fuzzyMatchPrefix's
// prefix-length search picked whichever length had the single lowest raw edit distance,
// even when a longer length (up to and including the whole line) was also within
// tolerance. "Birthdate:" (10 chars) vs date_of_birth's "birth date" alias (10 chars):
// the algorithm preferred a 1-edit match at length 9 ("birthdate") over the 2-edit match
// at the full length 10 ("birthdate:"), so it came back as a partial match instead of
// "this whole line is the label" - which the exact-only-remainder rule then correctly
// refused to trust, so "Birthdate:" was never recognized as a label at all, and
// address's multi-line continuation walked straight through it (and the date value
// after it) as if they were more address text. Fixed by checking the whole line against
// the alias first, only falling back to shorter prefixes if that doesn't qualify.
// Separately, once "Birthdate:" was recognized as a label, its real value
// ("11 JULY1998" - a real card printing day + month-name + year, not a slash-separated
// numeric date) was still being rejected by date_of_birth's shape validator, which only
// accepted the numeric form. Real lines from that report.
const tinIdLines = [
  line("TIN", [370.19607843137254, 121.11455108359132, 425.53725490196075, 153.62229102167183]),
  line("302-280-158-61000", [370.9195505617978, 155.51271437019517, 853.6137827715356, 199.22412773506798]),
  line("Name", [368.9802705758457, 208.20331579612497, 470.358396090821, 243.20721051966456]),
  line("RAMOS,ELLA JOY", [371.85780423630075, 244.81208949396262, 653.1994261583427, 279.3604622058714]),
  line("Address", [371.87480467689386, 302.14096073838783, 517.7557316837513, 341.7661416671818]),
  line("BLK15LOT2 MALINAWON VILLAGE, MATINA", [374.89651162556436, 340.97344507784817, 1012.8373161991125, 372.50678776925747]),
  line("CROSSING, DAVAO CITY", [377.9611285266458, 380.35637683550567, 723.9055381400209, 411.2225705329153]),
  line("Birthdate:", [364.75659278331733, 464.8230878648276, 508.8870081899187, 499.90069238872593]),
  line("TIN Issuance Date:", [610.2098377974713, 467.04009246336193, 850.0132674701965, 497.5590674880056]),
  line("11 JULY1998", [366.33117399900306, 498.7185121092793, 515.8181510053348, 527.10334602382]),
  line("21 OCTOBER2023", [614.395455410039, 496.4806440902891, 815.9586490182492, 522.7744433971009]),
  line("SIGNATURE", [124.42236372539156, 583.767707795703, 243.5715431466873, 611.5647812944273]),
];
const tinIdResult = extractFields(tinIdLines, "TIN", "FRONT");

console.log("\n=== Real TIN ID bug report ===\n");
let tinIdPass = true;
tinIdPass =
  check(
    "address",
    tinIdResult.common_fields.address?.value,
    "BLK15LOT2 MALINAWON VILLAGE, MATINA CROSSING, DAVAO CITY"
  ) && tinIdPass;
tinIdPass = check("date_of_birth", tinIdResult.common_fields.date_of_birth?.value, "11 JULY1998") && tinIdPass;

console.log(`\n${tinIdPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!tinIdPass) {
  console.log("\nFull output:", JSON.stringify(tinIdResult, null, 2));
}

allPass = allPass && tinIdPass;

// --- Real PhilSys (National ID) bug report: "Mga Pangalan/Given Names" (the plural
// Filipino article "Mga" in front of "Pangalan") never matched first_name's aliases,
// since label matching only checks whether a line *starts with* an alias - all of
// "given name"/"given names"/"pangalan" sit after "Mga ", not at position 0. With
// first_name never resolved by the main pass, the last-resort splitUndividedName step
// (meant for undivided single-line names) ran on last_name's own two-word value
// ("DELA CRUZ") since it looked like first_name was still empty - wrongly splitting it
// into first_name="DELA"/last_name="CRUZ" and stomping the already-correct last_name.
// Also covers a second, independent bug the same report surfaced: date_of_birth's
// value, "JANUARY01,1990" (month name immediately followed by day, no space, then a
// comma before the year), didn't match DATE_VALUE_PATTERN's day-first-or-numeric
// shapes, so the field was left blank entirely.
const philsysLines = [
  line("REPUBLIKANG PILIPINAS", [265.65, 29.79, 474.36, 46.84]),
  line("Republic of the Philippines", [286.75, 48.74, 454.26, 65.71]),
  line("PAMBANSANGPAGKAKAKILANLAN", [224.49, 67.55, 517.53, 84.71]),
  line("Philippine Identification Card", [279.71, 85.54, 461.29, 102.55]),
  line("1234-5678-9101-1213", [76.48, 124.67, 257.43, 144.03]),
  line("Apelyido/Last Name", [340.96, 140.36, 471.24, 157.2]),
  line("DELA CRUZ", [339.76, 153.51, 435.45, 176.3]),
  line("Mga Pangalan/Given Names", [341.58, 183.77, 515.74, 198.38]),
  line("JUAN", [340.44, 196.57, 390.54, 216.44]),
  line("5", [127.79, 217.32, 202.52, 271.17], 0.15),
  line("Gitnang Apelyido/Middle Name", [340.17, 242.08, 537.21, 261.49]),
  line("MARTINEZ", [340.46, 258.29, 432.63, 277.12]),
  line("Petsa ng Kapanganakan/Date of Birth", [340.83, 284.54, 573.64, 301.63]),
  line("JANUARY01,1990", [342.25, 299.87, 497.03, 319.14]),
  line("PHL", [611.73, 309.62, 668.64, 342.49]),
  line("Tirahan/Address", [108.07, 328.19, 209.8, 342.57]),
  line("833SISA ST. BRGY 526,ZONES2SAMPALOK,MANILA", [107.4, 341.46, 553.39, 361.15]),
  line("CITY,METRO MANILA", [108.57, 360.53, 289.51, 379.89]),
];
const philsysResult = extractFields(philsysLines, "PHILSYS", "FRONT");

console.log("\n=== Real PhilSys ID bug report ===\n");
let philsysPass = true;
philsysPass = check("last_name", philsysResult.common_fields.last_name?.value, "DELA CRUZ") && philsysPass;
philsysPass = check("first_name", philsysResult.common_fields.first_name?.value, "JUAN") && philsysPass;
philsysPass = check("middle_name", philsysResult.common_fields.middle_name?.value, "MARTINEZ") && philsysPass;
philsysPass = check("date_of_birth", philsysResult.common_fields.date_of_birth?.value, "JANUARY01,1990") && philsysPass;

console.log(`\n${philsysPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!philsysPass) {
  console.log("\nFull output:", JSON.stringify(philsysResult, null, 2));
}

allPass = allPass && philsysPass;

// --- Real PhilHealth ID bug report: this layout prints NO labels at all next to
// last_name/date_of_birth/sex/address - just the raw values stacked one below another
// (id_number, full name, date_of_birth+sex fused onto one line, then address), with
// nothing for label-proximity matching to search for. id_number itself still resolves
// (its alias list fuzzy-matches the "PhilHealth" logo text well enough - see
// "SPhilHealth" below), so resolvePhilhealthUnlabeledFields uses the card's fixed
// print order below it as the anchor instead. Gated to only run for PHILHEALTH, so it
// can't change what any other id_type resolves to. Also covers splitFusedDobSex
// recovering date_of_birth/sex from "JANUARY 01,2022-MALE", one fused line with no
// label for either and no space around the separating "-".
const philhealthLines = [
  line("REPUBLIC OF THE PHILIPPINES", [72.28, 18.87, 260.22, 31.52]),
  line("SPhilHealth", [429.23, 16.96, 526.46, 36.51]),
  line("Philippine Health Insurance Corporation", [71.04, 34.0, 250.77, 44.15]),
  line("17-13245678-0", [224.13, 95.2, 401.99, 118.81]),
  line("DELA CRUZ, JUAN", [224.29, 124.13, 358.07, 139.14]),
  line("JANUARY 01,2022-MALE", [223.32, 140.58, 360.02, 155.6]),
  line("PRK. SUBDIVISION, BARANGAY", [223.96, 156.69, 391.46, 169.32]),
  line("CITY HERE", [224.17, 170.28, 282.36, 182.47]),
  line("SignUiure", [105.02, 319.86, 157.48, 334.21]),
  line("1324567", [291.08, 315.1, 420.59, 327.66]),
  line("8.0", [430.62, 315.64, 458.97, 327.12]),
  line("FORMALECONOMY", [230.1, 330.81, 385.32, 345.88]),
];
const philhealthResult = extractFields(philhealthLines, "PHILHEALTH", "FRONT");

console.log("\n=== Real PhilHealth ID bug report ===\n");
let philhealthPass = true;
philhealthPass = check("last_name", philhealthResult.common_fields.last_name?.value, "DELA CRUZ") && philhealthPass;
philhealthPass = check("first_name", philhealthResult.common_fields.first_name?.value, "JUAN") && philhealthPass;
philhealthPass =
  check("date_of_birth", philhealthResult.common_fields.date_of_birth?.value, "JANUARY 01,2022") && philhealthPass;
philhealthPass = check("sex", philhealthResult.common_fields.sex?.value, "MALE") && philhealthPass;
philhealthPass =
  check("address", philhealthResult.common_fields.address?.value, "PRK. SUBDIVISION, BARANGAY CITY HERE") &&
  philhealthPass;
philhealthPass = check("id_number", philhealthResult.variant_fields.id_number?.value, "17-13245678-0") && philhealthPass;

console.log(`\n${philhealthPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!philhealthPass) {
  console.log("\nFull output:", JSON.stringify(philhealthResult, null, 2));
}

allPass = allPass && philhealthPass;

// --- Real UMID bug report: "Sex"/"Date of Birth" fused onto one line with no space at
// all between either label and its value ("SEX M DATEOF BIRTH LAGOXOL/2B"). The
// regular per-field search does match "sex" as this line's own label (it's the exact
// start of the line), but the leftover remainder is the entire rest of the line, which
// fails sex's own value-shape validator and gets discarded outright rather than
// pulling just "M" out of it - splitFusedSexDob recovers that. The printed
// date_of_birth value itself was misread by the recognizer as "LAGOXOL/2B" - not a
// garbled-but-recoverable date, just wrong characters - so it's correctly left
// unresolved rather than accepting recognition garbage as a birthdate.
const umidLines = [
  line("NG", [188.93, 74.76, 253.45, 115.18]),
  line("REPUBLIC OFTHE PHILIPPINES", [387.4, 116.44, 1340.08, 175.15]),
  line("Unified Multi-Purpose ID", [583.71, 173.64, 1143.79, 233.28]),
  line("CRN-0028-1215160-9", [1028.66, 296.88, 1658.73, 372.48]),
  line("SURNAME", [744.05, 416.36, 889.08, 454.73]),
  line("SANTOS", [744.21, 455.03, 925.21, 505.92]),
  line("GIVEN NAME", [741.93, 518.75, 925.67, 557.74]),
  line("JOSE", [743.11, 560.29, 877.31, 609.73]),
  line("MIDDLE NAME", [740.13, 672.9, 943.76, 721.02]),
  line("CRUZ", [741.98, 713.9, 869.47, 768.43]),
  line("SEX M DATEOF BIRTH LAGOXOL/2B", [746.98, 765.58, 1397.88, 827.31]),
  line("ADDRESS", [751.33, 823.5, 894.5, 861.83]),
  line("2BPAYAPASTBAGONG DIWA", [750.47, 855.65, 1465.14, 914.05]),
  line("STOCRISTOBALCALOOCAN CITY", [751.16, 915.03, 1549.73, 964.7]),
  line("METROMANILA", [749.78, 966.82, 1126.5, 1015.61]),
  line("PHILIPPINE S LBOO", [746.45, 1016.59, 1224.19, 1072.07]),
];
const umidResult = extractFields(umidLines, "UMID", "FRONT");

console.log("\n=== Real UMID bug report ===\n");
let umidPass = true;
umidPass = check("last_name", umidResult.common_fields.last_name?.value, "SANTOS") && umidPass;
umidPass = check("first_name", umidResult.common_fields.first_name?.value, "JOSE") && umidPass;
umidPass = check("middle_name", umidResult.common_fields.middle_name?.value, "CRUZ") && umidPass;
umidPass = check("sex", umidResult.common_fields.sex?.value, "M") && umidPass;
umidPass = check("date_of_birth", umidResult.common_fields.date_of_birth?.value, undefined) && umidPass;
umidPass = check("id_number", umidResult.variant_fields.id_number?.value, "0028-1215160-9") && umidPass;

console.log(`\n${umidPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!umidPass) {
  console.log("\nFull output:", JSON.stringify(umidResult, null, 2));
}

allPass = allPass && umidPass;

// --- Real Postal ID bug report: ONE combined label covering every name field at once
// ("First Name, Middle Name, Sumame, Suffix" - "Sumame" is OCR-garbled "Surname"),
// with the actual values printed as four separate boxes in a row below it - not
// resolveGridRows's shape (2+ *separate* labels each paired with one value) and not
// one comma-joined line either (splitCommaSeparatedName's shape). Before the fix,
// first_name's own alias matched this merged line as its label (first among the
// merged fields) and the regular per-field search grabbed only the single nearest box
// ("JUANA"), leaving last_name/middle_name completely unresolved with
// "REYES"/"DELA"/"CRUZ" never even looked at.
//
// Also guards the regression this fix's first version caused: an over-broad "does
// this line match some name field's alias with an empty remainder" trigger also fired
// on PhilSys's ordinary bilingual middle_name label ("Gitnang Apelyido/Middle Name" -
// both halves are middle_name's own synonyms, not a different field), sending it
// hunting for unrelated boxes elsewhere on the card and replacing already-correct
// first_name/last_name with garbage. The real PhilSys regression scenario above
// already covers that the fix holds; this scenario is the new bug this same session
// found the fix for.
const postalLines = [
  line("REPUBLIC OF THE PHILIPPINES", [251.43, 31.67, 642.32, 57.23]),
  line("Philippine", [250.46, 58.42, 385.41, 85.71]),
  line("Postal Corporation", [388.22, 59.74, 644.21, 85.29]),
  line("PHLPOST&", [715.26, 55.67, 1059.59, 107.15]),
  line("POSTAL IDENTITY CARD", [249.47, 87.43, 645.43, 115.78]),
  line("First Name, Middle Name, Sumame, Suffix", [334.72, 200.32, 591.12, 220.69]),
  line("JUANA", [333.99, 224.55, 456.64, 259.23]),
  line("REYES", [468.67, 226.32, 594.67, 258.61]),
  line("DELA", [614.5, 224.33, 712.37, 260.6]),
  line("CRUZ", [731.38, 222.02, 834.98, 267.53]),
  line("Address", [330.56, 268.97, 392.5, 288.03]),
  line("5GEN. TUAZON", [329.95, 287.43, 624.5, 320.31]),
  line("BLVD.", [628.36, 287.94, 721.43, 319.38]),
  line("BRGY", [328.85, 320.97, 415.95, 349.85]),
  line("RIVERA", [438.31, 319.66, 558.52, 351.26]),
  line("1742", [327.78, 351.08, 410.13, 379.79]),
  line("PASAY CITY", [422.31, 350.07, 614.64, 380.7]),
  line("Dateof Birth", [470.13, 422.93, 549.66, 441.87]),
  line("Natonality", [637.04, 425.99, 702.37, 442.99]),
  line("Issuing Post Office", [470.69, 492.76, 583.48, 509.43]),
  line("Valid Until", [637.11, 491.88, 698.94, 508.0]),
];
const postalResult = extractFields(postalLines, "POSTAL", "FRONT");

console.log("\n=== Real Postal ID bug report ===\n");
let postalPass = true;
postalPass = check("first_name", postalResult.common_fields.first_name?.value, "JUANA") && postalPass;
postalPass = check("middle_name", postalResult.common_fields.middle_name?.value, "REYES") && postalPass;
postalPass = check("last_name", postalResult.common_fields.last_name?.value, "DELA CRUZ") && postalPass;

console.log(`\n${postalPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!postalPass) {
  console.log("\nFull output:", JSON.stringify(postalResult, null, 2));
}

allPass = allPass && postalPass;

// --- Real PRC ID bug report, three independent bugs at once:
// 1. findValueNear compared a same-row-to-the-right match against an above/below match
//    on the SAME numeric scale, even though the two use different distance formulas -
//    "LAST NAME"'s value resolved to a stray line of background microprint noise
//    sitting well above the label (whose left edge happened to align almost exactly
//    with the label's, producing a deceptively small "dist" via the vertical-gap
//    formula) instead of "DELA CRUZ", the correct value sitting right beside it on the
//    same row. Same bug independently broke "MIDDLE NAME", which resolved to
//    "REGISTRATION NO." (the next label down) instead of "SANTOS" beside it.
// 2. "REGISTRATION DATE" fuzzy-matched expiry_date's "expiration date" alias (both
//    share a long "...ration date" tail) closely enough to claim it before
//    expiry_date's own correct "VALID UNTIL" label was ever reached, so expiry_date
//    resolved to the registration date's value instead of the real expiry value.
// 3. prc_profession's "profession" alias matched the first ten characters of
//    "PROFESSIONAL REGULATION COMMISSION" - the id_type's own fixed letterhead text on
//    every PRC card - since "profession" is a genuine prefix of the unrelated, longer
//    word "professional". fuzzyMatchPrefix now requires a real word boundary
//    immediately after a match, and rejects a longer fuzzy window whose "extra"
//    characters are just more letters of the same word rather than something genuinely
//    separating two words - the "professional" collision needs both: it fails the
//    plain length-10 boundary check (following character "a" continues the word), and
//    the length-12 window "professional" fails the extra-absorption check (no
//    punctuation between position 10 and 12). prc_profession is correctly left
//    unresolved rather than guessed at - the real card prints "PROFESSIONAL TEACHER"
//    with no label at all next to it, the same kind of gap as PhilHealth's unlabeled
//    fields, not something this fix attempts to recover.
const prcLines = [
  line("Republic of the Philippines", [313.93, 38.43, 516.99, 55.34]),
  line("PROFESSIONAL REGULATION COMMISSION", [126.84, 56.89, 692.96, 81.31]),
  line("PROFESSIONAL IDENTIFICATION CARD", [176.06, 86.26, 648.8, 108.21]),
  line("mCO", [24.19, 120.39, 57.59, 127.38], 0.34),
  line("NUALROR.ATONOO", [151.29, 120.28, 222.27, 127.49], 0.54),
  line("DIenmco", [236.13, 120.32, 287.86, 127.45], 0.43),
  line("mmes", [288.58, 120.27, 370.7, 127.5], 0.35),
  line("DLIE.ATNOC", [373.4, 120.27, 448.43, 127.5], 0.51),
  line("umtormemm", [490.53, 120.29, 556.44, 127.48], 0.46),
  line("LAST NAME", [235.41, 143.3, 326.95, 159.75]),
  line("DELA CRUZ", [429.27, 143.31, 517.75, 159.74]),
  line("FIRST NAME", [236.77, 180.17, 333.66, 198.89]),
  line("JUAN", [428.71, 179.29, 474.89, 198.78]),
  line("MIDDLE NAME", [236.68, 215.61, 353.95, 234.52]),
  line("SANTOS", [428.24, 217.39, 495.52, 238.3]),
  line("REGISTRATION NO.", [236.25, 253.69, 386.68, 270.47]),
  line("0000001", [428.93, 253.54, 488.81, 271.62]),
  line("REGISTRATION DATE", [236.23, 289.21, 397.8, 306.03]),
  line("01/01/2000", [428.33, 288.49, 505.57, 304.78]),
  line("VALID UNTIL", [235.74, 319.33, 336.71, 338.1]),
  line("2", [407.55, 318.51, 424.37, 332.99], 0.09),
  line("01/01/2026", [428.32, 320.07, 506.58, 336.38]),
  line("PROFESSIONAL TEACHER", [274.79, 365.41, 562.18, 384.81]),
  line("Date Generated: Feb 27, 2023", [316.95, 493.5, 522.04, 510.41]),
];
const prcResult = extractFields(prcLines, "PRC", "FRONT");

console.log("\n=== Real PRC ID bug report ===\n");
let prcPass = true;
prcPass = check("last_name", prcResult.common_fields.last_name?.value, "DELA CRUZ") && prcPass;
prcPass = check("first_name", prcResult.common_fields.first_name?.value, "JUAN") && prcPass;
prcPass = check("middle_name", prcResult.common_fields.middle_name?.value, "SANTOS") && prcPass;
prcPass = check("id_number", prcResult.variant_fields.id_number?.value, "0000001") && prcPass;
prcPass = check("issue_date", prcResult.variant_fields.issue_date?.value, "01/01/2000") && prcPass;
prcPass = check("expiry_date", prcResult.variant_fields.expiry_date?.value, "01/01/2026") && prcPass;
prcPass = check("prc_profession", prcResult.variant_fields.prc_profession?.value, undefined) && prcPass;

console.log(`\n${prcPass ? "ALL PASSED" : "SOME FAILED"}`);
if (!prcPass) {
  console.log("\nFull output:", JSON.stringify(prcResult, null, 2));
}

allPass = allPass && prcPass;
process.exit(allPass ? 0 : 1);
