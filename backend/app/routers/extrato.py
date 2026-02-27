from datetime import datetime
import os
import re

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.config import settings
from app.dependencies import get_current_user, get_db

router = APIRouter(prefix="/extrato", tags=["extrato"])

ALLOWED_USER_ID = 1
ALLOWED_CNPJ = "00000000000000"


def _is_allowed_requester(user) -> bool:
    return user.id == ALLOWED_USER_ID or user.cnpj == ALLOWED_CNPJ


def _to_item(job: models.ExtratoJob) -> schemas.ExtratoJobItem:
    return schemas.ExtratoJobItem(
        id=job.id,
        status=job.status,
        input_month=job.input_month,
        customer_name=job.customer_name,
        pdf_available=bool(job.pdf_path),
        error_message=job.error_message,
        created_at=job.created_at.isoformat() if job.created_at else None,
        started_at=job.started_at.isoformat() if job.started_at else None,
        finished_at=job.finished_at.isoformat() if job.finished_at else None,
    )


def _require_agent_token(x_agent_token: str | None = Header(default=None)):
    if not settings.agent_token:
        raise HTTPException(status_code=500, detail="AGENT_TOKEN not configured")
    if x_agent_token != settings.agent_token:
        raise HTTPException(status_code=401, detail="Invalid agent token")


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name.strip())
    return cleaned[:120] or "extrato"


@router.post("/jobs", response_model=schemas.ExtratoJobItem)
def create_job(payload: schemas.ExtratoJobCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not _is_allowed_requester(user):
        raise HTTPException(status_code=403, detail="Not allowed")

    pending_or_running = (
        db.query(models.ExtratoJob)
        .filter(
            models.ExtratoJob.requested_by == user.id,
            models.ExtratoJob.status.in_(["pending", "running"]),
        )
        .first()
    )
    if pending_or_running:
        return _to_item(pending_or_running)

    job = models.ExtratoJob(
        requested_by=user.id,
        status="pending",
        input_month=(payload.input_month or "FEVEREIRO 2026").strip(),
        customer_name=(payload.customer_name or "MERITO COMERCIO DE EQUIPAMENTOS LIM").strip(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _to_item(job)


@router.get("/jobs/latest", response_model=schemas.ExtratoJobItem | None)
def latest_job(db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not _is_allowed_requester(user):
        raise HTTPException(status_code=403, detail="Not allowed")
    job = (
        db.query(models.ExtratoJob)
        .filter(models.ExtratoJob.requested_by == user.id)
        .order_by(models.ExtratoJob.id.desc())
        .first()
    )
    return _to_item(job) if job else None


@router.get("/jobs/{job_id}/pdf")
def download_job_pdf(job_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    job = db.query(models.ExtratoJob).filter(models.ExtratoJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not user.is_admin and job.requested_by != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if job.status != "done" or not job.pdf_path:
        raise HTTPException(status_code=404, detail="PDF not available")
    if not os.path.exists(job.pdf_path):
        raise HTTPException(status_code=404, detail="PDF file missing")
    filename = os.path.basename(job.pdf_path)
    return FileResponse(job.pdf_path, media_type="application/pdf", filename=filename)


@router.get("/agent/next", response_model=schemas.ExtratoJobItem | None, dependencies=[Depends(_require_agent_token)])
def agent_next_job(db: Session = Depends(get_db)):
    job = (
        db.query(models.ExtratoJob)
        .filter(models.ExtratoJob.status == "pending")
        .order_by(models.ExtratoJob.id.asc())
        .first()
    )
    if not job:
        return None
    job.status = "running"
    job.started_at = datetime.utcnow()
    job.error_message = None
    db.commit()
    db.refresh(job)
    return _to_item(job)


@router.post("/agent/{job_id}/complete", response_model=schemas.ExtratoJobItem, dependencies=[Depends(_require_agent_token)])
def agent_complete_job(job_id: int, pdf: UploadFile = File(...), db: Session = Depends(get_db)):
    job = db.query(models.ExtratoJob).filter(models.ExtratoJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ["running", "pending"]:
        raise HTTPException(status_code=400, detail="Job is not running")
    if not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF is accepted")

    os.makedirs(settings.extrato_output_dir, exist_ok=True)
    customer = _safe_name(job.customer_name)
    month = _safe_name(job.input_month)
    out_name = f"extrato_{job.id}_{month}_{customer}.pdf"
    out_path = os.path.join(settings.extrato_output_dir, out_name)
    with open(out_path, "wb") as f:
        f.write(pdf.file.read())

    job.status = "done"
    job.pdf_path = out_path
    job.finished_at = datetime.utcnow()
    job.error_message = None
    db.commit()
    db.refresh(job)
    return _to_item(job)


@router.post("/agent/{job_id}/fail", response_model=schemas.ExtratoJobItem, dependencies=[Depends(_require_agent_token)])
def agent_fail_job(job_id: int, message: str = "", db: Session = Depends(get_db)):
    job = db.query(models.ExtratoJob).filter(models.ExtratoJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.status = "error"
    job.finished_at = datetime.utcnow()
    job.error_message = (message or "Unknown error")[:1000]
    db.commit()
    db.refresh(job)
    return _to_item(job)
