from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app import models
from app.dependencies import get_db, get_current_user
import pandas as pd
import numpy as np
import os
import re
import unicodedata

router = APIRouter(prefix="/spreadsheets", tags=["spreadsheets"])


def _normalize_text(text: str) -> str:
    base = unicodedata.normalize("NFKD", str(text))
    return "".join(ch for ch in base if not unicodedata.combining(ch)).lower()


def _is_currency_column(column_name: str) -> bool:
    normalized = _normalize_text(column_name)
    return "preco" in normalized or "valor" in normalized


def _to_float(value):
    if value is None:
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        if pd.isna(value) or np.isinf(value):
            return None
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    # Handles values such as "R$ 1.467,23", "1467.23", "1,467.23"
    text = text.replace("R$", "").replace(" ", "")
    text = re.sub(r"[^0-9,.\-]", "", text)
    if not text:
        return None

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")

    try:
        return float(text)
    except ValueError:
        return None


def _format_brl(value):
    number = _to_float(value)
    if number is None:
        return value
    formatted = f"{number:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"

@router.get("")
def list_spreadsheets(db: Session = Depends(get_db), user=Depends(get_current_user)):
    if user.is_admin:
        items = db.query(models.Spreadsheet).all()
    else:
        items = (
            db.query(models.Spreadsheet)
            .join(models.spreadsheet_access)
            .join(models.AccessLevel)
            .join(models.user_access_levels)
            .filter(models.user_access_levels.c.user_id == user.id)
            .distinct()
            .all()
        )
    return [{"id": s.id, "title": s.title} for s in items]

@router.get("/{spreadsheet_id}/data")
def get_spreadsheet_data(
    spreadsheet_id: int,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    search: str | None = None,
    col: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    s = db.query(models.Spreadsheet).filter(models.Spreadsheet.id == spreadsheet_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Not found")

    if not user.is_admin:
        allowed = (
            db.query(models.Spreadsheet)
            .join(models.spreadsheet_access)
            .join(models.AccessLevel)
            .join(models.user_access_levels)
            .filter(models.Spreadsheet.id == spreadsheet_id)
            .filter(models.user_access_levels.c.user_id == user.id)
            .first()
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Forbidden")

    if not os.path.exists(s.file_path):
        raise HTTPException(status_code=404, detail="File missing")

    ext = os.path.splitext(s.file_path)[1].lower()
    if ext == ".csv":
        df = pd.read_csv(s.file_path)
    else:
        df = pd.read_excel(s.file_path)

    if search:
        if col and col in df.columns:
            mask = df[col].astype(str).str.contains(search, case=False, na=False)
        else:
            mask = df.astype(str).apply(lambda row: row.str.contains(search, case=False, na=False)).any(axis=1)
        df = df[mask]

    df = df.iloc[offset:offset + limit]
    for column in df.columns:
        if _is_currency_column(column):
            df[column] = df[column].apply(_format_brl)
    # sanitize to JSON-safe values
    df = df.replace({np.inf: None, -np.inf: None, np.nan: None})
    return {
        "columns": list(df.columns),
        "rows": df.to_dict(orient="records"),
    }

@router.get("/{spreadsheet_id}/download")
def download_spreadsheet(
    spreadsheet_id: int,
    format: str = Query("excel", pattern="^(excel|csv)$"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    s = db.query(models.Spreadsheet).filter(models.Spreadsheet.id == spreadsheet_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Not found")

    if not user.is_admin:
        allowed = (
            db.query(models.Spreadsheet)
            .join(models.spreadsheet_access)
            .join(models.AccessLevel)
            .join(models.user_access_levels)
            .filter(models.Spreadsheet.id == spreadsheet_id)
            .filter(models.user_access_levels.c.user_id == user.id)
            .first()
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Forbidden")

    if not os.path.exists(s.file_path):
        raise HTTPException(status_code=404, detail="File missing")

    if format == "excel":
        filename = f"{s.title}.xlsx"
        return FileResponse(s.file_path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=filename)

    # CSV generation on the fly
    ext = os.path.splitext(s.file_path)[1].lower()
    if ext == ".csv":
        return FileResponse(s.file_path, media_type="text/csv", filename=f"{s.title}.csv")

    df = pd.read_excel(s.file_path)
    temp_csv = os.path.join(os.path.dirname(s.file_path), f"{s.id}_temp.csv")
    df.to_csv(temp_csv, index=False)
    return FileResponse(temp_csv, media_type="text/csv", filename=f"{s.title}.csv")
