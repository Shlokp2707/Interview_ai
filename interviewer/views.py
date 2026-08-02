import json
import os
import fitz  # PyMuPDF
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.core.mail import send_mail
from django.urls import reverse
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
import smtplib
from email.mime.text import MIMEText
from django.conf import settings
from .models import JobPosting, Application
from .ats_service import run_ats_scoring
from .interview_service import (
    create_interview_session,
    get_current_question,
    submit_answer,
)


# ── Utility ───────────────────────────────────────────────────
def extract_text_from_pdf(file) -> str:
    doc = fitz.open(stream=file.read(), filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return text.strip()


# def send_interview_invite(application: Application):
#     ...


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

# ── INTERVIEW — Conduct interview ─────────────────────────────
@login_required
def interview(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return redirect("home")

    if application.status not in ["interview_scheduled", "interview_done"]:
        return render(request, "interviewer/error.html", {
            "message": "You are not eligible for the interview or the interview is already complete."
        })

    # Read rules accepted status from Django session
    rules_accepted = request.session.get(f"rules_accepted_{application_id}", False)

    state = get_current_question(application.interview_thread_id)
    return render(request, "interviewer/interview.html", {
        "application": application,
        "state":       state,
        "rules_accepted": rules_accepted,
    })


@login_required
@require_POST
def submit_interview_answer(request, application_id):
    """AJAX endpoint — receive answer, return next question or report."""
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return JsonResponse({"error": "Unauthorized"}, status=403)

    try:
        data   = json.loads(request.body)
        answer = data.get("answer", "").strip()
    except Exception:
        return JsonResponse({"error": "Invalid request"}, status=400)

    state = submit_answer(application.interview_thread_id, answer)

    # If finished, save report to DB
    if state["phase"] == "finished":
        report = state.get("report", {})
        application.interview_report         = state.get("final_report", "")
        application.interview_rating         = report.get("rating", "")
        application.interview_percentage     = report.get("percentage", 0.0)
        application.interview_recommendation = report.get("recommendation", "")
        application.status = "interview_done"
        application.interview_speaking_fluency   = report.get("avg_fluency", 0.0)
        application.interview_vocab_level        = report.get("vocab_level", "")
        application.interview_filler_ratio       = report.get("filler_ratio", 0.0)

        # Auto hire/reject based on recommendation
        rec = report.get("recommendation", "").lower()
        if "strongly recommend" in rec or "recommend" in rec:
            application.status = "hired"
        elif "do not recommend" in rec:
            application.status = "rejected"
        application.save()

    return JsonResponse(state) 


from .security_service import verify_candidate_face as run_face_verification

@login_required
@require_POST
def verify_face_endpoint(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return JsonResponse({"error": "Unauthorized"}, status=403)

    if not application.candidate_image:
        return JsonResponse({"error": "No registered candidate profile image found."}, status=400)

    try:
        data = json.loads(request.body)
        live_image_base64 = data.get("image", "")
    except Exception:
        return JsonResponse({"error": "Invalid request payload"}, status=400)

    if not live_image_base64:
        return JsonResponse({"error": "No live webcam image provided"}, status=400)

    # Increment verification attempts
    application.verification_attempts += 1
    application.save()

    result = run_face_verification(
        registered_image_path=application.candidate_image.path,
        live_image_base64=live_image_base64,
        model_name="Facenet"
    )

    if result.get("error"):
        return JsonResponse({
            "success": False,
            "error": result["error"]
        })

    is_verified = result.get("verified", False)
    distance = result.get("distance", 1.0)
    score = round((1.0 - distance) * 100, 2)

    if is_verified:
        application.is_verified = True
        application.verification_score = score
        application.save()
        return JsonResponse({
            "success": True,
            "verified": True,
            "score": score,
            "message": "Face verified successfully! You may now begin the interview."
        })
    else:
        application.verification_score = score
        application.save()
        return JsonResponse({
            "success": True,
            "verified": False,
            "score": score,
            "message": "Face verification failed. The live image does not match the registered profile picture."
        })
     

from .security_service import estimate_head_pose, decode_base64_to_cv2, analyze_expression_and_identity
import datetime

@login_required
@require_POST
def submit_proctoring_telemetry(request, application_id):
    """
    Periodic endpoint to process camera frames and audio telemetry warnings.
    Increments security_warnings and updates security_log JSON.
    Auto-disqualifies candidate if warnings exceed 5.
    """
    import time
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return JsonResponse({"error": "Unauthorized"}, status=403)

    try:
        data = json.loads(request.body)
        live_image_base64 = data.get("image", "")
        client_warnings = data.get("warnings", {})  # e.g., {"looking_away": true, "ambient_noise": true}
    except Exception:
        return JsonResponse({"error": "Invalid request payload"}, status=400)

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    warnings_triggered = []
    notice_message = None

    current_time = time.time()
    
    # Initialize timing and throttling variables in session if not present
    if f"session_initialized_{application_id}" not in request.session:
        request.session[f"session_initialized_{application_id}"] = True
        request.session["last_blink_time"] = current_time
        request.session["looking_away_since"] = current_time
        request.session["out_of_frame_since"] = current_time
        request.session["last_look_away_warning_time"] = 0.0
        request.session["last_liveness_warning_time"] = 0.0
        request.session["last_out_of_frame_warning_time"] = 0.0
        request.session["last_static_photo_warning_time"] = 0.0
        request.session["last_blink_warning_time"] = 0.0
        request.session["consecutive_mismatches"] = 0
        request.session["blinks_count"] = 0
        request.session["was_blinking"] = False
        request.session["last_landmarks"] = None
        request.session["static_face_count"] = 0
        request.session["last_liveness_check"] = None

    last_liveness_check = request.session.get("last_liveness_check")
    # Check liveness immediately at start (last_liveness_check is None) and then every 120 seconds (2 minutes)
    should_check_liveness = (last_liveness_check is None) or (current_time - last_liveness_check >= 120.0)

    is_currently_looking_away = False
    face_count = 0
    ear = 0.0
    blink_detected = False
    coords = []

    # 1. Server-side visual analysis
    if live_image_base64:
        img = decode_base64_to_cv2(live_image_base64)
        if img is not None:
            pose_res = estimate_head_pose(img)
            face_count = pose_res.get("face_count", 0)
            ear = pose_res.get("ear", 0.0)
            blink_detected = pose_res.get("blink_detected", False)
            coords = pose_res.get("landmarks", [])

            # Multi-face warning
            if face_count > 1:
                warnings_triggered.append(f"Multiple faces detected ({face_count} faces in frame)")
            # Looking away warning check
            elif pose_res.get("looking_away", False):
                is_currently_looking_away = True
                
            # Identity Verification check (if profile image exists) - throttled to run every 2 minutes
            # Skip verification if the candidate is looking away to prevent false mismatch alarms from profile views
            is_looking_away_detected = is_currently_looking_away or client_warnings.get("looking_away", False)
            if (should_check_liveness and face_count == 1 and not is_looking_away_detected 
                and application.candidate_image and os.path.exists(application.candidate_image.path)):
                verify_res = analyze_expression_and_identity(application.candidate_image.path, img)
                if not verify_res.get("verified", True):
                    consecutive_mismatches = request.session.get("consecutive_mismatches", 0) + 1
                    request.session["consecutive_mismatches"] = consecutive_mismatches
                    # If mismatch detected, bypass throttling for the next check to re-verify in 10 seconds
                    request.session["last_liveness_check"] = current_time - 110.0
                    # Warn only if candidate fails 3 consecutive checks to prevent lighting false alarms
                    if consecutive_mismatches >= 3:
                        warnings_triggered.append("Face mismatch / Identity verification failed")
                        request.session["consecutive_mismatches"] = 0
                        request.session["last_liveness_check"] = current_time
                else:
                    request.session["consecutive_mismatches"] = 0
                    request.session["last_liveness_check"] = current_time
        else:
            face_count = 0

    # 2. Client-side warnings integration
    if client_warnings.get("looking_away", False):
        is_currently_looking_away = True
    if client_warnings.get("ambient_noise", False):
        warnings_triggered.append("High background audio activity detected")
    if client_warnings.get("tab_switching", False):
        warnings_triggered.append("Tab switching or unfocusing the window detected")
    if client_warnings.get("fullscreen_exit", False):
        warnings_triggered.append("Exited fullscreen mode")

    # 3. Precise Timing-Based Warnings using Django Session with Throttling
    # Out of Frame Timing (> 5 seconds)
    if face_count == 0:
        out_of_frame_since = request.session.get("out_of_frame_since")
        if out_of_frame_since is None:
            request.session["out_of_frame_since"] = current_time
        else:
            elapsed = current_time - out_of_frame_since
            if elapsed > 5.0:
                last_out_of_frame_warning = request.session.get("last_out_of_frame_warning_time", 0.0)
                if current_time - last_out_of_frame_warning > 20.0:
                    warnings_triggered.append("Face not detected / Out of camera frame for more than 5 seconds")
                    request.session["last_out_of_frame_warning_time"] = current_time
                request.session["out_of_frame_since"] = current_time  # Reset to trigger again if persistent
    else:
        request.session["out_of_frame_since"] = current_time

    # Looking Away Timing (> 4 seconds)
    if is_currently_looking_away:
        looking_away_since = request.session.get("looking_away_since")
        if looking_away_since is None:
            request.session["looking_away_since"] = current_time
        else:
            elapsed = current_time - looking_away_since
            if elapsed > 4.0:
                last_look_away_warning = request.session.get("last_look_away_warning_time", 0.0)
                if current_time - last_look_away_warning > 20.0:
                    warnings_triggered.append("Looking away from screen for more than 4 seconds")
                    request.session["last_look_away_warning_time"] = current_time
                request.session["looking_away_since"] = current_time  # Reset to trigger again if persistent
    else:
        request.session["looking_away_since"] = current_time

    # Liveness / Static Photo Detection
    if face_count == 1 and coords:
        last_landmarks = request.session.get("last_landmarks")
        static_face_count = request.session.get("static_face_count", 0)
        
        # Compare key points to check if they are exactly identical (printed photo or frozen frame)
        if last_landmarks and last_landmarks == coords:
            static_face_count += 1
        else:
            static_face_count = 0
            
        request.session["last_landmarks"] = coords
        request.session["static_face_count"] = static_face_count

        if static_face_count >= 15:  # 15 consecutive checks (approx 30 seconds) with exact same coordinates
            last_static_photo_warning = request.session.get("last_static_photo_warning_time", 0.0)
            if current_time - last_static_photo_warning > 30.0:
                warnings_triggered.append("Liveness check failed: Potential static photo or frozen camera feed detected")
                request.session["last_static_photo_warning_time"] = current_time
            
        # Blink tracking
        blinks_count = request.session.get("blinks_count", 0)
        was_blinking = request.session.get("was_blinking", False)
        last_blink_time = request.session.get("last_blink_time", current_time)

        if blink_detected:
            request.session["last_blink_time"] = current_time
            if not was_blinking:
                blinks_count += 1
                request.session["was_blinking"] = True
        else:
            request.session["was_blinking"] = False
            # Reset last blink time if the face is moving (which proves liveliness)
            if static_face_count == 0:
                request.session["last_blink_time"] = current_time
            else:
                elapsed_since_blink = current_time - last_blink_time
                if elapsed_since_blink > 180.0:
                    last_blink_warning = request.session.get("last_blink_warning_time", 0.0)
                    if current_time - last_blink_warning > 180.0:
                        notice_message = "Liveness check notice: Please blink or adjust lighting (no eye blinking detected)."
                        request.session["last_blink_warning_time"] = current_time
                        request.session["last_blink_time"] = current_time

        request.session["blinks_count"] = blinks_count
    else:
        # Reset relative variables when face is gone
        request.session["static_face_count"] = 0

    blinks_count = request.session.get("blinks_count", 0)

    # 4. Update application log
    from django.db import transaction

    with transaction.atomic():
        # Refresh application state from database to get the absolute latest warnings and logs, preventing race conditions
        application.refresh_from_db()
        
        if warnings_triggered:
            log_entry = {
                "timestamp": timestamp,
                "violations": warnings_triggered
            }
            
            # Ensure log list is initialized
            if not isinstance(application.security_log, list):
                application.security_log = []
                
            application.security_log.append(log_entry)
            application.security_warnings += len(warnings_triggered)
            
            # Disqualification threshold = 5
            if application.security_warnings >= 5:
                application.is_disqualified = True
                
            application.save(update_fields=["security_warnings", "security_log", "is_disqualified"])

    return JsonResponse({
        "success": True,
        "warnings_count": application.security_warnings,
        "is_disqualified": application.is_disqualified,
        "violations": warnings_triggered,
        "notice": notice_message,
        "security_log": application.security_log,
        "blinks_count": blinks_count,
        "liveness_status": "Liveness Verified" if face_count == 1 else "No Face Detected"
    })


@login_required
def preload_models_endpoint(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return JsonResponse({"error": "Unauthorized"}, status=403)
    
    from .security_service import preload_heavy_libraries
    preload_heavy_libraries()
    return JsonResponse({"success": True})


@login_required
@require_POST
def start_interview_endpoint(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return JsonResponse({"error": "Unauthorized"}, status=403)
    
    # Mark rules as accepted in the session
    request.session[f"rules_accepted_{application_id}"] = True
    return JsonResponse({"success": True})