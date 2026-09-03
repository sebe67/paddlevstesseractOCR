export interface OcrModelConfig {
  detModelUrl: string;
  recModelUrl: string;
  keysUrl: string;
}

/**
 * Public HTTPS URL for the GCS bucket holding the model assets. The three objects
 * (det_model.onnx, rec_model.onnx, ppocr_keys_v1.txt) must have public read access
 * (`gsutil iam ch allUsers:objectViewer gs://idscan_ocr`, or a public bucket ACL) —
 * this code runs in the browser and cannot hold a service-account credential.
 * cls_model.onnx is intentionally not referenced: orientation classification is
 * skipped since input images already arrive edge-straightened/upright.
 */
export const DEFAULT_MODEL_BASE_URL = "https://storage.googleapis.com/idscan_ocr/";

export function defaultModelConfig(baseUrl: string = DEFAULT_MODEL_BASE_URL): OcrModelConfig {
  return {
    detModelUrl: `${baseUrl}det_model.onnx`,
    recModelUrl: `${baseUrl}rec_model.onnx`,
    keysUrl: `${baseUrl}ppocr_keys_v1.txt`,
  };
}
