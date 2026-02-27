import os
import sys
import time
import tempfile
import subprocess
from pathlib import Path

import requests

try:
    import win32com.client  # type: ignore
except Exception as exc:  # pragma: no cover
    print(f"win32com import failed: {exc}")
    sys.exit(1)


API_URL = os.getenv("AGENT_API_URL", "http://localhost:8000").rstrip("/")
AGENT_TOKEN = os.getenv("AGENT_TOKEN", "")
POLL_SECONDS = int(os.getenv("AGENT_POLL_SECONDS", "5"))
WORKBOOK_PATH = os.getenv("EXTRATO_WORKBOOK_PATH", r"I:\PROJETO PORTAL REPRESENTANTE\EXTRATOS - FEVEREIRO 2026.xlsx")
PYAUTOGUI_SCRIPT = os.getenv("PYAUTOGUI_SCRIPT_PATH", "")
DEEP_DIVE_SHEET = os.getenv("EXTRATO_SHEET_NAME", "DEEP DIVE")
CUSTOMER_NAME = os.getenv("EXTRATO_CUSTOMER_NAME", "MERITO COMERCIO DE EQUIPAMENTOS LIM")
PRINT_AREA = os.getenv("EXTRATO_PRINT_AREA", "$A$1:$M$50")


def _headers():
    return {"x-agent-token": AGENT_TOKEN}


def _next_job():
    res = requests.get(f"{API_URL}/extrato/agent/next", headers=_headers(), timeout=30)
    res.raise_for_status()
    return res.json()


def _fail_job(job_id: int, message: str):
    requests.post(
        f"{API_URL}/extrato/agent/{job_id}/fail",
        params={"message": message[:900]},
        headers=_headers(),
        timeout=30,
    )


def _complete_job(job_id: int, pdf_path: Path):
    with open(pdf_path, "rb") as f:
        files = {"pdf": (pdf_path.name, f, "application/pdf")}
        res = requests.post(
            f"{API_URL}/extrato/agent/{job_id}/complete",
            headers=_headers(),
            files=files,
            timeout=120,
        )
        res.raise_for_status()


def _run_pyautogui_script():
    if not PYAUTOGUI_SCRIPT:
        return
    if not Path(PYAUTOGUI_SCRIPT).exists():
        raise FileNotFoundError(f"PYAUTOGUI_SCRIPT_PATH not found: {PYAUTOGUI_SCRIPT}")
    subprocess.run([sys.executable, PYAUTOGUI_SCRIPT], check=True)


def _generate_pdf(job_id: int, customer_name: str) -> Path:
    workbook = Path(WORKBOOK_PATH)
    if not workbook.exists():
        raise FileNotFoundError(f"Workbook not found: {workbook}")

    excel = win32com.client.DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    wb = None
    try:
        wb = excel.Workbooks.Open(str(workbook))
        wb.RefreshAll()
        excel.CalculateUntilAsyncQueriesDone()
        ws = wb.Worksheets(DEEP_DIVE_SHEET)
        ws.Range("A2").Value = customer_name or CUSTOMER_NAME
        excel.CalculateFullRebuild()
        ws.PageSetup.PrintArea = PRINT_AREA
        out_path = Path(tempfile.gettempdir()) / f"extrato_job_{job_id}.pdf"
        ws.ExportAsFixedFormat(0, str(out_path))
        return out_path
    finally:
        if wb is not None:
            wb.Close(SaveChanges=True)
        excel.Quit()


def _process(job: dict):
    if not job:
        return
    job_id = job["id"]
    customer_name = job.get("customer_name") or CUSTOMER_NAME
    try:
        _run_pyautogui_script()
        pdf_path = _generate_pdf(job_id, customer_name)
        _complete_job(job_id, pdf_path)
    except Exception as exc:
        _fail_job(job_id, str(exc))


def main():
    if not AGENT_TOKEN:
        print("Missing AGENT_TOKEN")
        sys.exit(1)

    print("Agent started")
    while True:
        try:
            job = _next_job()
            if job:
                _process(job)
            else:
                time.sleep(POLL_SECONDS)
        except Exception as exc:
            print(f"Agent loop error: {exc}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
