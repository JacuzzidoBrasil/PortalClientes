from datetime import datetime
from decimal import Decimal
import hashlib
import os
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.config import settings
from app.dependencies import get_current_admin, get_current_user, get_db

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _normalize_cnpj(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _find_user_by_cnpj(db: Session, cnpj: str):
    normalized = _normalize_cnpj(cnpj)
    if not normalized:
        return None
    users = db.query(models.User).all()
    for user in users:
        if _normalize_cnpj(user.cnpj) == normalized:
            return user
    return None


def _require_sync_token(x_sync_token: str | None = Header(default=None)):
    if not settings.sync_token:
        raise HTTPException(status_code=500, detail="SYNC_TOKEN not configured")
    if x_sync_token != settings.sync_token:
        raise HTTPException(status_code=401, detail="Invalid sync token")


def _invoice_dir() -> str:
    target = settings.invoice_dir or os.path.join(settings.upload_dir, "invoices")
    os.makedirs(target, exist_ok=True)
    return target


def _to_item(inv: models.Invoice) -> schemas.InvoiceItem:
    value = float(inv.total_value) if inv.total_value is not None else None
    return schemas.InvoiceItem(
        id=inv.id,
        user_id=inv.user_id,
        cnpj=inv.cnpj,
        invoice_number=inv.invoice_number,
        invoice_date=inv.invoice_date.isoformat() if inv.invoice_date else None,
        total_value=value,
        created_at=inv.created_at.isoformat() if inv.created_at else None,
    )


@router.post("/sync", response_model=schemas.InvoiceSyncResult, dependencies=[Depends(_require_sync_token)])
def sync_invoice(
    cnpj: str = Form(...),
    invoice_number: str = Form(""),
    invoice_date: str = Form(""),
    total_value: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF is allowed")

    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    file_hash = hashlib.sha256(raw).hexdigest()

    existing = db.query(models.Invoice).filter(models.Invoice.file_hash == file_hash).first()
    if existing:
        return schemas.InvoiceSyncResult(id=existing.id, status="duplicate")

    parsed_date = None
    if invoice_date:
        try:
            parsed_date = datetime.strptime(invoice_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="invoice_date must be YYYY-MM-DD")

    parsed_total = None
    if total_value:
        try:
            parsed_total = Decimal(total_value.replace(",", "."))
        except Exception:
            raise HTTPException(status_code=400, detail="total_value invalid")

    user = _find_user_by_cnpj(db, cnpj)
    ext = os.path.splitext(file.filename)[1].lower() or ".pdf"
    out_name = f"{uuid.uuid4().hex}{ext}"
    out_path = os.path.join(_invoice_dir(), out_name)
    with open(out_path, "wb") as f:
        f.write(raw)

    inv = models.Invoice(
        user_id=user.id if user else None,
        cnpj=cnpj,
        invoice_number=invoice_number or os.path.splitext(file.filename)[0],
        invoice_date=parsed_date,
        total_value=parsed_total,
        file_path=out_path,
        file_hash=file_hash,
        created_at=datetime.utcnow(),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return schemas.InvoiceSyncResult(id=inv.id, status="created")


@router.get("/admin", response_model=list[schemas.InvoiceItem])
def list_invoices_admin(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    items = db.query(models.Invoice).order_by(models.Invoice.id.desc()).all()
    return [_to_item(i) for i in items]


@router.get("/mine")
def my_notes(user=Depends(get_current_user)):
    if user.is_admin:
        return {"status": "admin"}
    return {"status": "em desenvolvimento"}


@router.get("/{invoice_id}/download")
def download_invoice(invoice_id: int, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not os.path.exists(inv.file_path):
        raise HTTPException(status_code=404, detail="File missing")
    filename = f"{inv.invoice_number}.pdf"
    return FileResponse(inv.file_path, media_type="application/pdf", filename=filename)
