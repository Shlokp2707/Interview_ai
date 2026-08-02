from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("apply/<int:job_id>/", views.apply, name="apply"),
    path("result/<int:application_id>/", views.application_result, name="application_result"),
]
