from django.db import models
from django.contrib.auth.models import User


def default_security_settings():
    return {
        "looking_away": True,
        "fullscreen": True,
        "tab_switching": True,
        "multiple_faces": True,
        "liveness": False,
        "blink_detection": False
    }


class JobPosting(models.Model):
    """HR creates a job posting with JD."""
    title       = models.CharField(max_length=200)
    company     = models.CharField(max_length=200)
    description = models.TextField()
    required_skills   = models.JSONField(default=list)
    nice_to_have      = models.JSONField(default=list)
    experience        = models.CharField(max_length=50, default="0-2 years")
    responsibilities  = models.JSONField(default=list)
    max_questions     = models.IntegerField(default=5)
    max_followups     = models.IntegerField(default=2)
    ats_threshold     = models.FloatField(default=50.0)
    ats_weights       = models.JSONField(default=dict, blank=True)
    security_settings = models.JSONField(default=default_security_settings, blank=True)
    custom_questions  = models.JSONField(default=list, blank=True)
    recruiter         = models.ForeignKey(User, on_delete=models.CASCADE, related_name="job_postings", null=True, blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    is_active         = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.title} @ {self.company}"

    def to_interview_dict(self):
        return {
            "title":            self.title,
            "company":          self.company,
            "required_skills":  self.required_skills,
            "nice_to_have":     self.nice_to_have,
            "experience":       self.experience,
            "responsibilities": self.responsibilities,
        }


class Application(models.Model):
    """Candidate applies to a job."""
    STATUS_CHOICES = [
        ("pending",       "Pending ATS"),
        ("ats_failed",    "ATS Failed"),
        ("ats_passed",    "ATS Passed"),
        ("interview_scheduled", "Interview Scheduled"),
        ("interview_done","Interview Done"),
        ("hired",         "Hired"),
        ("rejected",      "Rejected"),
    ]

    job             = models.ForeignKey(JobPosting, on_delete=models.CASCADE, related_name="applications")
    user            = models.ForeignKey(User, on_delete=models.CASCADE, related_name="applications", null=True, blank=True)
    candidate_name  = models.CharField(max_length=200)
    candidate_email = models.EmailField()
    resume_file     = models.FileField(upload_to="resumes/")
    candidate_image = models.ImageField(upload_to="candidate_images/", null=True, blank=True)
    resume_text     = models.TextField(blank=True)
    status          = models.CharField(max_length=30, choices=STATUS_CHOICES, default="pending")

    # ATS results
    ats_score       = models.FloatField(null=True, blank=True)
    ats_breakdown   = models.JSONField(null=True, blank=True)
    ats_feedback    = models.TextField(blank=True)

    # Interview
    interview_thread_id = models.CharField(max_length=100, blank=True)
    interview_report    = models.TextField(blank=True)
    interview_rating    = models.CharField(max_length=50, blank=True)
    interview_percentage = models.FloatField(null=True, blank=True)
    interview_recommendation = models.CharField(max_length=100, blank=True)
    
    # Communication and human expression analytics
    interview_speaking_fluency = models.FloatField(null=True, blank=True)
    interview_vocab_level      = models.CharField(max_length=50, blank=True)
    interview_filler_ratio     = models.FloatField(null=True, blank=True)
    interview_analytics        = models.JSONField(default=dict, blank=True)

    applied_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Face Security Verification
    is_verified          = models.BooleanField(default=False)
    verification_score   = models.FloatField(null=True, blank=True)
    verification_attempts = models.IntegerField(default=0)
    security_warnings     = models.IntegerField(default=0)
    is_disqualified      = models.BooleanField(default=False)
    security_log         = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f"{self.candidate_name} → {self.job.title}"


class ResumeAnalysis(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="resume_analyses")
    resume_file = models.FileField(upload_to="student_resumes/")
    fixed_resume_file = models.FileField(upload_to="student_resumes/fixed/", null=True, blank=True)
    resume_text = models.TextField(blank=True)
    target_role = models.CharField(max_length=200, blank=True)
    target_jd = models.TextField(blank=True)
    
    overall_score = models.FloatField(default=0.0)
    formatting_score = models.FloatField(default=0.0)
    font_score = models.FloatField(default=0.0)
    content_score = models.FloatField(default=0.0)
    grammar_score = models.FloatField(default=0.0)
    word_choice_score = models.FloatField(default=0.0)
    
    feedback_details = models.JSONField(default=dict, blank=True)
    fixed_resume_json = models.JSONField(default=dict, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.target_role or 'General Audit'} ({self.created_at.strftime('%Y-%m-%d')})"


class InterviewPassport(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='passport')
    verified_application = models.ForeignKey(Application, on_delete=models.SET_NULL, null=True, blank=True)
    average_score = models.FloatField(default=0.0)
    verified_skills = models.JSONField(default=list, blank=True)  # ["Python", "React", "SQL"]
    highlight_reels = models.JSONField(default=list, blank=True)   # [{"question": "...", "video_url": "..."}]
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s Interview Passport (Score: {self.average_score}%)"


class InterviewFeedback(models.Model):
    application = models.OneToOneField(Application, on_delete=models.CASCADE, related_name='growth_feedback')
    weaknesses = models.JSONField(default=list, blank=True)        # [{"concept": "SQL Locks", "feedback": "...", "study_query": "Database transactions locks"}]
    strengths = models.JSONField(default=list, blank=True)         # ["Solid system architecture overview"]
    study_resources = models.JSONField(default=list, blank=True)   # [{"title": "SQL Indexing Tutorial", "url": "..."}]
    is_shared_with_candidate = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='user_profile')
    full_name = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    location = models.CharField(max_length=150, blank=True)
    bio = models.TextField(blank=True)
    
    # Candidate / Student fields
    college_name = models.CharField(max_length=200, blank=True)
    degree = models.CharField(max_length=150, blank=True)
    education_level = models.CharField(max_length=100, blank=True, default="Undergraduate")
    graduation_year = models.CharField(max_length=20, blank=True)
    skills = models.JSONField(default=list, blank=True)
    interests = models.JSONField(default=list, blank=True)
    projects = models.JSONField(default=list, blank=True)
    experience = models.JSONField(default=list, blank=True)
    
    # Recruiter fields
    company_name = models.CharField(max_length=200, blank=True)
    designation = models.CharField(max_length=150, blank=True)
    company_website = models.CharField(max_length=250, blank=True)
    hiring_focus = models.CharField(max_length=250, blank=True)
    
    # Avatar / Profile Picture
    profile_image = models.TextField(blank=True, default="")

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"UserProfile({self.user.username})"


class OTPVerification(models.Model):
    """Stores OTP codes for email/login verification with a 45-second expiration timer."""
    identifier = models.CharField(max_length=254, db_index=True)
    otp_code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_verified = models.BooleanField(default=False)

    def is_valid(self):
        from django.utils import timezone
        return not self.is_verified and timezone.now() <= self.expires_at

    def __str__(self):
        return f"OTP for {self.identifier} (Expires: {self.expires_at})"




