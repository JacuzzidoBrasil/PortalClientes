import hashlib
import os
import re
import time
from pathlib import Path

import requests

API_URL = os.getenv("SYNC_API_URL", "https://chatbot-aaa.mmidem.easypanel.host").rstrip("/")
SYNC_TOKEN = os.getenv("SYNC_TOKEN", "")
SOURCE_DIR = Path(os.getenv("INVOICE_SOURCE_DIR", r"C:\Notas\Entrada"))
PROCESSED_DIR = Path(os.getenv("INVOICE_PROCESSED_DIR", str(SOURCE_DIR / "processadas")))
ERROR_DIR = Path(os.getenv("INVOICE_ERROR_DIR", str(SOURCE_DIR / "erro")))
POLL_SECONDS = int(os.getenv("SYNC_POLL_SECONDS", "300"))
LOOP = os.getenv("SYNC_LOOP", "true").lower() in {"1", "true", "yes"}


def normalize_cnpj(text: str) -> str:
    return re.sub(r"\D", "", text or "")


def parse_name(pdf_path: Path):
    stem = pdf_path.stem
    parts = stem.split("_")
    cnpj = normalize_cnpj(parts[0]) if parts else ""
    number = parts[1] if len(parts) > 1 else stem
    return cnpj, number


def send_pdf(pdf_path: Path):
    cnpj, number = parse_name(pdf_path)
    if not cnpj:
        raise ValueError("Nome do arquivo deve iniciar com CNPJ. Ex: 12345678000190_NF123.pdf")

    with pdf_path.open("rb") as f:
        file_bytes = f.read()

    files = {"file": (pdf_path.name, file_bytes, "application/pdf")}
    data = {
        "cnpj": cnpj,
        "invoice_number": number,
    }
    headers = {"x-sync-token": SYNC_TOKEN}
    res = requests.post(f"{API_URL}/invoices/sync", headers=headers, data=data, files=files, timeout=120)
    res.raise_for_status()
    return res.json()


def process_once():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    ERROR_DIR.mkdir(parents=True, exist_ok=True)

    for pdf_path in SOURCE_DIR.glob("*.pdf"):
        try:
            result = send_pdf(pdf_path)
            target = PROCESSED_DIR / pdf_path.name
            pdf_path.replace(target)
            print(f"OK {pdf_path.name}: {result.get('status')}")
        except Exception as exc:
            target = ERROR_DIR / pdf_path.name
            pdf_path.replace(target)
            print(f"ERRO {pdf_path.name}: {exc}")


def main():
    if not SYNC_TOKEN:
        raise SystemExit("Defina SYNC_TOKEN no ambiente.")

    if LOOP:
        while True:
            process_once()
            time.sleep(POLL_SECONDS)
    else:
        process_once()


if __name__ == "__main__":
    main()
