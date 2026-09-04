export interface OcrModelConfig {
  detModelUrl: string;
  recModelUrl: string;
  keysUrl: string;
}

/**
 * Public HTTPS URL for the GCS bucket holding the model assets. The three objects
 * (det_model.onnx, rec_model.onnx, ppocrv5_dict.txt) must have public read access
 * (`gsutil iam ch allUsers:objectViewer gs://idscan_ocr`, or a public bucket ACL) —
 * this code runs in the browser and cannot hold a service-account credential.
 * cls_model.onnx is intentionally not referenced: orientation classification is
 * skipped since input images already arrive edge-straightened/upright.
 *
 * IMPORTANT: the dictionary file must be ppocrv5_dict.txt (18,383 entries), not the
 * older ppocr_keys_v1.txt (6,623 entries, used by PP-OCRv3/v4 models) — the rec model
 * this module is built for is PP-OCRv5 mobile, and its output class count only lines
 * up with the v5 dictionary. Confirm your bucket actually has ppocrv5_dict.txt
 * uploaded under this name; see recognize.ts's runtime class-count check, which is
 * exactly the mismatch that would fire if the wrong dictionary is deployed.
 */
export const DEFAULT_MODEL_BASE_URL = "https://storage.googleapis.com/idscan_ocr/";

export function defaultModelConfig(baseUrl: string = DEFAULT_MODEL_BASE_URL): OcrModelConfig {
  return {
    detModelUrl: `${baseUrl}det_model.onnx`,
    recModelUrl: `${baseUrl}rec_model.onnx`,
    keysUrl: `${baseUrl}ppocrv5_dict.txt`,
  };
}
