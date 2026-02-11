from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models, schemas
from app.auth import verify_password, create_access_token, hash_password
from app.dependencies import get_db, get_current_user
from app.emailer import send_email
from app.core.config import settings
from datetime import datetime, timedelta
import hashlib
import secrets

router = APIRouter(prefix="/auth", tags=["auth"])

def _hash_code(code: str) -> str:
    return hashlib.sha256(f"{code}{settings.jwt_secret}".encode("utf-8")).hexdigest()

def _generate_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"

@router.post("/login", response_model=schemas.Token)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.cnpj == payload.cnpj).first()
    if user and user.first_access_completed is False:
        raise HTTPException(status_code=403, detail="First access required")
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.cnpj)
    return {"access_token": token, "token_type": "bearer"}

@router.get("/me")
def me(user=Depends(get_current_user)):
    return {
        "id": user.id,
        "cnpj": user.cnpj,
        "name": user.name,
        "email": user.email,
        "is_admin": user.is_admin,
        "access_levels": [al.name for al in user.access_levels],
    }

@router.post("/first-access/request")
def first_access_request(payload: schemas.FirstAccessRequest, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.cnpj == payload.cnpj, models.User.email == payload.email)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.first_access_completed:
        raise HTTPException(status_code=400, detail="First access already completed")

    code = _generate_code()
    user.first_access_code_hash = _hash_code(code)
    user.first_access_code_expires = datetime.utcnow() + timedelta(minutes=15)
    db.commit()

    html = f"""
    <p>Seu código de primeiro acesso:</p>
    <p><strong>{code}</strong></p>
    <p>Este código expira em 15 minutos.</p>
    """
    send_email(payload.email, "Primeiro acesso - Portal Clientes", html)
    return {"status": "ok"}

@router.post("/first-access/confirm")
def first_access_confirm(payload: schemas.FirstAccessConfirm, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.cnpj == payload.cnpj, models.User.email == payload.email)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.first_access_completed:
        raise HTTPException(status_code=400, detail="First access already completed")
    if not user.first_access_code_hash or not user.first_access_code_expires:
        raise HTTPException(status_code=400, detail="First access code not requested")
    if user.first_access_code_expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Code expired")
    if _hash_code(payload.code) != user.first_access_code_hash:
        raise HTTPException(status_code=400, detail="Invalid code")

    user.password_hash = hash_password(payload.new_password)
    user.first_access_completed = True
    user.first_access_code_hash = None
    user.first_access_code_expires = None
    db.commit()
    return {"status": "ok"}

@router.post("/password-reset/request")
def password_reset_request(payload: schemas.PasswordResetRequest, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.cnpj == payload.cnpj, models.User.email == payload.email)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    code = _generate_code()
    user.reset_code_hash = _hash_code(code)
    user.reset_code_expires = datetime.utcnow() + timedelta(minutes=15)
    db.commit()

    html = f"""
    <p>Seu código de recuperação de senha:</p>
    <p><strong>{code}</strong></p>
    <p>Este código expira em 15 minutos.</p>
    """
    send_email(payload.email, "Recuperação de senha - Portal Clientes", html)
    return {"status": "ok"}

@router.post("/password-reset/confirm")
def password_reset_confirm(payload: schemas.PasswordResetConfirm, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.cnpj == payload.cnpj, models.User.email == payload.email)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.reset_code_hash or not user.reset_code_expires:
        raise HTTPException(status_code=400, detail="Reset code not requested")
    if user.reset_code_expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Code expired")
    if _hash_code(payload.code) != user.reset_code_hash:
        raise HTTPException(status_code=400, detail="Invalid code")

    user.password_hash = hash_password(payload.new_password)
    user.reset_code_hash = None
    user.reset_code_expires = None
    user.first_access_completed = True
    db.commit()
    return {"status": "ok"}
