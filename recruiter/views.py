from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from interviewer.models import JobPosting, Application

@login_required
def hr_dashboard(request):
    if not request.user.is_staff:
        return redirect("home")
    jobs = JobPosting.objects.all().order_by("-created_at")
    return render(request, "recruiter/hr_dashboard.html", {"jobs": jobs})


@login_required
def create_job(request):
    if not request.user.is_staff:
        return redirect("home")
    if request.method == "POST":
        required_skills  = [s.strip() for s in request.POST.get("required_skills", "").split(",") if s.strip()]
        nice_to_have     = [s.strip() for s in request.POST.get("nice_to_have", "").split(",") if s.strip()]
        responsibilities = [r.strip() for r in request.POST.get("responsibilities", "").split("\n") if r.strip()]

        job = JobPosting.objects.create(
            title            = request.POST["title"],
            company          = request.POST["company"],
            description      = request.POST["description"],
            required_skills  = required_skills,
            nice_to_have     = nice_to_have,
            experience       = request.POST.get("experience", "0-2 years"),
            responsibilities = responsibilities,
            max_questions    = int(request.POST.get("max_questions", 5)),
            ats_threshold    = float(request.POST.get("ats_threshold", 50.0)),
            recruiter        = request.user,
        )
        return redirect("hr_dashboard")
    return render(request, "recruiter/create_job.html")


@login_required
def job_applications(request, job_id):
    if not request.user.is_staff:
        return redirect("home")
    job  = get_object_or_404(JobPosting, id=job_id)
    apps = job.applications.all().order_by("-applied_at")
    return render(request, "recruiter/job_applications.html", {"job": job, "applications": apps})
