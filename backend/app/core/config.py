from pydantic import BaseModel
import os

class Settings(BaseModel):
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: int = int(os.getenv("DB_PORT", ""))
    db_name: str = os.getenv("DB_NAME", "")
    db_user: str = os.getenv("DB_USER", "root")
    db_pass: str = os.getenv("DB_PASS", "")
    jwt_secret: str = os.getenv("JWT_SECRET", "change-this")
    jwt_algorithm: str = "HS256"
    access_token_exp_minutes: int = 60 * 24
    upload_dir: str = os.getenv("UPLOAD_DIR", "/app/uploads")
    invoice_dir: str = os.getenv("INVOICE_DIR", "/app/uploads/invoices")
    sync_token: str = os.getenv("SYNC_TOKEN", "")
    smtp_host: str = os.getenv("SMTP_HOST", "smtp.office365.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_pass: str = os.getenv("SMTP_PASS", "")
    smtp_from: str = os.getenv("SMTP_FROM", "")
    pricing_master_path: str = os.getenv("PRICING_MASTER_PATH", "/app/TABELA_PRECOS_UF.xlsx")
    pricing_discounts_path: str = os.getenv("PRICING_DISCOUNTS_PATH", "/app/DESCONTOS_PARA_CARGA.xlsm")
    pricing_client_program_path: str = os.getenv("PRICING_CLIENT_PROGRAM_PATH", "/app/JAC_PROG_DESC_CLIENTE.csv")

settings = Settings()
