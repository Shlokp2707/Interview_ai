from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.conf import settings
from interviewer.models import JobPosting, Application
from interviewer.views import extract_text_from_pdf, send_interview_invite
from interviewer.ats_service import run_ats_scoring
from interviewer.interview_service import create_interview_session

def home(request):
    jobs = JobPosting.objects.filter(is_active=True).order_by("-created_at")
    return render(request, "user/home.html", {"jobs": jobs})


@login_required
def apply(request, job_id):
    job = get_object_or_404(JobPosting, id=job_id, is_active=True)

    if request.method == "POST":
        resume_file = request.FILES.get("resume")
        candidate_image = request.FILES.get("candidate_image")
        if not resume_file:
            return render(request, "user/apply.html", {"job": job, "error": "Please upload your resume."})

        # Extract text from PDF
        try:
            resume_text = extract_text_from_pdf(resume_file)
            resume_file.seek(0)  # reset for saving
        except Exception:
            return render(request, "user/apply.html", {"job": job, "error": "Could not read PDF. Please upload a valid PDF."})

        # Save application
        application = Application.objects.create(
            job             = job,
            user            = request.user,
            candidate_name  = request.POST["candidate_name"],
            candidate_email = request.POST["candidate_email"],
            resume_file     = resume_file,
            candidate_image = candidate_image,
            resume_text     = resume_text,
            status          = "pending",
        )

        # Run ATS scoring
        try:
            ats_result = run_ats_scoring(resume_text, job.description)
            print(ats_result)
            application.ats_score     = ats_result["final_score"]
            application.ats_breakdown = ats_result["breakdown"]
            application.ats_feedback  = ats_result.get("feedback_summary", "")
            print("ATS RESULT:", ats_result)
            if ats_result["passed"] and ats_result["final_score"] >= job.ats_threshold:
                application.status = "ats_passed"
                # Create interview session immediately
                thread_id = create_interview_session(
                    resume_text      = resume_text,
                    job_description  = job.to_interview_dict(),
                    max_questions    = job.max_questions,
                )
                application.interview_thread_id = thread_id
                application.status = "interview_scheduled"
                send_interview_invite(request, application)
            else:
                application.status = "ats_failed"
            print("FINAL STATUS:", application.status)
            application.save()
        except Exception as e:
            print("ERROR:", str(e))
            import traceback
            traceback.print_exc()

            application.status = "ats_failed"
            application.save()

        return redirect("application_result", application_id=application.id)
    return render(request, "user/apply.html", {"job": job})


@login_required
def application_result(request, application_id):
    application = get_object_or_404(Application, id=application_id)
    if application.user != request.user and not request.user.is_staff:
        return redirect("home")
    return render(request, "user/application_result.html", {"application": application})
