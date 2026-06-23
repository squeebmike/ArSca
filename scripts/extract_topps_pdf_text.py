import json
import sys
from pathlib import Path

import pdfplumber


def main():
    if len(sys.argv) < 3:
        print("Usage: extract_topps_pdf_text.py INPUT_PDF OUTPUT_JSON", file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    pages = []

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text(x_tolerance=1, y_tolerance=3) or "")

    payload = {
        "fileName": pdf_path.name,
        "pageCount": len(pages),
        "rawText": "\n".join(pages).strip(),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
