from django.urls import path
from . import views

urlpatterns = [
    path("", views.hr_dashboard, name="hr_dashboard"),
    path("create/", views.create_job, name="create_job"),
    path("jobs/<int:job_id>/", views.job_applications, name="job_applications"),
]
