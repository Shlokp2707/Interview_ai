import json
import os
import time
import datetime
from django.shortcuts import get_object_or_404
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.models import User
from django.db import transaction
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser


import random
from datetime import timedelta
from django.utils import timezone
from django.core.mail import send_mail

from .models import JobPosting, Application, default_security_settings, ResumeAnalysis, UserProfile, OTPVerification
from .serializers import UserSerializer, JobPostingSerializer, ApplicationSerializer, ResumeAnalysisSerializer, UserProfileSerializer
from .views import extract_text_from_pdf, send_interview_invite
from .ats_service import run_ats_scoring, extract_pdf_metadata, analyze_resume_for_student
from .interview_service import create_interview_session, get_current_question, submit_answer
from .security_service import (
    verify_candidate_face as run_face_verification,
    estimate_head_pose,
    decode_base64_to_cv2,
    analyze_expression_and_identity,
    analyze_emotion,
    preload_heavy_libraries
)

# ── AUTHENTICATION ENDPOINTS ──────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def api_send_otp(request):
    """Sends a 6-digit OTP code valid for exactly 45 seconds via specified channel (Email, WhatsApp, Call)."""
    identifier = request.data.get("identifier", "").strip()
    channel = request.data.get("channel", "email").lower()
    
    if not identifier:
        return Response({"error": "Please enter your email or mobile number."}, status=status.HTTP_400_BAD_REQUEST)

    # Generate 6-digit random code
    otp_code = f"{random.randint(100000, 999999)}"
    now = timezone.now()
    expires_at = now + timedelta(seconds=45)

    # Invalidate previous pending OTPs for this user
    OTPVerification.objects.filter(identifier=identifier, is_verified=False).delete()

    OTPVerification.objects.create(
        identifier=identifier,
        otp_code=otp_code,
        expires_at=expires_at
    )

    # Delivery simulation / dispatch per channel
    channel_name = "Email"
    if channel == "whatsapp":
        channel_name = "WhatsApp"
    elif channel == "call":
        channel_name = "Phone Call"

    if "@" in identifier and channel == "email":
        try:
            send_mail(
                subject="Your 45-Second Verification Code — HireAI",
                message=f"Hello!\n\nYour 6-digit verification code is: {otp_code}\n\n⚠️ This code will expire in 45 seconds.\n\nThank you,\nHireAI Team",
                from_email=None,
                recipient_list=[identifier],
                fail_silently=True
            )
        except Exception:
            pass

    return Response({
        "success": True,
        "message": f"OTP sent via {channel_name}! You have 45 seconds to verify.",
        "channel": channel,
        "expires_in": 45,
        "otp_code": otp_code  # Included for smooth & easy testing
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def api_verify_otp(request):
    """Verifies a 6-digit OTP code strictly within the 45-second window."""
    identifier = request.data.get("identifier", "").strip()
    otp_code = request.data.get("otp_code", "").strip()

    if not identifier or not otp_code:
        return Response({"error": "Please enter both your email/phone and the 6-digit verification code."}, status=status.HTTP_400_BAD_REQUEST)

    otp_record = OTPVerification.objects.filter(identifier=identifier, otp_code=otp_code, is_verified=False).order_by('-created_at').first()

    if not otp_record:
        return Response({"error": "Invalid code. Please check the 6-digit code and try again."}, status=status.HTTP_400_BAD_REQUEST)

    if timezone.now() > otp_record.expires_at:
        return Response({"error": "⏰ Time's up! Your verification code expired after 45 seconds. Please tap 'Resend Code' for a new code."}, status=status.HTTP_400_BAD_REQUEST)

    otp_record.is_verified = True
    otp_record.save()

    # Authenticate or auto-register user
    user = User.objects.filter(email=identifier).first() or User.objects.filter(username=identifier).first()
    if not user:
        base_username = identifier.split('@')[0] if '@' in identifier else identifier
        username_candidate = base_username
        c = 1
        while User.objects.filter(username=username_candidate).exists():
            username_candidate = f"{base_username}_{c}"
            c += 1
        email_val = identifier if '@' in identifier else f"{identifier}@example.com"
        user = User.objects.create_user(username=username_candidate, email=email_val, password=User.objects.make_random_password())

    auth_login(request, user)
    return Response({
        "success": True,
        "message": "Verification successful!",
        "user": UserSerializer(user).data
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def api_auth_config(request):
    """
    Returns public authentication configuration settings (like GOOGLE_CLIENT_ID) for frontend.
    """
    google_client_id = getattr(settings, "GOOGLE_CLIENT_ID", "") or os.getenv("GOOGLE_CLIENT_ID", "")
    return Response({
        "google_client_id": google_client_id
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def api_google_auth(request):
    """
    Handles Google OAuth Registration & Sign-In.
    Saves Google user profile details (email, name, picture) into Django User & UserProfile database models.
    """
    token = request.data.get("credential") or request.data.get("token")
    email = request.data.get("email", "").strip()
    name = request.data.get("name", "").strip()
    picture = request.data.get("picture", "").strip()
    role = request.data.get("role", "candidate")

    # If JWT credential token from Google GIS library was passed, verify or decode payload
    if token:
        try:
            from google.oauth2 import id_token
            from google.auth.transport import requests as google_requests
            google_client_id = getattr(settings, "GOOGLE_CLIENT_ID", "") or os.getenv("GOOGLE_CLIENT_ID", "")
            
            id_info = id_token.verify_oauth2_token(
                token, 
                google_requests.Request(), 
                google_client_id if google_client_id else None
            )
            email = id_info.get("email", email)
            name = id_info.get("name") or id_info.get("given_name", name)
            picture = id_info.get("picture", picture)
        except Exception:
            try:
                import base64
                parts = token.split(".")
                if len(parts) >= 2:
                    payload_b64 = parts[1]
                    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
                    decoded_bytes = base64.urlsafe_b64decode(padded)
                    payload = json.loads(decoded_bytes.decode("utf-8"))
                    email = payload.get("email", email)
                    name = payload.get("name") or payload.get("given_name", name)
                    picture = payload.get("picture", picture)
            except Exception:
                pass

    if not email:
        return Response({"error": "Google sign-in failed. No valid email address received."}, status=status.HTTP_400_BAD_REQUEST)

    # Search existing Django DB user
    user = User.objects.filter(email=email).first() or User.objects.filter(username=email).first()

    if not user:
        # Create NEW User in Django Database!
        base_username = email.split("@")[0] if "@" in email else email
        username_candidate = base_username
        c = 1
        while User.objects.filter(username=username_candidate).exists():
            username_candidate = f"{base_username}_{c}"
            c += 1

        user = User.objects.create_user(
            username=username_candidate,
            email=email,
            password=User.objects.make_random_password(),
            first_name=name.split(" ")[0] if name else "",
            last_name=" ".join(name.split(" ")[1:]) if name and " " in name else ""
        )
        if role == "recruiter":
            user.is_staff = True
            user.save()

    # Save / Update UserProfile in Django DB with full_name & profile_image
    profile, created = UserProfile.objects.get_or_create(user=user)
    if name and not profile.full_name:
        profile.full_name = name
    if picture and not profile.profile_image:
        profile.profile_image = picture
    profile.save()

    # Log user into Django session
    auth_login(request, user)

    return Response({
        "success": True,
        "message": f"Successfully signed in with Google as {user.username}!",
        "user": UserSerializer(user).data
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def api_register(request):
    username = request.data.get("username")
    email = request.data.get("email")
    password = request.data.get("password")
    role = request.data.get("role", "candidate")

    if not username or not email or not password:
        return Response({"error": "Missing username, email, or password."}, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(username=username).exists():
        return Response({"error": "Username already exists."}, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(email=email).exists():
        return Response({"error": "Email address already registered."}, status=status.HTTP_400_BAD_REQUEST)

    user = User.objects.create_user(username=username, email=email, password=password)
    if role == "recruiter":
        user.is_staff = True
        user.save()

    # Save UserProfile in Database
    UserProfile.objects.get_or_create(user=user, defaults={"full_name": username})

    auth_login(request, user)
    return Response({
        "success": True,
        "user": UserSerializer(user).data
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def api_login(request):
    username = request.data.get("username")
    password = request.data.get("password")

    if not username or not password:
        return Response({"error": "Missing username or password."}, status=status.HTTP_400_BAD_REQUEST)

    user = authenticate(request, username=username, password=password)
    if user is not None:
        auth_login(request, user)
        return Response({
            "success": True,
            "user": UserSerializer(user).data
        })
    else:
        return Response({"error": "Invalid username or password."}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
def api_logout(request):
    auth_logout(request)
    return Response({"success": True})


@api_view(['GET'])
@permission_classes([AllowAny])
def api_me(request):
    if request.user.is_authenticated:
        return Response({
            "authenticated": True,
            "user": UserSerializer(request.user).data
        })
    return Response({
        "authenticated": False,
        "user": None
    })


@api_view(['GET', 'POST', 'PUT'])
@permission_classes([IsAuthenticated])
def api_profile(request):
    user = request.user
    if not user or not user.is_authenticated:
        return Response({"error": "Authentication credentials were not provided."}, status=status.HTTP_401_UNAUTHORIZED)
        
    profile, created = UserProfile.objects.get_or_create(user=user)

    if request.method in ['POST', 'PUT']:
        # Update core profile attributes
        profile.full_name = request.data.get('full_name', profile.full_name)
        profile.phone = request.data.get('phone', profile.phone)
        profile.location = request.data.get('location', profile.location)
        profile.bio = request.data.get('bio', profile.bio)

        profile.college_name = request.data.get('college_name', profile.college_name)
        profile.degree = request.data.get('degree', profile.degree)
        profile.education_level = request.data.get('education_level', profile.education_level)
        profile.graduation_year = request.data.get('graduation_year', profile.graduation_year)
        
        if 'skills' in request.data:
            profile.skills = request.data.get('skills', [])
        if 'interests' in request.data:
            profile.interests = request.data.get('interests', [])
        if 'projects' in request.data:
            profile.projects = request.data.get('projects', [])
        if 'experience' in request.data:
            profile.experience = request.data.get('experience', [])

        profile.company_name = request.data.get('company_name', profile.company_name)
        profile.designation = request.data.get('designation', profile.designation)
        profile.company_website = request.data.get('company_website', profile.company_website)
        profile.hiring_focus = request.data.get('hiring_focus', profile.hiring_focus)
        
        if 'profile_image' in request.data:
            profile.profile_image = request.data.get('profile_image', profile.profile_image)

        profile.save()

        # Update User email if changed
        email = request.data.get('email')
        if email and email != user.email:
            user.email = email
            user.save()

    profile_serialized = UserProfileSerializer(profile).data

    if user.is_staff:
        # Recruiter profile details
        jobs = JobPosting.objects.filter(recruiter=user).order_by("-created_at")
        total_apps = Application.objects.filter(job__recruiter=user).count()
        return Response({
            "is_recruiter": True,
            "user": {
                "username": user.username,
                "email": user.email,
                "is_recruiter": True
            },
            "profile": profile_serialized,
            "jobs_count": jobs.count(),
            "total_applications": total_apps
        })
    else:
        # Candidate profile details
        apps = Application.objects.filter(user=user).order_by("-applied_at")
        serializer = ApplicationSerializer(apps, many=True)
        passport_data = None
        if hasattr(user, 'passport') and user.passport.is_active:
            passport_data = {
                "id": user.passport.id,
                "average_score": user.passport.average_score,
                "verified_skills": user.passport.verified_skills,
                "highlight_reels": user.passport.highlight_reels,
                "updated_at": user.passport.updated_at.strftime("%b %d, %Y")
            }
        return Response({
            "is_recruiter": False,
            "user": {
                "username": user.username,
                "email": user.email,
                "is_recruiter": False
            },
            "profile": profile_serialized,
            "applications": serializer.data,
            "passport": passport_data
        })


# ── JOBS / CANDIDATE ENDPOINTS ────────────────────────────────────

@api_view(['GET'])
@permission_classes([AllowAny])
def api_jobs_list(request):
    jobs = JobPosting.objects.filter(is_active=True).order_by("-created_at")
    serializer = JobPostingSerializer(jobs, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([AllowAny])
def api_job_detail(request, job_id):
    job = get_object_or_404(JobPosting, id=job_id, is_active=True)
    serializer = JobPostingSerializer(job)
    return Response(serializer.data)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def api_apply_job(request, job_id):
    job = get_object_or_404(JobPosting, id=job_id, is_active=True)
    
    use_passport = request.data.get("use_passport", "false") == "true"
    candidate_name = request.data.get("candidate_name")
    candidate_email = request.data.get("candidate_email")

    if use_passport:
        if not hasattr(request.user, 'passport') or not request.user.passport.is_active:
            return Response({"error": "No verified HireAI Interview Passport found on your profile."}, status=status.HTTP_400_BAD_REQUEST)
        
        passport = request.user.passport
        verified_app = passport.verified_application
        if not verified_app:
            return Response({"error": "No verified application linked to your passport."}, status=status.HTTP_400_BAD_REQUEST)
            
        application = Application.objects.create(
            job=job,
            user=request.user,
            candidate_name=candidate_name or request.user.get_full_name() or request.user.username,
            candidate_email=candidate_email or request.user.email,
            resume_file=verified_app.resume_file,
            candidate_image=verified_app.candidate_image,
            resume_text=verified_app.resume_text,
            status="interview_done",
            ats_score=verified_app.ats_score,
            ats_breakdown=verified_app.ats_breakdown,
            ats_feedback="Applied using HireAI Verified Interview Passport.",
            interview_thread_id=verified_app.interview_thread_id,
            interview_report=verified_app.interview_report,
            interview_rating=verified_app.interview_rating,
            interview_percentage=verified_app.interview_percentage,
            interview_recommendation=verified_app.interview_recommendation,
            interview_speaking_fluency=verified_app.interview_speaking_fluency,
            interview_vocab_level=verified_app.interview_vocab_level,
            interview_filler_ratio=verified_app.interview_filler_ratio,
            interview_analytics=verified_app.interview_analytics,
            is_verified=True,
            verification_score=verified_app.verification_score
        )
        
        rec = verified_app.interview_recommendation.lower()
        if "strongly recommend" in rec or "recommend" in rec:
            application.status = "hired"
        elif "do not recommend" in rec:
            application.status = "rejected"
        application.save()
        
        from .growth_agent import trigger_generate_growth_feedback
        trigger_generate_growth_feedback(application.id)
        
        serializer = ApplicationSerializer(application)
        return Response(serializer.data)

    resume_file = request.FILES.get("resume")
    candidate_image = request.FILES.get("candidate_image")

    if not resume_file:
        return Response({"error": "Please upload your resume."}, status=status.HTTP_400_BAD_REQUEST)
    if not candidate_name or not candidate_email:
        return Response({"error": "Candidate name and email are required."}, status=status.HTTP_400_BAD_REQUEST)

    # Extract text from PDF
    try:
        resume_text = extract_text_from_pdf(resume_file)
        resume_file.seek(0)
    except Exception:
        return Response({"error": "Could not read PDF. Please upload a valid PDF."}, status=status.HTTP_400_BAD_REQUEST)

    application = Application.objects.create(
        job=job,
        user=request.user,
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        resume_file=resume_file,
        candidate_image=candidate_image,
        resume_text=resume_text,
        status="pending",
    )

    # Run ATS scoring
    try:
        ats_result = run_ats_scoring(resume_text, job.description, weights=job.ats_weights, threshold=job.ats_threshold)
        application.ats_score = ats_result["final_score"]
        application.ats_breakdown = ats_result["breakdown"]
        application.ats_feedback = ats_result.get("feedback_summary", "")

        is_mock = (job.company == "Mock Practice Room")
        if is_mock or (ats_result["final_score"] >= job.ats_threshold):
            application.status = "ats_passed"
            thread_id = create_interview_session(
                resume_text=resume_text,
                job_description=job.to_interview_dict(),
                max_questions=job.max_questions,
                custom_questions=job.custom_questions,
                max_followups=job.max_followups
            )
            application.interview_thread_id = thread_id
            application.status = "interview_scheduled"
            send_interview_invite(request, application)
        else:
            application.status = "ats_failed"
        application.save()
    except Exception as e:
        application.status = "ats_failed"
        application.save()
        return Response({
            "error": "ATS Parsing error: " + str(e),
            "application": ApplicationSerializer(application).data
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    serializer = ApplicationSerializer(application)
    return Response(serializer.data)


@api_view(['GET'])
def api_application_result(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
    
    serializer = ApplicationSerializer(application)
    return Response(serializer.data)

# ── RECRUITER ENDPOINTS ───────────────────────────────────────────

@api_view(['GET'])
def api_hr_dashboard(request):
    if not request.user.is_staff:
        return Response({"error": "Forbidden: Requires Recruiter role"}, status=status.HTTP_403_FORBIDDEN)
    
    jobs = JobPosting.objects.filter(recruiter=request.user).order_by("-created_at")
    serializer = JobPostingSerializer(jobs, many=True)
    return Response({
        "jobs": serializer.data
    })


@api_view(['POST'])
def api_create_job(request):
    if not request.user.is_staff:
        return Response({"error": "Forbidden: Requires Recruiter role"}, status=status.HTTP_403_FORBIDDEN)
    
    data = request.data
    required_skills = data.get("required_skills", [])
    if isinstance(required_skills, str):
        required_skills = [s.strip() for s in required_skills.split(",") if s.strip()]
        
    nice_to_have = data.get("nice_to_have", [])
    if isinstance(nice_to_have, str):
        nice_to_have = [s.strip() for s in nice_to_have.split(",") if s.strip()]
        
    responsibilities = data.get("responsibilities", [])
    if isinstance(responsibilities, str):
        responsibilities = [r.strip() for r in responsibilities.split("\n") if r.strip()]

    # Resolve custom questions list
    custom_qs = data.get("custom_questions", [])
    if isinstance(custom_qs, str):
        custom_qs = [q.strip() for q in custom_qs.split("\n") if q.strip()]

    job = JobPosting.objects.create(
        title=data.get("title"),
        company=data.get("company"),
        description=data.get("description"),
        required_skills=required_skills,
        nice_to_have=nice_to_have,
        experience=data.get("experience", "0-2 years"),
        responsibilities=responsibilities,
        max_questions=int(data.get("max_questions", 5)),
        max_followups=int(data.get("max_followups", 2)),
        ats_threshold=float(data.get("ats_threshold", 50.0)),
        ats_weights=data.get("ats_weights", {}),
        security_settings=data.get("security_settings") or default_security_settings(),
        custom_questions=custom_qs,
        recruiter=request.user,
    )
    
    serializer = JobPostingSerializer(job)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def api_create_mock_job(request):
    data = request.data
    title = data.get("title", "").strip()
    custom_jd = data.get("description", "").strip()
    focus_topics = data.get("focus_topics", "").strip()

    if not title:
        return Response({"error": "Job role title is required."}, status=status.HTTP_400_BAD_REQUEST)

    # Use custom JD or fallback to a standard role template
    if custom_jd:
        jd_text = custom_jd
    else:
        title_lower = title.lower()
        if "frontend" in title_lower or "react" in title_lower or "angular" in title_lower or "vue" in title_lower:
            jd_text = (
                "Role requirements: Proficient in HTML5, CSS3, JavaScript (ES6+), React.js/Vite, "
                "state management, responsive design, cross-browser compatibility, web performance, and API integration."
            )
        elif "backend" in title_lower or "django" in title_lower or "node" in title_lower or "java" in title_lower or "python" in title_lower:
            jd_text = (
                "Role requirements: Proficient in backend architecture, Python/Django or Node.js, databases (SQL/NoSQL), "
                "RESTful APIs, security protocols, server configuration, caching, testing, and debugging."
            )
        elif "data" in title_lower or "scientist" in title_lower or "analyst" in title_lower or "machine" in title_lower:
            jd_text = (
                "Role requirements: Proficient in SQL, Python/R, data warehousing, statistical modeling, machine learning, "
                "data cleaning, pandas/numpy, visualization (Tableau/PowerBI), and predictive analysis."
            )
        elif "product" in title_lower or "manager" in title_lower:
            jd_text = (
                "Role requirements: Proficient in product roadmap design, market analysis, agile/scrum methodologies, "
                "user stories, PRD writing, user experience research, data analytics, and stakeholder communication."
            )
        elif "sales" in title_lower or "marketing" in title_lower or "copywriter" in title_lower or "seo" in title_lower:
            jd_text = (
                "Role requirements: Proficient in lead generation, customer relationship management, digital marketing strategies, "
                "SEO optimization, copywriting, social media management, market analytics, and strategic campaign planning."
            )
        elif "finance" in title_lower or "financial" in title_lower or "account" in title_lower or "audit" in title_lower:
            jd_text = (
                "Role requirements: Proficient in financial modeling, balance sheets, bookkeeping, Excel modeling, "
                "cost analysis, regulatory compliance, data auditing, and financial risk assessment."
            )
        elif "design" in title_lower or "creative" in title_lower or "artist" in title_lower or "ux" in title_lower or "ui" in title_lower:
            jd_text = (
                "Role requirements: Proficient in visual communication, UI/UX design tools (Figma, Adobe Creative Suite), "
                "typography, wireframing, color theory, user research testing, design systems, and prototyping."
            )
        elif "hr" in title_lower or "recruit" in title_lower or "talent" in title_lower or "admin" in title_lower or "operations" in title_lower or "ops" in title_lower:
            jd_text = (
                "Role requirements: Proficient in talent acquisition, employee relations, onboarding/offboarding, "
                "compliance legislation, office coordination, event planning, operations organization, and spreadsheet tracking."
            )
        elif "customer" in title_lower or "support" in title_lower or "service" in title_lower or "call" in title_lower:
            jd_text = (
                "Role requirements: Proficient in query resolution, active listening, CRM tools, ticketing systems, "
                "customer empathy, verbal and written communication, escalation flows, and product knowledge representation."
            )
        else:
            jd_text = (
                f"Role requirements: Strong knowledge of {title} core methodologies, problem-solving, teamwork, "
                "industry best practices, agile collaboration, and strong communication skills."
            )

    if focus_topics:
        jd_text += f"\n\nKey Practice Focus Areas: The candidate specifically wants to focus on and practice: {focus_topics}."

    # Find or create mock recruiter user to own this posting
    dummy_recruiter, _ = User.objects.get_or_create(
        username="mock_practice_system",
        defaults={"email": "practice@hireai.internal", "is_staff": True}
    )

    job = JobPosting.objects.create(
        title=title,
        company="Mock Practice Room",
        description=jd_text,
        required_skills=[title],
        nice_to_have=[],
        experience="Practice Sandbox",
        responsibilities=["Refining communication", "Demonstrating domain knowledge", "Practicing visual etiquette"],
        max_questions=5,
        max_followups=2,
        ats_threshold=30.0,
        ats_weights={
            "skill": 35,
            "technology_and_tools": 25,
            "experience": 10,
            "qualification": 10,
            "has_strong_project": 5,
            "achievement": 5,
            "internship": 5,
            "soft_skill": 5
        },
        security_settings={
            "looking_away": True,
            "fullscreen": True,
            "tab_switching": True,
            "multiple_faces": True,
            "liveness": False,
            "blink_detection": False
        },
        custom_questions=[],
        recruiter=dummy_recruiter
    )

    return Response({"job_id": job.id}, status=status.HTTP_201_CREATED)


@api_view(['GET'])
def api_job_applications(request, job_id):
    if not request.user.is_staff:
        return Response({"error": "Forbidden: Requires Recruiter role"}, status=status.HTTP_403_FORBIDDEN)
        
    job = get_object_or_404(JobPosting, id=job_id)
    apps = job.applications.all().order_by("-applied_at")
    
    job_serializer = JobPostingSerializer(job)
    apps_serializer = ApplicationSerializer(apps, many=True)
    
    return Response({
        "job": job_serializer.data,
        "applications": apps_serializer.data
    })

# ── PROCTORING / INTERVIEW ENDPOINTS ───────────────────────────────

def update_live_telemetry(application, status=None, current_question_index=None, current_question_text=None, word_count=None, emotion=None, yaw=None, pitch=None, emotion_durations=None, emotion_counts=None):
    analytics = application.interview_analytics or {}
    if "live_telemetry" not in analytics:
        analytics["live_telemetry"] = {}
        
    telemetry = analytics["live_telemetry"]
    
    if status is not None:
        telemetry["status"] = status
    if current_question_index is not None:
        telemetry["current_question_index"] = current_question_index
    if current_question_text is not None:
        telemetry["current_question_text"] = current_question_text
    if word_count is not None:
        telemetry["current_word_count"] = word_count
    if emotion is not None:
        telemetry["live_emotion"] = emotion
    if yaw is not None:
        telemetry["live_yaw"] = yaw
    if pitch is not None:
        telemetry["live_pitch"] = pitch
    if emotion_durations is not None:
        telemetry["emotion_durations"] = emotion_durations
    if emotion_counts is not None:
        telemetry["emotion_counts"] = emotion_counts
        
    telemetry["live_warnings_count"] = application.security_warnings
    telemetry["live_is_disqualified"] = application.is_disqualified
    telemetry["last_active_timestamp"] = datetime.datetime.now().strftime("%I:%M:%S %p")
    
    analytics["live_telemetry"] = telemetry
    application.interview_analytics = analytics
    application.save(update_fields=["interview_analytics"])

@api_view(['GET'])
def api_interview_state(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)

    if application.status not in ["interview_scheduled", "interview_done"]:
        return Response({
            "eligible": False,
            "message": "You are not eligible for the interview or it is complete."
        }, status=status.HTTP_400_BAD_REQUEST)

    # Check if rules are accepted in session
    rules_accepted = request.session.get(f"rules_accepted_{application_id}", False)
    
    # Update live status
    status = "verifying" if not application.is_verified else "thinking"
    update_live_telemetry(application, status=status)

    state = get_current_question(application.interview_thread_id)
    return Response({
        "eligible": True,
        "rules_accepted": rules_accepted,
        "state": state,
        "application": ApplicationSerializer(application).data
    })


@api_view(['POST'])
def api_verify_face(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_430_FORBIDDEN)

    live_image_base64 = request.data.get("image", "")
    if not live_image_base64:
        return Response({"error": "No live webcam image provided"}, status=status.HTTP_400_BAD_REQUEST)

    # If it is a mock practice session, auto-approve the check!
    if application.job.company == "Mock Practice Room":
        # Save webcam frame on the fly if no candidate image exists
        if not application.candidate_image:
            try:
                import base64
                from django.core.files.base import ContentFile
                format, imgstr = live_image_base64.split(';base64,') if ';base64,' in live_image_base64 else ('image/jpeg', live_image_base64)
                ext = 'jpg'
                if 'png' in format:
                    ext = 'png'
                application.candidate_image.save(f"practice_profile_{application.id}.{ext}", ContentFile(base64.b64decode(imgstr)), save=True)
            except Exception:
                pass
        
        application.is_verified = True
        application.verification_score = 100.0
        application.save()
        update_live_telemetry(application, status="thinking")
        return Response({
            "success": True,
            "verified": True,
            "score": 100.0,
            "message": "Face verified successfully! Ready to begin practice."
        })

    # For standard assessments, require the profile picture
    if not application.candidate_image:
        try:
            import base64
            from django.core.files.base import ContentFile
            format, imgstr = live_image_base64.split(';base64,') if ';base64,' in live_image_base64 else ('image/jpeg', live_image_base64)
            ext = 'jpg'
            if 'png' in format:
                ext = 'png'
            application.candidate_image.save(f"verified_profile_{application.id}.{ext}", ContentFile(base64.b64decode(imgstr)), save=True)
            application.save()
        except Exception as e:
            return Response({"error": f"No registered candidate profile image found, and failed to register on the fly: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)

    # Increment verification attempts
    application.verification_attempts += 1
    application.save()

    result = run_face_verification(
        registered_image_path=application.candidate_image.path,
        live_image_base64=live_image_base64,
        model_name="Facenet"
    )

    if result.get("error"):
        return Response({
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
        update_live_telemetry(application, status="thinking")
        return Response({
            "success": True,
            "verified": True,
            "score": score,
            "message": "Face verified successfully! You may now begin the interview."
        })
    else:
        application.verification_score = score
        application.save()
        return Response({
            "success": True,
            "verified": False,
            "score": score,
            "message": "Face verification failed. The live image does not match your profile picture."
        })


@api_view(['POST'])
def api_submit_answer(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)

    answer = request.data.get("answer", "").strip()
    state = submit_answer(application.interview_thread_id, answer)

    # If finished, compile and save report
    if state["phase"] == "finished":
        report = state.get("report", {})
        application.interview_report = state.get("final_report", "")
        application.interview_rating = report.get("rating", "")
        application.interview_percentage = report.get("percentage", 0.0)
        application.interview_recommendation = report.get("recommendation", "")
        application.status = "interview_done"
        application.interview_speaking_fluency = report.get("avg_fluency", 0.0)
        application.interview_vocab_level = report.get("vocab_level", "")
        application.interview_filler_ratio = report.get("filler_ratio", 0.0)

        # Compile expression history
        emotions = request.session.get("emotions_history", [])
        nervousness = request.session.get("nervousness_history", [])
        
        emotion_counts = {}
        for em in emotions:
            emotion_counts[em] = emotion_counts.get(em, 0) + 1
            
        avg_nervousness = sum(nervousness) / len(nervousness) if nervousness else 0.0
        avg_confidence = max(0.0, 100.0 - avg_nervousness)
        
        session_durations = request.session.get("emotion_durations", {})
        session_counts = request.session.get("emotion_counts", {})
        
        # Aggregate unique filler words from speaking scores
        speaking_scores = report.get("speaking_scores", [])
        collected_fillers = []
        for s in speaking_scores:
            if isinstance(s, dict) and "top_fillers" in s:
                collected_fillers.extend(s["top_fillers"])
        unique_fillers = list(set(collected_fillers))

        # Keep existing values (such as voice_spoof_history and voice_spoof_summary)
        analytics = application.interview_analytics or {}
        analytics.update({
            "emotions_distribution": emotion_counts,
            "avg_nervousness": round(avg_nervousness, 1),
            "avg_confidence": round(avg_confidence, 1),
            "total_expression_checks": len(emotions),
            "avg_ttr": report.get("avg_ttr", 0.0),
            "emotion_durations": session_durations,
            "emotion_counts": session_counts,
            "speaking_scores": speaking_scores,
            "top_fillers": unique_fillers,
        })
        application.interview_analytics = analytics

        # Auto hire/reject
        rec = report.get("recommendation", "").lower()
        if "strongly recommend" in rec or "recommend" in rec:
            application.status = "hired"
        elif "do not recommend" in rec:
            application.status = "rejected"
        application.save()
        update_live_telemetry(application, status="completed")

        # ── Trigger candidate growth report generation in background ──
        from .growth_agent import trigger_generate_growth_feedback
        trigger_generate_growth_feedback(application.id)

        # ── Generate/Update user's HireAI Interview Passport ──
        if application.is_verified and application.job.company != "Mock Practice Room":
            from .models import InterviewPassport
            passport, created = InterviewPassport.objects.get_or_create(user=application.user)
            if created or application.interview_percentage >= passport.average_score:
                passport.verified_application = application
                passport.average_score = application.interview_percentage
                passport.verified_skills = application.job.required_skills
                passport.highlight_reels = [
                    {
                        "question": "Oral Communication & Cadence",
                        "text": f"Demonstrated {application.interview_vocab_level} vocabulary command, with a fluency rating of {application.interview_speaking_fluency or 0}/10 and low filler count."
                    }
                ]
                passport.is_active = True
                passport.save()
    else:
        update_live_telemetry(application, status="thinking")

    return Response(state)


@api_view(['POST'])
def api_submit_proctoring(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)

    live_image_base64 = request.data.get("image", "")
    client_warnings = request.data.get("warnings", {})

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    warnings_triggered = []
    notice_message = None
    current_time = time.time()
    
    # Initialize timing and throttling in session
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
        request.session["emotions_history"] = []
        request.session["nervousness_history"] = []
        request.session["last_frame_time"] = current_time
        request.session["emotion_durations"] = {"happy": 0.0, "sad": 0.0, "neutral": 0.0, "angry": 0.0, "fear": 0.0, "surprise": 0.0, "disgust": 0.0}
        request.session["emotion_counts"] = {"happy": 0, "sad": 0, "neutral": 0, "angry": 0, "fear": 0, "surprise": 0, "disgust": 0}
        request.session["last_detected_emotion"] = None

    if "emotion_durations" not in request.session:
        request.session["emotion_durations"] = {"happy": 0.0, "sad": 0.0, "neutral": 0.0, "angry": 0.0, "fear": 0.0, "surprise": 0.0, "disgust": 0.0}
    if "emotion_counts" not in request.session:
        request.session["emotion_counts"] = {"happy": 0, "sad": 0, "neutral": 0, "angry": 0, "fear": 0, "surprise": 0, "disgust": 0}
    if "last_frame_time" not in request.session:
        request.session["last_frame_time"] = current_time

    last_liveness_check = request.session.get("last_liveness_check")
    consecutive_mismatches = request.session.get("consecutive_mismatches", 0)
    
    security_settings = application.job.security_settings or {
        "looking_away": True,
        "fullscreen": True,
        "tab_switching": True,
        "multiple_faces": True,
        "liveness": True,
        "blink_detection": True
    }

    if consecutive_mismatches > 0:
        should_check_liveness = (last_liveness_check is None) or (current_time - last_liveness_check >= 5.0)
    else:
        should_check_liveness = (last_liveness_check is None) or (current_time - last_liveness_check >= 15.0)
    
    # Honor recruiter's liveness check toggle setting
    should_check_liveness = should_check_liveness and security_settings.get("liveness", True)

    is_currently_looking_away = False
    face_count = 0
    coords = []
    pitch = 0.0
    yaw = 0.0

    # 1. Server-side visual analysis
    if live_image_base64:
        img = decode_base64_to_cv2(live_image_base64)
        if img is not None:
            import concurrent.futures

            run_full_check = should_check_liveness and application.candidate_image and os.path.exists(application.candidate_image.path)
            
            verify_future = None
            verify_res = None
            emotion_res = None
            
            # Start identity verification in parallel immediately to overlap with head pose estimation
            if run_full_check:
                # Save session immediately to reserve the check slot and prevent concurrent verification tasks
                request.session["last_liveness_check"] = current_time
                request.session.save()
                
                executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
                verify_future = executor.submit(
                    analyze_expression_and_identity,
                    application.candidate_image.path,
                    img
                )

            # Run pose estimation in the main thread (fast MediaPipe execution)
            pose_res = estimate_head_pose(img)
            face_count = pose_res.get("face_count", 0)
            ear = pose_res.get("ear", 0.0)
            blink_detected = pose_res.get("blink_detected", False)
            coords = pose_res.get("landmarks", [])
            pitch = pose_res.get("pitch", 0.0)
            yaw = pose_res.get("yaw", 0.0)

            # Multi-face warning
            if face_count > 1 and security_settings.get("multiple_faces", True):
                warnings_triggered.append(f"Multiple faces detected ({face_count} faces in frame)")
            # Looking away
            elif pose_res.get("looking_away", False) and security_settings.get("looking_away", True):
                is_currently_looking_away = True
                
            # Liveness/Identity verification check & Real-time Emotion analysis
            is_looking_away_detected = is_currently_looking_away or client_warnings.get("looking_away", False)
            
            face_box = pose_res.get("face_box")
            cropped_face = img
            is_cropped = False
            
            if face_box and face_count == 1:
                orig_h, orig_w = img.shape[:2]
                x_min = max(0, int(face_box[0] * orig_w))
                y_min = max(0, int(face_box[1] * orig_h))
                x_max = min(orig_w, int(face_box[2] * orig_w))
                y_max = min(orig_h, int(face_box[3] * orig_h))
                
                # Add 15% padding
                x_pad = int((x_max - x_min) * 0.15)
                y_pad = int((y_max - y_min) * 0.15)
                x_min = max(0, x_min - x_pad)
                x_max = min(orig_w, x_max + x_pad)
                y_min = max(0, y_min - y_pad)
                y_max = min(orig_h, y_max + y_pad)
                
                if (x_max - x_min) > 10 and (y_max - y_min) > 10:
                    cropped_face = img[y_min:y_max, x_min:x_max]
                    is_cropped = True

            current_emotion = "neutral"
            nervousness_val = 0.0
            
            should_run_emotion = (face_count == 1 and not is_looking_away_detected)
            is_mock = (application.job.company == "Mock Practice Room")
            
            if run_full_check:
                emotion_future = None
                # Submit emotion analysis task in parallel with verification check
                if should_run_emotion and not is_mock:
                    emotion_future = executor.submit(analyze_emotion, cropped_face, is_cropped)
                
                # Retrieve verify results
                if verify_future:
                    try:
                        verify_res = verify_future.result()
                    except Exception as e:
                        print(f"Error in verify_future: {e}")
                        verify_res = None
                
                # Retrieve emotion results
                if emotion_future:
                    try:
                        emotion_res = emotion_future.result()
                        current_emotion = emotion_res.get("emotion", "neutral")
                        nervousness_val = emotion_res.get("nervousness_score", 0.0)
                    except Exception as e:
                        print(f"Error in emotion_future: {e}")
                
                executor.shutdown(wait=False)

                if face_count == 1 and not is_looking_away_detected:
                    emotions_history = request.session.get("emotions_history", [])
                    emotions_history.append(current_emotion)
                    request.session["emotions_history"] = emotions_history
                    
                    nervousness_history = request.session.get("nervousness_history", [])
                    nervousness_history.append(nervousness_val)
                    request.session["nervousness_history"] = nervousness_history

                    if verify_res and verify_res.get("verified", False):
                        request.session["consecutive_mismatches"] = 0
                    else:
                        consecutive_mismatches = request.session.get("consecutive_mismatches", 0) + 1
                        request.session["consecutive_mismatches"] = consecutive_mismatches
                        if consecutive_mismatches >= 3:
                            warnings_triggered.append("Face mismatch / Identity verification failed")
                            request.session["consecutive_mismatches"] = 0
                else:
                    current_mismatches = request.session.get("consecutive_mismatches", 0)
                    if current_mismatches > 0:
                        consecutive_mismatches = current_mismatches + 1
                        request.session["consecutive_mismatches"] = consecutive_mismatches
                        if consecutive_mismatches >= 3:
                            warnings_triggered.append("Face mismatch / Identity verification failed")
                            request.session["consecutive_mismatches"] = 0
            
            elif should_run_emotion:
                if not is_mock:
                    emotion_res = analyze_emotion(cropped_face, is_cropped=is_cropped)
                    current_emotion = emotion_res.get("emotion", "neutral")
                    nervousness_val = emotion_res.get("nervousness_score", 0.0)
                else:
                    current_emotion = "neutral"
                    nervousness_val = 0.0
                
                emotions_history = request.session.get("emotions_history", [])
                emotions_history.append(current_emotion)
                request.session["emotions_history"] = emotions_history
                
                nervousness_history = request.session.get("nervousness_history", [])
                nervousness_history.append(nervousness_val)
                request.session["nervousness_history"] = nervousness_history
            
            # Calculate elapsed time since last frame
            last_frame_time = request.session.get("last_frame_time", current_time)
            elapsed = current_time - last_frame_time
            if elapsed > 10.0 or elapsed <= 0.0:
                elapsed = 5.0  # default proctor check interval
            request.session["last_frame_time"] = current_time

            # Update accumulated durations in session (only if face is visible and valid)
            if face_count == 1 and not is_looking_away_detected:
                emotion_durations = request.session.get("emotion_durations", {"happy": 0.0, "sad": 0.0, "neutral": 0.0, "angry": 0.0, "fear": 0.0, "surprise": 0.0, "disgust": 0.0})
                emotion_durations[current_emotion] = round(emotion_durations.get(current_emotion, 0.0) + elapsed, 1)
                request.session["emotion_durations"] = emotion_durations

                # Update transition counts in session (frequency)
                emotion_counts = request.session.get("emotion_counts", {"happy": 0, "sad": 0, "neutral": 0, "angry": 0, "fear": 0, "surprise": 0, "disgust": 0})
                last_emotion = request.session.get("last_detected_emotion", None)
                if current_emotion != last_emotion:
                    emotion_counts[current_emotion] = emotion_counts.get(current_emotion, 0) + 1
                    request.session["last_detected_emotion"] = current_emotion
                    request.session["emotion_counts"] = emotion_counts
        else:
            face_count = 0

    # 2. Client-side warnings
    if client_warnings.get("looking_away", False) and security_settings.get("looking_away", True):
        is_currently_looking_away = True
    is_mock = (application.job.company == "Mock Practice Room")
    if client_warnings.get("ambient_noise", False) and not is_mock:
        warnings_triggered.append("High background audio activity detected")
    if client_warnings.get("tab_switching", False) and security_settings.get("tab_switching", True):
        warnings_triggered.append("Tab switching or unfocusing the window detected")
    if client_warnings.get("fullscreen_exit", False) and security_settings.get("fullscreen", True):
        warnings_triggered.append("Exited fullscreen mode")

    # 3. Precise timing-based warning thresholds
    # Out of Frame (> 5s)
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
                request.session["out_of_frame_since"] = current_time
    else:
        request.session["out_of_frame_since"] = current_time

    # Looking Away (> 4s)
    if is_currently_looking_away and security_settings.get("looking_away", True):
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
                request.session["looking_away_since"] = current_time
    else:
        request.session["looking_away_since"] = current_time

    # Liveness check (static photo)
    if face_count == 1 and coords and security_settings.get("liveness", True):
        last_landmarks = request.session.get("last_landmarks")
        static_face_count = request.session.get("static_face_count", 0)
        
        if last_landmarks and last_landmarks == coords:
            static_face_count += 1
        else:
            static_face_count = 0
            
        request.session["last_landmarks"] = coords
        request.session["static_face_count"] = static_face_count

        if static_face_count >= 15:
            last_static_photo_warning = request.session.get("last_static_photo_warning_time", 0.0)
            if current_time - last_static_photo_warning > 30.0:
                warnings_triggered.append("Liveness check failed: Potential static photo or frozen camera feed detected")
                request.session["last_static_photo_warning_time"] = current_time
            
        # Blink tracking
        blinks_count = request.session.get("blinks_count", 0)
        was_blinking = request.session.get("was_blinking", False)
        last_blink_time = request.session.get("last_blink_time", current_time)

        if blink_detected and security_settings.get("blink_detection", True):
            request.session["last_blink_time"] = current_time
            if not was_blinking:
                blinks_count += 1
                request.session["was_blinking"] = True
        else:
            request.session["was_blinking"] = False
            if static_face_count == 0:
                request.session["last_blink_time"] = current_time
            else:
                elapsed_since_blink = current_time - last_blink_time
                if elapsed_since_blink > 180.0 and security_settings.get("blink_detection", True):
                    last_blink_warning = request.session.get("last_blink_warning_time", 0.0)
                    if current_time - last_blink_warning > 180.0:
                        notice_message = "Liveness check notice: Please blink or adjust lighting (no eye blinking detected)."
                        request.session["last_blink_warning_time"] = current_time
                        request.session["last_blink_time"] = current_time

        request.session["blinks_count"] = blinks_count
    else:
        request.session["static_face_count"] = 0

    blinks_count = request.session.get("blinks_count", 0)

    # 4. Save to DB
    with transaction.atomic():
        application.refresh_from_db()
        if warnings_triggered:
            log_entry = {
                "timestamp": timestamp,
                "violations": warnings_triggered
            }
            if not isinstance(application.security_log, list):
                application.security_log = []
                
            application.security_log.append(log_entry)
            application.security_warnings += len(warnings_triggered)
            
            if application.security_warnings >= 5:
                application.is_disqualified = True
                
            application.save(update_fields=["security_warnings", "security_log", "is_disqualified"])

    emotions_history = request.session.get("emotions_history", [])
    current_emotion = emotions_history[-1] if emotions_history else "neutral"

    # Dynamic status check & telemetry updates
    is_tabbed_out = request.data.get("warnings", {}).get("is_tabbed_out", False)
    question_count = request.data.get("question_count", 0)
    current_question = request.data.get("current_question", "")
    word_count = request.data.get("word_count", 0)
    
    if is_tabbed_out:
        status = "tabbed_out"
    elif word_count > 0:
        status = "answering"
    else:
        status = "thinking"
        
    emotion_durations = request.session.get("emotion_durations", {"happy": 0.0, "sad": 0.0, "neutral": 0.0})
    emotion_counts = request.session.get("emotion_counts", {"happy": 0, "sad": 0, "neutral": 0})

    update_live_telemetry(
        application,
        status=status,
        current_question_index=question_count,
        current_question_text=current_question,
        word_count=word_count,
        emotion=current_emotion,
        yaw=round(yaw, 1),
        pitch=round(pitch, 1),
        emotion_durations=emotion_durations,
        emotion_counts=emotion_counts
    )

    return Response({
        "success": True,
        "warnings_count": application.security_warnings,
        "is_disqualified": application.is_disqualified,
        "violations": warnings_triggered,
        "notice": notice_message,
        "security_log": application.security_log,
        "blinks_count": blinks_count,
        "liveness_status": "Liveness Verified" if face_count == 1 else "No Face Detected",
        "emotion": current_emotion,
        "pitch": round(pitch, 1),
        "yaw": round(yaw, 1),
        "emotion_durations": emotion_durations,
        "emotion_counts": emotion_counts
    })


@api_view(['POST'])
def api_preload_models(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
        
    preload_heavy_libraries()
    return Response({"success": True})


@api_view(['POST'])
def api_start_interview(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
        
    request.session[f"rules_accepted_{application_id}"] = True
    update_live_telemetry(application, status="thinking")
    return Response({"success": True})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def api_ats_analyze(request):
    resume_file = request.FILES.get("resume")
    target_role = request.data.get("target_role", "").strip()
    target_jd = request.data.get("target_jd", "").strip()

    if not resume_file:
        return Response({"error": "Please upload a resume PDF file."}, status=status.HTTP_400_BAD_REQUEST)

    # Validate PDF type
    if not resume_file.name.lower().endswith(".pdf"):
        return Response({"error": "Only PDF files are supported."}, status=status.HTTP_400_BAD_REQUEST)

    # 1. Extract raw text
    try:
        resume_text = extract_text_from_pdf(resume_file)
        resume_file.seek(0)
    except Exception as e:
        print(f"[ATS-Analyze] PDF extraction error: {e}")
        return Response({"error": "Could not extract text from the PDF file. Please ensure it is not corrupt or scanned as an image only."}, status=status.HTTP_400_BAD_REQUEST)

    if not resume_text:
        return Response({"error": "The PDF file appears to be empty or contains no readable text."}, status=status.HTTP_400_BAD_REQUEST)

    # 2. Extract PDF formatting metadata
    try:
        pdf_metadata = extract_pdf_metadata(resume_file)
        resume_file.seek(0)
    except Exception as e:
        print(f"[ATS-Analyze] Metadata extraction error: {e}")
        pdf_metadata = {
            "num_pages": 1,
            "fonts": ["Unknown"],
            "font_sizes": {"min": 10.0, "max": 12.0, "average": 11.0},
            "colors": ["#000000"],
            "has_images": False
        }

    # 3. Call LLM for audit
    try:
        audit_result = analyze_resume_for_student(
            resume_text=resume_text,
            pdf_metadata=pdf_metadata,
            target_role=target_role,
            target_jd=target_jd
        )
    except Exception as e:
        print(f"[ATS-Analyze] LLM audit failed: {e}")
        return Response({"error": "Failed to analyze resume with AI. Please try again later."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Save to database
    try:
        analysis = ResumeAnalysis.objects.create(
            user=request.user,
            resume_file=resume_file,
            resume_text=resume_text,
            target_role=target_role,
            target_jd=target_jd,
            overall_score=audit_result.overall_score,
            formatting_score=audit_result.formatting_score,
            font_score=audit_result.font_score,
            content_score=audit_result.content_score,
            grammar_score=audit_result.grammar_score,
            word_choice_score=audit_result.word_choice_score,
            feedback_details={
                "formatting": [i.model_dump() for i in audit_result.formatting_feedback],
                "font": [i.model_dump() for i in audit_result.font_feedback],
                "content": [i.model_dump() for i in audit_result.content_feedback],
                "grammar": [i.model_dump() for i in audit_result.grammar_feedback],
                "word_choice": [i.model_dump() for i in audit_result.word_choice_feedback],
                "strengths": audit_result.strengths,
                "summary": audit_result.summary
            }
        )
        serializer = ResumeAnalysisSerializer(analysis)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    except Exception as e:
        print(f"[ATS-Analyze] Database save error: {e}")
        return Response({"error": f"Failed to save analysis results: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def api_ats_history(request):
    analyses = ResumeAnalysis.objects.filter(user=request.user).order_by('-created_at')
    serializer = ResumeAnalysisSerializer(analyses, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def api_ats_analysis_detail(request, analysis_id):
    analysis = get_object_or_404(ResumeAnalysis, id=analysis_id, user=request.user)
    serializer = ResumeAnalysisSerializer(analysis)
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def api_ats_fix(request, analysis_id):
    analysis = get_object_or_404(ResumeAnalysis, id=analysis_id, user=request.user)
    try:
        from .ats_service import auto_fix_resume
        from django.core.files.base import ContentFile
        
        approved_issues = request.data.get("approved_issues", None)
        pdf_bytes = auto_fix_resume(analysis, approved_issues=approved_issues)
        
        # Save fixed PDF file
        filename = f"fixed_resume_{analysis.id}.pdf"
        analysis.fixed_resume_file.save(filename, ContentFile(pdf_bytes))
        analysis.save()
        
        serializer = ResumeAnalysisSerializer(analysis)
        return Response(serializer.data, status=status.HTTP_200_OK)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to auto-correct resume: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def api_ats_chat_fix(request, analysis_id):
    analysis = get_object_or_404(ResumeAnalysis, id=analysis_id, user=request.user)
    user_instruction = request.data.get("user_instruction", "").strip()
    if not user_instruction:
        return Response({"error": "Please provide a user instruction to edit the resume."}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        from .ats_service import chat_fix_resume
        from django.core.files.base import ContentFile
        
        pdf_bytes = chat_fix_resume(analysis, user_instruction)
        
        # Save fixed PDF file
        filename = f"fixed_resume_{analysis.id}.pdf"
        analysis.fixed_resume_file.save(filename, ContentFile(pdf_bytes))
        analysis.save()
        
        serializer = ResumeAnalysisSerializer(analysis)
        return Response(serializer.data, status=status.HTTP_200_OK)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to modify resume: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def api_recruiter_helper_chat(request):
    is_recruiter = getattr(request.user, 'is_recruiter', None)
    if is_recruiter is None:
        is_recruiter = request.user.is_staff
    if not is_recruiter:
        return Response({"error": "Only recruiters can access this helper chat."}, status=status.HTTP_403_FORBIDDEN)
        
    user_instruction = request.data.get("user_instruction", "").strip()
    if not user_instruction:
        return Response({"error": "Please provide a message."}, status=status.HTTP_400_BAD_REQUEST)
        
    current_jd = request.data.get("current_jd", "")
    current_skills = request.data.get("current_skills", "")
    current_questions = request.data.get("current_questions", [])
    
    from .ats_service import run_recruiter_helper_chat
    
    try:
        result = run_recruiter_helper_chat(
            user_instruction=user_instruction,
            current_jd=current_jd,
            current_skills=current_skills,
            current_questions=current_questions
        )
        return Response(result, status=status.HTTP_200_OK)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to generate recruitment details: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def api_share_growth_feedback(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if not request.user.is_staff:
        return Response({"error": "Only recruiters can share feedback."}, status=status.HTTP_403_FORBIDDEN)
        
    share = request.data.get("share", True)
    
    from .models import InterviewFeedback
    feedback, _ = InterviewFeedback.objects.get_or_create(application=application)
    feedback.is_shared_with_candidate = share
    feedback.save()
    
    return Response({
        "success": True, 
        "is_shared_with_candidate": feedback.is_shared_with_candidate
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def api_candidate_growth_feedback(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return Response({"error": "Unauthorized"}, status=status.HTTP_403_FORBIDDEN)
        
    from .models import InterviewFeedback
    feedback = InterviewFeedback.objects.filter(application=application).first()
    if not feedback:
        return Response({"feedback": None})
        
    is_practice = (application.job.company == "Mock Practice Room")
    if not feedback.is_shared_with_candidate and not is_practice and not request.user.is_staff:
        return Response({"feedback": None, "message": "Growth feedback has not been released yet."})
        
    return Response({
        "id": feedback.id,
        "weaknesses": feedback.weaknesses,
        "strengths": feedback.strengths,
        "study_resources": feedback.study_resources,
        "is_shared_with_candidate": feedback.is_shared_with_candidate
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def api_ats_auto_align(request):
    resume_text = request.data.get("resume_text", "").strip()
    target_jd = request.data.get("target_jd", "").strip()
    
    if not resume_text or not target_jd:
        return Response({"error": "Original resume text and target job description are required."}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        from .ats_aligner import align_resume
        from django.http import HttpResponse
        
        pdf_bytes = align_resume(resume_text, target_jd, username=request.user.get_full_name() or request.user.username)
        
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = 'attachment; filename="aligned_resume.pdf"'
        return response
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to auto-align resume: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def api_profile_chat(request):
    user = request.user
    if not user or not user.is_authenticated:
        return Response({"error": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)

    profile, created = UserProfile.objects.get_or_create(user=user)
    user_instruction = request.data.get("user_instruction", "").strip()

    if not user_instruction:
        return Response({"error": "Instruction is required."}, status=status.HTTP_400_BAD_REQUEST)

    # Fetch latest resume analysis if available
    latest_resume = ResumeAnalysis.objects.filter(user=user).order_by("-created_at").first()
    resume_data = None
    if latest_resume and latest_resume.fixed_resume_json:
        resume_data = latest_resume.fixed_resume_json

    current_profile_data = UserProfileSerializer(profile).data

    try:
        from .ats_service import run_profile_assistant_chat
        result = run_profile_assistant_chat(
            user_instruction=user_instruction,
            current_profile=current_profile_data,
            latest_resume_data=resume_data
        )

        updated = False
        # Update single fields if extracted
        for field in ['full_name', 'phone', 'location', 'bio', 'college_name', 'degree', 
                      'education_level', 'graduation_year', 'skills', 'interests', 
                      'company_name', 'designation', 'company_website', 'hiring_focus']:
            val = result.get(field)
            if val is not None and val != "":
                setattr(profile, field, val)
                updated = True

        # Handle sync from resume explicitly or when requested
        if result.get("sync_from_resume") and latest_resume:
            if latest_resume.fixed_resume_json:
                parsed = latest_resume.fixed_resume_json
                if parsed.get("skills") and isinstance(parsed["skills"], list):
                    existing = profile.skills or []
                    for s in parsed["skills"]:
                        if s not in existing:
                            existing.append(s)
                    profile.skills = existing
                    updated = True
                if parsed.get("summary") and not profile.bio:
                    profile.bio = parsed["summary"]
                    updated = True
                if parsed.get("contact", {}).get("name") and not profile.full_name:
                    profile.full_name = parsed["contact"]["name"]
                    updated = True

        if updated:
            profile.save()

        profile_serialized = UserProfileSerializer(profile).data
        return Response({
            "success": True,
            "message": result.get("message", "Subh AI updated your profile successfully."),
            "profile": profile_serialized
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to process profile update: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


