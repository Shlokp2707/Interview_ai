# from django.urls import path
# from . import views

# urlpatterns = [
#     # Home
#     path("",                                    views.home,                     name="home"),

#     # HR
#     path("hr/",                                 views.hr_dashboard,             name="hr_dashboard"),
#     path("hr/job/create/",                      views.create_job,               name="create_job"),
#     path("hr/job/<int:job_id>/applications/",   views.job_applications,         name="job_applications"),

#     # Candidate
#     path("apply/<int:job_id>/",                 views.apply,                    name="apply"),
#     path("result/<int:application_id>/",        views.application_result,       name="application_result"),

#     # Interview
#     path("interview/<int:application_id>/",     views.interview,                name="interview"),
#     path("interview/<int:application_id>/answer/", views.submit_interview_answer, name="submit_answer"),
# ]


from django.urls import path
from . import views

urlpatterns = [
    path("interview/<int:application_id>/", views.interview,               name="interview"),
    path("interview/<int:application_id>/submit/", views.submit_interview_answer, name="submit_answer"),
    path("interview/<int:application_id>/verify/", views.verify_face_endpoint, name="verify_face"),
    path("interview/<int:application_id>/proctor/", views.submit_proctoring_telemetry, name="submit_proctoring"),
    path("interview/<int:application_id>/preload/", views.preload_models_endpoint, name="preload_models"),
    path("interview/<int:application_id>/start/", views.start_interview_endpoint, name="start_interview"),
]