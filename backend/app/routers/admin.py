from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
from app import models, schemas
from app.dependencies import get_db, get_current_admin
from app.auth import hash_password
from app.core.config import settings
import os
import uuid

router = APIRouter(prefix="/admin", tags=["admin"])

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
            "is_admin": u.is_admin,
            "access_levels": [{"id": al.id, "name": al.name} for al in u.access_levels],
        }
        for u in users
    ]

@router.post("/users")
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if db.query(models.User).filter(models.User.cnpj == payload.cnpj).first():
        raise HTTPException(status_code=400, detail="CNPJ already exists")

    user = models.User(
        cnpj=payload.cnpj,
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
    )
    access_levels = db.query(models.AccessLevel).filter(models.AccessLevel.id.in_(payload.access_level_ids)).all()
    user.access_levels = access_levels
    db.add(user)
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
    access_levels = db.query(models.AccessLevel).filter(models.AccessLevel.id.in_(payload.access_level_ids)).all()
    user.access_levels = access_levels
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
