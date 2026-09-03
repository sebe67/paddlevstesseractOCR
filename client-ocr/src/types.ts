export type IdType =
  | "PHILSYS"
  | "UMID"
  | "DRIVERS_LICENSE"
  | "PASSPORT"
  | "PRC"
  | "POSTAL"
  | "VOTERS"
  | "SSS"
  | "TIN"
  | "PHILHEALTH"
  | "SENIOR_CITIZEN"
  | "PWD";

export type DocumentSide = "FRONT" | "BACK";

export interface OcrField {
  value: string;
  confidence: number;
  source_side?: DocumentSide;
  /** [xMin, yMin, xMax, yMax] in the source image's pixel coordinates. */
  bounding_box?: [number, number, number, number];
}

export interface CommonFields {
  last_name?: OcrField;
  first_name?: OcrField;
  middle_name?: OcrField;
  name_extension?: OcrField;
  date_of_birth?: OcrField;
  sex?: OcrField;
  address?: OcrField;
  blood_type?: OcrField;
}

export interface VariantFields {
  id_number?: OcrField;
  issue_date?: OcrField;
  expiry_date?: OcrField;
  place_of_birth?: OcrField;
  civil_status?: OcrField;
  nationality?: OcrField;
  weight?: OcrField;
  height?: OcrField;
  emergency_contact?: OcrField;
  license_restrictions?: OcrField;
  prc_profession?: OcrField;
  pwd_disability_type?: OcrField;
}

export interface DocumentProvenanceEntry {
  side: DocumentSide;
  image_hash: string;
  raw_ocr_text: string;
  engine_version: string;
}

/** Matches the "ph id schema" JSON schema. */
export interface PhIdOcrResult {
  id_type?: IdType;
  common_fields: CommonFields;
  variant_fields?: VariantFields;
  document_provenance?: DocumentProvenanceEntry[];
}

/** One recognized text line, in original-image pixel coordinates. */
export interface RecognizedTextLine {
  text: string;
  confidence: number;
  boundingBox: [number, number, number, number];
}
