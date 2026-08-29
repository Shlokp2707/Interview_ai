from django.urls import path
from . import api_views

urlpatterns = [
    # Auth
    path("auth/register/", api_views.api_register, name="api_register"),
    path("auth/login/", api_views.api_login, name="api_login"),
    path("auth/send-otp/", api_views.api_send_otp, name="api_send_otp"),
    path("auth/verify-otp/", api_views.api_verify_otp, name="api_verify_otp"),
    path("auth/google/", api_views.api_google_auth, name="api_google_auth"),
    path("auth/config/", api_views.api_auth_config, name="api_auth_config"),
    path("auth/logout/", api_views.api_logout, name="api_logout"),
    path("auth/me/", api_views.api_me, name="api_me"),
    path("auth/profile/", api_views.api_profile, name="api_profile"),
    path("auth/profile-chat/", api_views.api_profile_chat, name="api_profile_chat"),

    # Jobs / Candidate
    path("jobs/", api_views.api_jobs_list, name="api_jobs_list"),
    path("jobs/<int:job_id>/", api_views.api_job_detail, name="api_job_detail"),
    path("jobs/<int:job_id>/apply/", api_views.api_apply_job, name="api_apply_job"),
    path("applications/<int:application_id>/", api_views.api_application_result, name="api_application_result"),

    # Recruiter
    path("recruiter/dashboard/", api_views.api_hr_dashboard, name="api_hr_dashboard"),
    path("recruiter/create-job/", api_views.api_create_job, name="api_create_job"),
    path("recruiter/create-mock-job/", api_views.api_create_mock_job, name="api_create_mock_job"),
    path("recruiter/jobs/<int:job_id>/applications/", api_views.api_job_applications, name="api_job_applications"),

    # Interview / Proctoring
    path("interview/<int:application_id>/state/", api_views.api_interview_state, name="api_interview_state"),
    path("interview/<int:application_id>/verify/", api_views.api_verify_face, name="api_verify_face"),
    path("interview/<int:application_id>/submit/", api_views.api_submit_answer, name="api_submit_answer"),
    path("interview/<int:application_id>/proctor/", api_views.api_submit_proctoring, name="api_submit_proctoring"),
    path("interview/<int:application_id>/preload/", api_views.api_preload_models, name="api_preload_models"),
    path("interview/<int:application_id>/start/", api_views.api_start_interview, name="api_start_interview"),

    # Student ATS Resume Scorer
    path("ats/analyze/", api_views.api_ats_analyze, name="api_ats_analyze"),
    path("ats/history/", api_views.api_ats_history, name="api_ats_history"),
    path("ats/analysis/<int:analysis_id>/", api_views.api_ats_analysis_detail, name="api_ats_analysis_detail"),
    path("ats/analysis/<int:analysis_id>/fix/", api_views.api_ats_fix, name="api_ats_fix"),
    path("ats/analysis/<int:analysis_id>/chat-fix/", api_views.api_ats_chat_fix, name="api_ats_chat_fix"),
    path("recruiter/helper-chat/", api_views.api_recruiter_helper_chat, name="api_recruiter_helper_chat"),
    
    # AI Interview Passport & Growth Reports
    path("interview/<int:application_id>/share-feedback/", api_views.api_share_growth_feedback, name="api_share_growth_feedback"),
    path("interview/<int:application_id>/growth-feedback/", api_views.api_candidate_growth_feedback, name="api_candidate_growth_feedback"),
    path("ats/auto-align/", api_views.api_ats_auto_align, name="api_ats_auto_align"),
]
