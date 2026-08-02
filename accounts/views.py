from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from interviewer.models import Application, JobPosting

def register_view(request):
    if request.user.is_authenticated:
        return redirect("home")
    if request.method == "POST":
        username = request.POST["username"]
        email = request.POST["email"]
        password = request.POST["password"]
        role = request.POST.get("role", "candidate")

        if User.objects.filter(username=username).exists():
            return render(request, "accounts/register.html", {"error": "Username already exists."})

        if User.objects.filter(email=email).exists():
            return render(request, "accounts/register.html", {"error": "Email address already registered."})

        user = User.objects.create_user(username=username, email=email, password=password)
        if role == "recruiter":
            user.is_staff = True
            user.save()

        auth_login(request, user)
        next_url = request.GET.get("next") or request.POST.get("next")
        if next_url:
            return redirect(next_url)
        if role == "recruiter":
            return redirect("hr_dashboard")
        return redirect("home")
    return render(request, "accounts/register.html")


def login_view(request):
    if request.user.is_authenticated:
        return redirect("home")
    if request.method == "POST":
        username = request.POST["username"]
        password = request.POST["password"]
        user = authenticate(request, username=username, password=password)
        if user is not None:
            auth_login(request, user)
            next_url = request.GET.get("next") or request.POST.get("next")
            if next_url:
                return redirect(next_url)
            if user.is_staff:
                return redirect("hr_dashboard")
            return redirect("home")
        else:
            return render(request, "accounts/login.html", {"error": "Invalid username or password."})
    return render(request, "accounts/login.html")


def logout_view(request):
    auth_logout(request)
    return redirect("home")


@login_required
def profile_view(request):
    if request.user.is_staff:
        # Recruiter
        jobs = JobPosting.objects.filter(recruiter=request.user).order_by("-created_at")
        total_apps = Application.objects.filter(job__recruiter=request.user).count()
        context = {                             
            "is_recruiter": True, 
            "jobs": jobs,
            "total_apps": total_apps,
        }
    else:
        # Candidate
        apps = Application.objects.filter(user=request.user).order_by("-applied_at")
        latest_app = apps.first()
        latest_image = latest_app.candidate_image.url if latest_app and latest_app.candidate_image else None
        latest_resume = latest_app.resume_file.url if latest_app and latest_app.resume_file else None
        context = {
            "is_recruiter": False,
            "applications": apps,
            "latest_image": latest_image,
            "latest_resume": latest_resume,
        }
    return render(request, "accounts/profile.html", context)
