from datetime import datetime
import os
import re

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.dependencies import get_current_user, get_db

router = APIRouter(prefix="/pricing-v2", tags=["pricing-v2"])
TEST_CNPJ = "11111111111111"


def _normalize_cnpj(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _to_float(value) -> float:
    if value is None:
        return 0.0
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return 0.0
    text = text.replace("%", "").replace(" ", "")
    text = text.replace(".", "").replace(",", ".") if text.count(",") == 1 and text.count(".") > 1 else text
    try:
        return float(text)
    except Exception:
        return 0.0


def _parse_discount_seq(raw) -> list[float]:
    if raw is None:
        return []
    text = str(raw).strip()
    if not text or text.lower() == "nan":
        return []
    parts = [p.strip() for p in text.replace("%", "").split("+") if p.strip()]
    out = []
    for part in parts:
        try:
            out.append(float(part.replace(",", ".")))
        except Exception:
            continue
    return out


def _campaign_valid(vald_camp) -> bool:
    if vald_camp is None or str(vald_camp).strip() == "" or str(vald_camp).lower() == "nan":
        return False
    try:
        camp_date = pd.to_datetime(vald_camp).date()
        return camp_date >= datetime.utcnow().date()
    except Exception:
        return False


def _read_client_programs(path_csv: str) -> pd.DataFrame:
    if not os.path.exists(path_csv):
        raise HTTPException(status_code=500, detail=f"Client program file not found: {path_csv}")
    df = pd.read_csv(path_csv, sep="|", dtype=str, engine="python", on_bad_lines="skip")
    df.columns = [c.strip() for c in df.columns]
    for col in ["COD_EMPRESA", "COD_CLIENTE", "PROGRAMA", "CATEGORIA"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
    if "COD_EMPRESA" in df.columns:
        df = df[df["COD_EMPRESA"].str.contains(r"^\d+$", na=False)]
    return df


def _read_discounts(path_xlsm: str):
    if not os.path.exists(path_xlsm):
        raise HTTPException(status_code=500, detail=f"Discount workbook not found: {path_xlsm}")
    prog = pd.read_excel(path_xlsm, sheet_name="PROG_DESC_ITEM", dtype=str)
    cli = pd.read_excel(path_xlsm, sheet_name="PROG_DESC_ITEM_CLI", dtype=str)
    uf = pd.read_excel(path_xlsm, sheet_name="UF_ITEM", dtype=str)
    for df in [prog, cli, uf]:
        df.columns = [c.strip() for c in df.columns]
        for c in df.columns:
            df[c] = df[c].astype(str).str.strip()
    if "ESTADO" in uf.columns and "COD_UF" not in uf.columns:
        uf = uf.rename(columns={"ESTADO": "COD_UF"})
    return prog, cli, uf


def _read_master(path_master: str) -> pd.DataFrame:
    if not os.path.exists(path_master):
        raise HTTPException(status_code=500, detail=f"Master workbook not found: {path_master}")
    df = pd.read_excel(path_master, dtype=str)
    df.columns = [c.strip() for c in df.columns]
    for col in ["UF", "COD_ITEM", "PRE_UNIT", "ALIQ_IPI", "ALIQ_ST", "IVA"]:
        if col not in df.columns:
            raise HTTPException(status_code=500, detail=f"Missing column in master sheet: {col}")
    return df


@router.get("/my-table")
def my_table_v2(db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        if _normalize_cnpj(user.cnpj) != TEST_CNPJ:
            return {"status": "em desenvolvimento"}
        if not user.uf:
            raise HTTPException(status_code=400, detail="User UF not set")

        master = _read_master(settings.pricing_master_path)
        prog_desc, cli_desc, uf_desc = _read_discounts(settings.pricing_discounts_path)
        client_prog = _read_client_programs(settings.pricing_client_program_path)

        required_client_cols = {"COD_CLIENTE", "PROGRAMA", "CATEGORIA"}
        missing = required_client_cols - set(client_prog.columns)
        if missing:
            raise HTTPException(status_code=500, detail=f"Missing columns in client program file: {', '.join(sorted(missing))}")

        cnpj = _normalize_cnpj(user.cnpj)
        uf = str(user.uf).strip().upper()

        cp = client_prog[client_prog["COD_CLIENTE"].apply(_normalize_cnpj) == cnpj]
        if cp.empty:
            raise HTTPException(status_code=404, detail="Program/categoria not found for client")

        programa = str(cp.iloc[0]["PROGRAMA"]).strip().upper()
        categoria = str(cp.iloc[0]["CATEGORIA"]).strip().upper()

        base = master[master["UF"].astype(str).str.strip().str.upper() == uf].copy()
        if base.empty:
            raise HTTPException(status_code=404, detail=f"No master prices found for UF {uf}")

        if all(c in prog_desc.columns for c in ["PROGRAMA", "CATEGORIA", "COD_ITEM"]):
            pmap = prog_desc[(prog_desc["PROGRAMA"].str.upper() == programa) & (prog_desc["CATEGORIA"].str.upper() == categoria)]
            pmap = pmap.set_index("COD_ITEM") if not pmap.empty else pd.DataFrame()
        else:
            pmap = pd.DataFrame()

        if all(c in cli_desc.columns for c in ["COD_CLIENTE", "COD_ITEM"]):
            cmap = cli_desc[cli_desc["COD_CLIENTE"].apply(_normalize_cnpj) == cnpj]
            cmap = cmap.set_index("COD_ITEM") if not cmap.empty else pd.DataFrame()
        else:
            cmap = pd.DataFrame()

        if "COD_UF" in uf_desc.columns and "COD_ITEM" in uf_desc.columns:
            umap = uf_desc[uf_desc["COD_UF"].str.upper() == uf]
            umap = umap.set_index("COD_ITEM") if not umap.empty else pd.DataFrame()
        else:
            umap = pd.DataFrame()

        rows = []
        for _, row in base.iterrows():
            cod_item = str(row.get("COD_ITEM", "")).strip()
            if not cod_item:
                continue

            seq = []
            if not pmap.empty and cod_item in pmap.index:
                r = pmap.loc[cod_item]
                if isinstance(r, pd.DataFrame):
                    r = r.iloc[0]
                seq += _parse_discount_seq(r.get("DESC_BASE"))
                seq += _parse_discount_seq(r.get("DESC_REDU"))
                seq += _parse_discount_seq(r.get("DESC_PROG"))
                if _campaign_valid(r.get("VALD_CAMP")):
                    seq += _parse_discount_seq(r.get("DESC_CAMP"))

            if not cmap.empty and cod_item in cmap.index:
                r = cmap.loc[cod_item]
                if isinstance(r, pd.DataFrame):
                    r = r.iloc[0]
                seq += _parse_discount_seq(r.get("DESC_CLI"))

            if not umap.empty and cod_item in umap.index:
                r = umap.loc[cod_item]
                if isinstance(r, pd.DataFrame):
                    r = r.iloc[0]
                seq += _parse_discount_seq(r.get("DESC_UF"))

            price = _to_float(row.get("PRE_UNIT"))
            for pct in seq:
                price = price * (1 - (pct / 100.0))

            aliq_ipi = _to_float(row.get("ALIQ_IPI"))
            aliq_st = _to_float(row.get("ALIQ_ST"))
            valor_ipi = price * (aliq_ipi / 100.0)
            valor_st = price * (aliq_st / 100.0)

            rows.append(
                {
                    "UF": uf,
                    "COD_ITEM": cod_item,
                    "DEN_ITEM": row.get("DEN_ITEM"),
                    "PRE_UNIT": round(_to_float(row.get("PRE_UNIT")), 2),
                    "DESCONTOS_CASCATA": "+".join(str(int(x) if float(x).is_integer() else x) for x in seq),
                    "BASE_LIQUIDA": round(price, 2),
                    "ALIQ_IPI": aliq_ipi,
                    "ALIQ_ST": aliq_st,
                    "VALOR_IPI": round(valor_ipi, 2),
                    "VALOR_ST": round(valor_st, 2),
                    "VALOR_FINAL": round(price + valor_ipi + valor_st, 2),
                    "PROGRAMA": programa,
                    "CATEGORIA": categoria,
                }
            )

        return {
            "status": "ok",
            "client_cnpj": cnpj,
            "programa": programa,
            "categoria": categoria,
            "rows": rows,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"pricing-v2 error: {str(exc)}")
