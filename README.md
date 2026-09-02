# PaddleOCR vs. Tesseract — Accuracy on Government ID Documents

Compares [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) and [Tesseract](https://github.com/tesseract-ocr/tesseract) (via `pytesseract`) on scanned/photographed government ID documents — passports, driving licences, and ID cards.

## Notebook

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/sebe67/paddlevstesseractOCR/blob/claude/ocr-engines-accuracy-comparison-3r87my/notebooks/PaddleOCR_vs_Tesseract_ID_Accuracy.ipynb)

[`notebooks/PaddleOCR_vs_Tesseract_ID_Accuracy.ipynb`](notebooks/PaddleOCR_vs_Tesseract_ID_Accuracy.ipynb) is self-contained — open it in Colab (badge above) and run top to bottom. No local setup required.

## Dataset

[MIDV-500](https://arxiv.org/abs/1807.05786) (Smart Engines / Recognition and Perception Systems Lab):

- 500 video clips across 50 identity document types (17 ID cards, 14 passports, 13 driving licences, 6 other).
- Documents are mock IDs made for research (fictional people / consenting volunteers) — no real PII.
- Each document type ships with per-frame ground-truth quadrangles (the 4 corner points of the document in each photo), which lets us crop/rectify the document before OCR. It does **not** ship ground-truth text for the fields — since each document type is one physical mock document filmed under 10 conditions, the notebook has you transcribe its field values once by eye, which then serves as ground truth for scoring.
- Distributed as 50 small per-type zip files, so the notebook downloads only 4 of them (~a few hundred MB) instead of the full dataset — kept intentionally small for Colab.

Default document types used (all Latin-script, so a single PaddleOCR/Tesseract language model handles them all):

| Code | Country | Document type |
|---|---|---|
| `01_alb_id` | Albania | National ID card |
| `12_deu_drvlic_new` | Germany | Driving licence |
| `05_aze_passport` | Azerbaijan | Passport |
| `48_usa_passportcard` | USA | Passport card |

Swap `DOC_TYPES` in the notebook for any of the [other 46 codes](https://github.com/fcakyon/midv500/blob/master/midv500/download_dataset.py) to try other scripts (Cyrillic, CJK, Arabic) — that tends to be where the two engines diverge most.

## Method

1. Download the selected MIDV-500 document types and sample a handful of frames per clip.
2. Perspective-warp each frame using the ground-truth document quadrangle to get a straightened, cropped ID image.
3. Transcribe the field text visible on one rectified frame per document type, once — this becomes the ground truth (`GT_FIELDS`), since MIDV-500 doesn't provide it.
4. Run both OCR engines on the same crop.
5. Score each engine two ways against `GT_FIELDS`:
   - **Field recall** — fraction of known field values (fuzzy-)found in the OCR output.
   - **Character error rate (CER)** — Levenshtein distance between OCR output and ground truth, normalized by length.
6. Aggregate and plot per document type and overall.
