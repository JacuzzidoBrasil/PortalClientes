from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
from app import models, schemas
from app.dependencies import get_db, get_current_admin
from app.auth import hash_password
from app.constants import UF_CODE_SET
import secrets
from app.core.config import settings
import os
import uuid
import re

router = APIRouter(prefix="/admin", tags=["admin"])


def _normalize_uf(uf: str | None) -> str | None:
    if uf is None:
        return None
    normalized = uf.strip().upper()
    return normalized or None


def _sync_user_uf_access_levels(db: Session, user: models.User, selected_access_level_ids: list[int]):
    if not user.uf:
        return
    selected_ids = set(selected_access_level_ids or [])
    levels = db.query(models.AccessLevel).all()
    uf_level_ids = {level.id for level in levels if level.name in UF_CODE_SET}
    user_uf_level = next((level for level in levels if level.name == user.uf), None)
    selected_ids -= uf_level_ids
    if user_uf_level:
        selected_ids.add(user_uf_level.id)
    user.access_levels = [level for level in levels if level.id in selected_ids]


def _access_level_to_pricing(level_name: str) -> tuple[str, str] | None:
    if not level_name:
        return None
    name = re.sub(r"\s+", " ", level_name.strip().lower())
    name = name.replace("regional", "").strip()
    if "deep dive" in name:
        category = name.replace("deep dive", "").strip().upper()
        return ("DEEPDIVE", category or "STANDARD")
    if "restore you" in name:
        category = name.replace("restore you", "").strip().upper()
        return ("RESTOREYOU", category or "STANDARD")
    if "grow2gether" in name:
        return ("GROW2GETHER", "GROW2GETHER")
    if "express" in name:
        return ("EXPRESS", "EXPRESS")
    if "ecommerce" in name:
        return ("ECOMMERCE", "STANDARD")
    return None


def _sync_pricing_programs(db: Session, user: models.User):
    cnpj = re.sub(r"\D", "", user.cnpj or "")
    if not cnpj:
        return
    programs = []
    for level in user.access_levels:
        mapped = _access_level_to_pricing(level.name)
        if mapped:
            programs.append(mapped)
    # unique preserve order
    seen = set()
    uniq = []
    for p in programs:
        if p in seen:
            continue
        seen.add(p)
        uniq.append(p)
    db.query(models.PricingClientProgram).filter(models.PricingClientProgram.cod_cliente == cnpj).delete()
    for programa, categoria in uniq:
        db.add(models.PricingClientProgram(
            cod_empresa="01",
            cod_cliente=cnpj,
            programa=programa,
            categoria=categoria,
        ))


@router.get("/access-levels", response_model=list[schemas.AccessLevelItem])
def list_access_levels(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    levels = db.query(models.AccessLevel).order_by(models.AccessLevel.name.asc()).all()
    return [{"id": l.id, "name": l.name} for l in levels]

@router.get("/users", response_model=list[schemas.UserItem])
def list_users(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    users = db.query(models.User).all()
    return [
        {
            "id": u.id,
            "cnpj": u.cnpj,
            "name": u.name,
            "email": u.email,
            "uf": u.uf,
            "is_admin": u.is_admin,
            "access_levels": [{"id": al.id, "name": al.name} for al in u.access_levels],
        }
        for u in users
    ]

@router.post("/users")
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if db.query(models.User).filter(models.User.cnpj == payload.cnpj).first():
        raise HTTPException(status_code=400, detail="CNPJ already exists")
    uf = _normalize_uf(payload.uf)
    if not uf or uf not in UF_CODE_SET:
        raise HTTPException(status_code=400, detail="UF invalid")

    raw_password = payload.password or secrets.token_urlsafe(16)
    user = models.User(
        cnpj=payload.cnpj,
        name=payload.name,
        email=payload.email,
        uf=uf,
        password_hash=hash_password(raw_password),
        is_admin=payload.is_admin,
        first_access_completed=False,
    )
    _sync_user_uf_access_levels(db, user, payload.access_level_ids)
    db.add(user)
    db.commit()
    db.refresh(user)
    _sync_pricing_programs(db, user)
    db.commit()
    db.refresh(user)
    return {"id": user.id}

@router.put("/users/{user_id}/access-levels")
def update_user_access_levels(
    user_id: int,
    payload: schemas.UserAccessUpdate,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _sync_user_uf_access_levels(db, user, payload.access_level_ids)
    db.commit()
    _sync_pricing_programs(db, user)
    db.commit()
    return {"status": "ok"}

@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    db.delete(user)
    db.commit()
    return {"status": "deleted"}

@router.get("/spreadsheets", response_model=list[schemas.SpreadsheetItemAdmin])
def list_spreadsheets_admin(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    items = db.query(models.Spreadsheet).all()
    return [
        {
            "id": s.id,
            "title": s.title,
            "access_levels": [{"id": al.id, "name": al.name} for al in s.access_levels],
        }
        for s in items
    ]

@router.post("/spreadsheets")
def upload_spreadsheet(
    title: str = Form(...),
    access_level_ids: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    os.makedirs(settings.upload_dir, exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".xlsx", ".xls", ".csv"]:
        raise HTTPException(status_code=400, detail="Unsupported file")

    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(settings.upload_dir, filename)
    with open(file_path, "wb") as f:
        f.write(file.file.read())

    spreadsheet = models.Spreadsheet(title=title, file_path=file_path, uploaded_by=admin.id)
    access_ids = []
    if access_level_ids:
        try:
            access_ids = [int(x) for x in access_level_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="access_level_ids must be comma-separated integers")

    access_levels = db.query(models.AccessLevel).filter(models.AccessLevel.id.in_(access_ids)).all() if access_ids else []
    spreadsheet.access_levels = access_levels
    db.add(spreadsheet)
    db.commit()
    db.refresh(spreadsheet)
    return {"id": spreadsheet.id}

@router.delete("/spreadsheets/{spreadsheet_id}")
def delete_spreadsheet(spreadsheet_id: int, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    s = db.query(models.Spreadsheet).filter(models.Spreadsheet.id == spreadsheet_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Spreadsheet not found")
    file_path = s.file_path
    db.delete(s)
    db.commit()
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass
    return {"status": "deleted"}
