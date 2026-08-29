import os
try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None
import smtplib

from email.mime.text import MIMEText
from django.conf import settings
from django.urls import reverse
from .models import Application

# ── Helper Utilities for API views ─────────────────────────────

def extract_text_from_pdf(file) -> str:
    """Extract raw text from PDF file upload."""
    doc = fitz.open(stream=file.read(), filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return text.strip()


def send_interview_invite(request, application):   
    """Send interview invitation email after ATS pass."""
    try:
        sender = getattr(settings, "EMAIL_HOST_USER", None) or os.getenv("EMAIL_HOST_USER", "")
        app_password = getattr(settings, "EMAIL_HOST_PASSWORD", None) or os.getenv("EMAIL_HOST_PASSWORD", "")

        if not sender or not app_password:
            print("Email configuration or password missing.")
            return

        receiver = application.candidate_email

        # Dynamically build the absolute URL
        relative_url = reverse("interview", args=[application.id])
        interview_url = request.build_absolute_uri(relative_url)

        email_body = f"""
Dear {application.candidate_name},

Congratulations! Your resume has been shortlisted for the position of {application.job.title} at {application.job.company}.

ATS Score: {application.ats_score:.1f}%

Please click the link below to start your AI-powered interview:

{interview_url}

Best regards,
{application.job.company} Hiring Team
"""

        msg = MIMEText(email_body)
        msg["Subject"] = (
            f"Interview Invitation — {application.job.title} "
            f"at {application.job.company}"
        )
        msg["From"] = sender
        msg["To"] = receiver

        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(sender, app_password)
            server.send_message(msg)

        print(f"Interview invitation sent to {receiver}")

    except Exception as e:
        print(f"Email sending failed: {e}")