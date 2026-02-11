import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from app.core.config import settings


def send_email(to_email: str, subject: str, html_content: str) -> None:
    if not settings.smtp_user or not settings.smtp_pass or not settings.smtp_from:
        raise RuntimeError("SMTP credentials are not configured")

    msg = MIMEMultipart("alternative")
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(html_content, "html"))

    server = smtplib.SMTP(settings.smtp_host, settings.smtp_port)
    try:
        server.starttls()
        server.login(settings.smtp_user, settings.smtp_pass)
        server.send_message(msg)
    finally:
        server.quit()
