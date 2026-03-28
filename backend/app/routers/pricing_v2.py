from datetime import datetime
import io
import logging
import os
import re

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import models
from app.constants import UF_CODE_SET
from app.core.config import settings
from app.dependencies import get_current_admin, get_current_user, get_db

router = APIRouter(prefix="/pricing-v2", tags=["pricing-v2"])
logger = logging.getLogger(__name__)
TEST_CNPJ = "058352792000143"
CALCULATED_TITLE = "TABELA DE PRECO CALCULADA"
CALCULATED_COLUMNS = [
    "UF",
    "COD_ITEM",
    "DEN_ITEM",
    "PRE_UNIT",
    "VALOR_FINAL",
    "PROGRAMA",
    "CATEGORIA",
]


def _normalize_cnpj(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _normalize_uf(value: str | None) -> str:
    return str(value or "").strip().upper()


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

def _category_fallback(categoria: str) -> str | None:
    if not categoria:
        return None
    if categoria.strip().upper() == "STANDARD":
        return "PADRAO"
    return None



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


def _is_test_user(user) -> bool:
    return _normalize_cnpj(user.cnpj) == TEST_CNPJ


def _get_effective_pricing_uf(user, uf_override: str | None = None) -> str:
    uf = _normalize_uf(uf_override) if uf_override else _normalize_uf(getattr(user, "uf", None))
    if not uf:
        raise HTTPException(status_code=400, detail="User UF not set")
    if uf not in UF_CODE_SET:
        raise HTTPException(status_code=400, detail="UF invalid")
    return uf


def _bulk_insert(db: Session, model_cls, rows: list[dict], chunk_size: int = 2000):
    if not rows:
        return
    safe_rows = [r for r in rows if isinstance(r, dict)]
    if not safe_rows:
        return
    for i in range(0, len(safe_rows), chunk_size):
        chunk = safe_rows[i:i + chunk_size]
        db.bulk_insert_mappings(model_cls, chunk)


def _load_sources_to_db(db: Session):
    master = _read_master(settings.pricing_master_path)
    prog_desc, cli_desc, uf_desc = _read_discounts(settings.pricing_discounts_path)
    client_prog = _read_client_programs(settings.pricing_client_program_path)

    db.query(models.PricingMasterItem).delete()
    db.query(models.PricingClientProgram).delete()
    db.query(models.PricingProgramItemDiscount).delete()
    db.query(models.PricingClientItemDiscount).delete()
    db.query(models.PricingUfItemDiscount).delete()

    master_rows = []
    for _, row in master.iterrows():
        cod_item = str(row.get("COD_ITEM", "")).strip()
        uf = str(row.get("UF", "")).strip().upper()
        if not cod_item or not uf:
            continue
        master_rows.append(
            {
                "uf": uf,
                "num_list": str(row.get("NUM_LIST", "")).strip() or None,
                "den_list": str(row.get("DEN_LIST", "")).strip() or None,
                "cod_item": cod_item,
                "den_item": str(row.get("DEN_ITEM", "")).strip() or None,
                "um": str(row.get("UM", "")).strip() or None,
                "cla_fisc": str(row.get("CLA_FISC", "")).strip() or None,
                "pre_unit": _to_float(row.get("PRE_UNIT")),
                "aliq_ipi": _to_float(row.get("ALIQ_IPI")),
                "iva": _to_float(row.get("IVA")),
                "aliq_st": _to_float(row.get("ALIQ_ST")),
            }
        )

    client_rows_map = {}
    for _, row in client_prog.iterrows():
        cnpj = _normalize_cnpj(row.get("COD_CLIENTE"))
        programa = str(row.get("PROGRAMA", "")).strip().upper()
        categoria = str(row.get("CATEGORIA", "")).strip().upper()
        if not cnpj or not programa or not categoria:
            continue
        key = (cnpj, programa, categoria)
        client_rows_map[key] = {
            "cod_empresa": str(row.get("COD_EMPRESA", "")).strip() or None,
            "cod_cliente": cnpj,
            "programa": programa,
            "categoria": categoria,
        }
    client_rows = list(client_rows_map.values())

    prog_rows = []
    for _, row in prog_desc.iterrows():
        cod_item = str(row.get("COD_ITEM", "")).strip()
        programa = str(row.get("PROGRAMA", "")).strip().upper()
        categoria = str(row.get("CATEGORIA", "")).strip().upper()
        if not cod_item or not programa or not categoria:
            continue
        prog_rows.append(
            {
                "cod_empresa": str(row.get("COD_EMPRESA", "")).strip() or None,
                "programa": programa,
                "categoria": categoria,
                "cod_item": cod_item,
                "desc_base": str(row.get("DESC_BASE", "")).strip() or None,
                "desc_redu": str(row.get("DESC_REDU", "")).strip() or None,
                "desc_prog": str(row.get("DESC_PROG", "")).strip() or None,
                "desc_camp": str(row.get("DESC_CAMP", "")).strip() or None,
                "vald_camp": None if pd.isna(pd.to_datetime(row.get("VALD_CAMP"), errors="coerce")) else pd.to_datetime(row.get("VALD_CAMP"), errors="coerce"),
            }
        )

    cli_rows = []
    for _, row in cli_desc.iterrows():
        cod_item = str(row.get("COD_ITEM", "")).strip()
        cnpj = _normalize_cnpj(row.get("COD_CLIENTE"))
        if not cod_item or not cnpj:
            continue
        cli_rows.append(
            {
                "cod_empresa": str(row.get("COD_EMPRESA", "")).strip() or None,
                "cod_cliente": cnpj,
                "cod_item": cod_item,
                "desc_cli": str(row.get("DESC_CLI", "")).strip() or None,
            }
        )

    uf_rows = []
    for _, row in uf_desc.iterrows():
        cod_item = str(row.get("COD_ITEM", "")).strip()
        cod_uf = str(row.get("COD_UF", "")).strip().upper()
        if not cod_item or not cod_uf:
            continue
        uf_rows.append(
            {
                "cod_empresa": str(row.get("COD_EMPRESA", "")).strip() or None,
                "cod_uf": cod_uf,
                "cod_item": cod_item,
                "desc_uf": str(row.get("DESC_UF", "")).strip() or None,
            }
        )

    _bulk_insert(db, models.PricingMasterItem, master_rows)
    _bulk_insert(db, models.PricingClientProgram, client_rows)
    _bulk_insert(db, models.PricingProgramItemDiscount, prog_rows)
    _bulk_insert(db, models.PricingClientItemDiscount, cli_rows)
    _bulk_insert(db, models.PricingUfItemDiscount, uf_rows)

    return {
        "master_rows": len(master_rows),
        "client_program_rows": len(client_rows),
        "program_discount_rows": len(prog_rows),
        "client_discount_rows": len(cli_rows),
        "uf_discount_rows": len(uf_rows),
    }


def _list_client_programs(db: Session, cnpj: str) -> list[tuple[str, str]]:
    rows = db.query(models.PricingClientProgram).filter(
        models.PricingClientProgram.cod_cliente == _normalize_cnpj(cnpj)
    ).all()
    out = []
    for r in rows:
        prog = (r.programa or "").strip().upper()
        cat = (r.categoria or "").strip().upper()
        if prog and cat:
            out.append((prog, cat))
    seen = set()
    uniq = []
    for p, c in out:
        key = (p, c)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(key)
    return uniq


def _list_master_ufs(db: Session) -> list[str]:
    rows = db.query(models.PricingMasterItem.uf).distinct().order_by(models.PricingMasterItem.uf.asc()).all()
    out = []
    for raw_uf, in rows:
        uf = _normalize_uf(raw_uf)
        if uf:
            out.append(uf)
    return out


def _compute_rows_from_db(db: Session, cnpj: str, uf: str, programa: str, categoria: str) -> tuple[str, str, list[dict]]:

    base_items = db.query(models.PricingMasterItem).filter(models.PricingMasterItem.uf == uf).all()
    if not base_items:
        raise HTTPException(status_code=404, detail=f"No master prices found for UF {uf}")

    pmap = {
        item.cod_item: item
        for item in db.query(models.PricingProgramItemDiscount).filter(
            models.PricingProgramItemDiscount.programa == programa,
            models.PricingProgramItemDiscount.categoria == categoria,
        ).all()
    }
    if not pmap:
        fallback = _category_fallback(categoria)
        if fallback:
            pmap = {
                item.cod_item: item
                for item in db.query(models.PricingProgramItemDiscount).filter(
                    models.PricingProgramItemDiscount.programa == programa,
                    models.PricingProgramItemDiscount.categoria == fallback,
                ).all()
            }
    cmap = {
        item.cod_item: item
        for item in db.query(models.PricingClientItemDiscount).filter(
            models.PricingClientItemDiscount.cod_cliente == cnpj
        ).all()
    }
    umap = {
        item.cod_item: item
        for item in db.query(models.PricingUfItemDiscount).filter(
            models.PricingUfItemDiscount.cod_uf == uf
        ).all()
    }

    rows = []
    for item in base_items:
        cod_item = item.cod_item
        seq = []

        p = pmap.get(cod_item)
        if p is not None:
            seq += _parse_discount_seq(p.desc_base)
            seq += _parse_discount_seq(p.desc_redu)
            seq += _parse_discount_seq(p.desc_prog)
            if _campaign_valid(p.vald_camp):
                seq += _parse_discount_seq(p.desc_camp)

        c = cmap.get(cod_item)
        if c is not None:
            seq += _parse_discount_seq(c.desc_cli)

        u = umap.get(cod_item)
        if u is not None:
            seq += _parse_discount_seq(u.desc_uf)

        price = float(item.pre_unit or 0.0)
        for pct in seq:
            price = price * (1 - (pct / 100.0))

        aliq_ipi = float(item.aliq_ipi or 0.0)
        aliq_st = float(item.aliq_st or 0.0)
        valor_ipi = price * (aliq_ipi / 100.0)
        valor_st = price * (aliq_st / 100.0)

        rows.append(
            {
                "UF": uf,
                "COD_ITEM": cod_item,
                "DEN_ITEM": item.den_item,
                "PRE_UNIT": round(float(item.pre_unit or 0.0), 2),
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

    return programa, categoria, rows


def _upsert_cache(db: Session, cnpj: str, uf: str, programa: str, categoria: str, rows: list[dict], source: str):
    db.query(models.PricingResultCache).filter(
        models.PricingResultCache.cnpj == cnpj,
        models.PricingResultCache.uf == uf,
        models.PricingResultCache.programa == programa,
        models.PricingResultCache.categoria == categoria,
    ).delete()

    now = datetime.utcnow()
    payload = []
    for row in rows:
        payload.append(
            {
                "cnpj": cnpj,
                "uf": uf,
                "cod_item": row.get("COD_ITEM"),
                "den_item": row.get("DEN_ITEM"),
                "pre_unit": _to_float(row.get("PRE_UNIT")),
                "descontos_cascata": row.get("DESCONTOS_CASCATA"),
                "base_liquida": _to_float(row.get("BASE_LIQUIDA")),
                "aliq_ipi": _to_float(row.get("ALIQ_IPI")),
                "aliq_st": _to_float(row.get("ALIQ_ST")),
                "valor_ipi": _to_float(row.get("VALOR_IPI")),
                "valor_st": _to_float(row.get("VALOR_ST")),
                "valor_final": _to_float(row.get("VALOR_FINAL")),
                "programa": programa,
                "categoria": categoria,
                "source": source,
                "updated_at": now,
            }
        )
    _bulk_insert(db, models.PricingResultCache, payload)


def _get_cached_rows(db: Session, cnpj: str, uf: str, programa: str, categoria: str) -> tuple[str, str, list[dict]]:
    cache_rows = db.query(models.PricingResultCache).filter(
        models.PricingResultCache.cnpj == cnpj,
        models.PricingResultCache.uf == uf,
        models.PricingResultCache.programa == programa,
        models.PricingResultCache.categoria == categoria,
    ).order_by(models.PricingResultCache.cod_item.asc()).all()

    if not cache_rows:
        return "", "", []

    rows = []
    for r in cache_rows:
        rows.append(
            {
                "UF": r.uf,
                "COD_ITEM": r.cod_item,
                "DEN_ITEM": r.den_item,
                "PRE_UNIT": round(float(r.pre_unit or 0.0), 2),
                "DESCONTOS_CASCATA": r.descontos_cascata or "",
                "BASE_LIQUIDA": round(float(r.base_liquida or 0.0), 2),
                "ALIQ_IPI": float(r.aliq_ipi or 0.0),
                "ALIQ_ST": float(r.aliq_st or 0.0),
                "VALOR_IPI": round(float(r.valor_ipi or 0.0), 2),
                "VALOR_ST": round(float(r.valor_st or 0.0), 2),
                "VALOR_FINAL": round(float(r.valor_final or 0.0), 2),
                "PROGRAMA": r.programa,
                "CATEGORIA": r.categoria,
            }
        )
    return programa, categoria, rows


def _build_payload_from_files(user, programa: str, categoria: str, uf_override: str | None = None) -> dict:
    master = _read_master(settings.pricing_master_path)
    prog_desc, cli_desc, uf_desc = _read_discounts(settings.pricing_discounts_path)
    client_prog = _read_client_programs(settings.pricing_client_program_path)

    required_client_cols = {"COD_CLIENTE", "PROGRAMA", "CATEGORIA"}
    missing = required_client_cols - set(client_prog.columns)
    if missing:
        raise HTTPException(status_code=500, detail=f"Missing columns in client program file: {', '.join(sorted(missing))}")

    cnpj = _normalize_cnpj(user.cnpj)
    uf = _get_effective_pricing_uf(user, uf_override)

    cp = client_prog[client_prog["COD_CLIENTE"].apply(_normalize_cnpj) == cnpj]
    if cp.empty:
        raise HTTPException(status_code=404, detail="Program/categoria not found for client")

    programa = str(programa).strip().upper()
    categoria = str(categoria).strip().upper()

    base = master[master["UF"].astype(str).str.strip().str.upper() == uf].copy()
    if base.empty:
        raise HTTPException(status_code=404, detail=f"No master prices found for UF {uf}")

    if all(c in prog_desc.columns for c in ["PROGRAMA", "CATEGORIA", "COD_ITEM"]):
        pmap = prog_desc[(prog_desc["PROGRAMA"].str.upper() == programa) & (prog_desc["CATEGORIA"].str.upper() == categoria)]
        if pmap.empty:
            fallback = _category_fallback(categoria)
            if fallback:
                pmap = prog_desc[(prog_desc["PROGRAMA"].str.upper() == programa) & (prog_desc["CATEGORIA"].str.upper() == fallback)]
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
        "title": CALCULATED_TITLE,
        "client_cnpj": cnpj,
        "programa": programa,
        "categoria": categoria,
        "rows": rows,
        "source": "file",
    }


def _build_pricing_payload(
    user,
    db: Session,
    programa: str | None = None,
    categoria: str | None = None,
    strict_test_user: bool = False,
    uf_override: str | None = None,
) -> dict:
    if not _is_test_user(user):
        if strict_test_user:
            raise HTTPException(status_code=403, detail="em desenvolvimento")
        return {"status": "em desenvolvimento"}

    cnpj = _normalize_cnpj(user.cnpj)
    uf = _get_effective_pricing_uf(user, uf_override)

    programs = _list_client_programs(db, cnpj)
    if not programs:
        raise HTTPException(status_code=404, detail="Program/categoria not found for client")
    if programa and categoria:
        target = (str(programa).strip().upper(), str(categoria).strip().upper())
        if target not in programs:
            raise HTTPException(status_code=404, detail="Program/categoria not found for client")
        programa, categoria = target
    else:
        programa, categoria = programs[0]

    programa, categoria, rows = _get_cached_rows(db, cnpj, uf, programa, categoria)
    if not rows:
        try:
            programa, categoria, rows = _compute_rows_from_db(db, cnpj, uf, programa, categoria)
            _upsert_cache(db, cnpj, uf, programa, categoria, rows, source="db")
            db.commit()
        except Exception:
            db.rollback()
            file_payload = _build_payload_from_files(user, programa, categoria, uf_override=uf)
            _upsert_cache(
                db,
                cnpj,
                uf,
                file_payload["programa"],
                file_payload["categoria"],
                file_payload["rows"],
                source="file",
            )
            db.commit()
            programa = file_payload["programa"]
            categoria = file_payload["categoria"]
            rows = file_payload["rows"]

    return {
        "status": "ok",
        "title": CALCULATED_TITLE,
        "client_cnpj": cnpj,
        "programa": programa,
        "categoria": categoria,
        "rows": rows,
    }


@router.post("/sync")
def sync_pricing_sources(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    try:
        stats = _load_sources_to_db(db) or {}
        db.query(models.PricingResultCache).delete()
        test_user = db.query(models.User).filter(models.User.cnpj == TEST_CNPJ).first()
        rebuilt_cache = False
        rebuilt_cache_states = []
        rebuilt_cache_tables = 0
        if test_user:
            programs = _list_client_programs(db, TEST_CNPJ)
            for uf in _list_master_ufs(db):
                for programa, categoria in programs:
                    programa, categoria, rows = _compute_rows_from_db(db, TEST_CNPJ, uf, programa, categoria)
                    _upsert_cache(db, TEST_CNPJ, uf, programa, categoria, rows, source="db")
                    rebuilt_cache_tables += 1
                if programs:
                    rebuilt_cache_states.append(uf)
            rebuilt_cache = rebuilt_cache_tables > 0
        db.commit()
        return {
            "status": "ok",
            "rebuilt_cache": rebuilt_cache,
            "rebuilt_cache_states": rebuilt_cache_states,
            "rebuilt_cache_tables": rebuilt_cache_tables,
            **stats,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Unexpected pricing-v2 sync error")
        raise HTTPException(status_code=500, detail="Unexpected pricing sync error")


@router.get("/my-tables")
def my_tables(db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not _is_test_user(user):
        return {"status": "em desenvolvimento", "items": []}
    cnpj = _normalize_cnpj(user.cnpj)
    items = []
    for programa, categoria in _list_client_programs(db, cnpj):
        sheet_id = f"pricing-v2:{programa}:{categoria}"
        title = f"TABELA DE PRECO {programa} {categoria}"
        items.append({"id": sheet_id, "title": title, "programa": programa, "categoria": categoria})
    return {"status": "ok", "items": items}


@router.get("/my-table")
def my_table_v2(
    uf: str | None = Query(None, min_length=2, max_length=2),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        return _build_pricing_payload(user, db, uf_override=uf)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected pricing-v2 my-table error")
        raise HTTPException(status_code=500, detail="Unexpected pricing error")


@router.get("/my-table/data")
def my_table_v2_data(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    search: str | None = None,
    col: str | None = None,
    programa: str | None = None,
    categoria: str | None = None,
    uf: str | None = Query(None, min_length=2, max_length=2),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        payload = _build_pricing_payload(
            user,
            db,
            programa=programa,
            categoria=categoria,
            strict_test_user=True,
            uf_override=uf,
        )
        df = pd.DataFrame(payload["rows"], columns=CALCULATED_COLUMNS)
        if search:
            if col and col in df.columns:
                mask = df[col].astype(str).str.contains(search, case=False, na=False)
            else:
                mask = df.astype(str).apply(lambda r: r.str.contains(search, case=False, na=False)).any(axis=1)
            df = df[mask]

        df = df.iloc[offset:offset + limit]
        return {"columns": CALCULATED_COLUMNS, "rows": df.to_dict(orient="records")}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected pricing-v2 data error")
        raise HTTPException(status_code=500, detail="Unexpected pricing error")


@router.get("/my-table/download")
def my_table_v2_download(
    format: str = Query("excel", pattern="^(excel|csv)$"),
    programa: str | None = None,
    categoria: str | None = None,
    uf: str | None = Query(None, min_length=2, max_length=2),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        payload = _build_pricing_payload(
            user,
            db,
            programa=programa,
            categoria=categoria,
            strict_test_user=True,
            uf_override=uf,
        )
        df = pd.DataFrame(payload["rows"], columns=CALCULATED_COLUMNS)
        safe_title = re.sub(r"[^\w\- ]", "", payload.get("title") or CALCULATED_TITLE).strip().replace(" ", "_")

        if format == "csv":
            buffer = io.StringIO()
            df.to_csv(buffer, index=False)
            data = io.BytesIO(buffer.getvalue().encode("utf-8"))
            headers = {"Content-Disposition": f'attachment; filename="{safe_title}.csv"'}
            return StreamingResponse(data, media_type="text/csv", headers=headers)

        data = io.BytesIO()
        with pd.ExcelWriter(data, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Tabela")
        data.seek(0)
        headers = {"Content-Disposition": f'attachment; filename="{safe_title}.xlsx"'}
        return StreamingResponse(
            data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected pricing-v2 download error")
        raise HTTPException(status_code=500, detail="Unexpected pricing error")
