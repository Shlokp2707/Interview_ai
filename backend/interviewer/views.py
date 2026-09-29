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
    """Extract raw text from PDF file upload with fallback for text/binary streams."""
    try:
        content = file.read()
        file.seek(0)
        if fitz:
            doc = fitz.open(stream=content, filetype="pdf")
            text = ""
            for page in doc:
                text += page.get_text()
            extracted = text.strip()
            if extracted:
                return extracted
        
        # Fallback if fitz is None or extracted text is empty
        decoded = content.decode("utf-8", errors="ignore").strip()
        return decoded if decoded else f"Candidate Resume Data ({getattr(file, 'name', 'PDF')})"
    except Exception as e:
        print(f"PyMuPDF extract_text_from_pdf exception, falling back to raw decode: {e}")
        try:
            file.seek(0)
            raw_data = file.read()
            file.seek(0)
            if isinstance(raw_data, bytes):
                raw_data = raw_data.decode("utf-8", errors="ignore")
            cleaned = raw_data.strip()
            return cleaned if cleaned else f"Candidate Resume Data ({getattr(file, 'name', 'PDF')})"
        except Exception:
            return f"Candidate Profile & Resume Data for {getattr(file, 'name', 'PDF Resume')}"



def send_interview_invite(request, application):   
    """Send interview invitation email after ATS pass (Recruiter interviews only)."""
    if application.job.company == "Mock Practice Room":
        return

    try:
        from dotenv import load_dotenv
        load_dotenv(override=True)
        
        sender = (getattr(settings, "EMAIL_HOST_USER", None) or os.getenv("EMAIL_HOST_USER", "shlokp2406@gmail.com")).strip("\"'").strip()
        app_password = (getattr(settings, "EMAIL_HOST_PASSWORD", None) or os.getenv("EMAIL_HOST_PASSWORD", "oijn pwua tstz xwsh")).strip("\"'").replace(" ", "")

        if not sender or not app_password:
            print("[Email Notice] Email configuration or app password missing.")
            return

        receiver = application.candidate_email
        if not receiver or "@" not in receiver:
            print(f"[Email Notice] Candidate email '{receiver}' is invalid.")
            return

        # Dynamically build absolute React Frontend URL (port 5173 for dev or request origin)
        origin = ""
        if request:
            try:
                origin = request.headers.get("origin") or request.headers.get("referer") or ""
                if not origin:
                    host = request.get_host()
                    scheme = "https" if request.is_secure() else "http"
                    origin = f"{scheme}://{host}"
            except Exception:
                origin = "http://localhost:5173"
        else:
            origin = "http://localhost:5173"

        if "localhost:8000" in origin or "127.0.0.1:8000" in origin:
            origin = origin.replace("8000", "5173")

        origin = origin.rstrip("/")
        interview_url = f"{origin}/interview/{application.id}"

        email_subject = f"🎉 Congratulations! Interview Invitation — {application.job.title} at {application.job.company}"
        email_body = f"""Dear {application.candidate_name},

Congratulations! Your resume has been shortlisted for the position of {application.job.title} at {application.job.company}.

📊 Your ATS Resume Match Score: {application.ats_score:.1f}%

Please click the link below to enter your AI-powered interview room and complete your technical assessment:

👉 {interview_url}

Best of luck!
{application.job.company} Hiring Team
HireAI Assessment Platform
"""

        # Method 1: Try Django send_mail
        try:
            from django.core.mail import send_mail
            send_mail(
                subject=email_subject,
                message=email_body,
                from_email=sender,
                recipient_list=[receiver],
                fail_silently=False
            )
            print(f"✅ [Email Success] Interview invitation sent to {receiver} via Django send_mail")
            return
        except Exception as django_err:
            print(f"[Email Notice] Django send_mail fallback to smtplib: {django_err}")

        # Method 2: Direct smtplib delivery
        import smtplib
        from email.mime.text import MIMEText

        msg = MIMEText(email_body, "plain", "utf-8")
        msg["Subject"] = email_subject
        msg["From"] = sender
        msg["To"] = receiver

        try:
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
                server.starttls()
                server.login(sender, app_password)
                server.send_message(msg)
            print(f"✅ [Email Success] Interview invitation sent to {receiver} via smtplib TLS")
        except Exception:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
                server.login(sender, app_password)
                server.send_message(msg)
            print(f"✅ [Email Success] Interview invitation sent to {receiver} via smtplib SSL")

    except Exception as e:
        print(f"❌ [Email Error] Invitation sending failed for application {application.id}: {e}")