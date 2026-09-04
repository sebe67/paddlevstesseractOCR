export interface OcrModelConfig {
  detModelUrl: string;
  recModelUrl: string;
  keysUrl: string;
}

/**
 * Public HTTPS URL for the GCS bucket holding the model assets. The three objects
 * must have public read access (`gsutil iam ch allUsers:objectViewer gs://idscan_ocr`,
 * or a public bucket ACL) — this code runs in the browser and cannot hold a
 * service-account credential. cls_model.onnx is intentionally not referenced:
 * orientation classification is skipped since input images already arrive
 * edge-straightened/upright.
 *
 * Objects currently live under a v1.0/ prefix in the bucket (confirmed via the
 * bucket's public XML listing on 2026-09-04), not at the bucket root.
 *
 * The dictionary file is ppocr_keys_v1.txt (6,623 entries), confirmed to match the
 * deployed rec_model.onnx: its actual ONNX output layer is 6,625-wide (6,623 dict
 * entries + blank + space) — inspected directly via `onnx.load()` on the downloaded
 * model, not assumed. That output width does NOT match ppocrv5_dict.txt (18,383
 * entries, 18,385-wide output), so despite the "PP-OCRv5 mobile" name on this
 * module, the rec model actually deployed here is a PP-OCRv3/v4-generation model.
 * If you re-export/re-upload a genuine PP-OCRv5 rec model later, this needs to
 * change back to a v5 dictionary — see recognize.ts's runtime class-count check,
 * which will fire a console warning if these two ever drift out of sync again.
 */
export const DEFAULT_MODEL_BASE_URL = "https://storage.googleapis.com/idscan_ocr/v1.0/";

export function defaultModelConfig(baseUrl: string = DEFAULT_MODEL_BASE_URL): OcrModelConfig {
  return {
    detModelUrl: `${baseUrl}det_model.onnx`,
    recModelUrl: `${baseUrl}rec_model.onnx`,
    keysUrl: `${baseUrl}ppocr_keys_v1.txt`,
  };
}
