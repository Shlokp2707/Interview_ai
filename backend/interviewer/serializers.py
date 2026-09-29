from rest_framework import serializers
from django.contrib.auth.models import User
from .models import JobPosting, Application, ResumeAnalysis, UserProfile

class UserSerializer(serializers.ModelSerializer):
    is_recruiter = serializers.BooleanField(source='is_staff', read_only=True)
    full_name = serializers.SerializerMethodField()
    profile_image = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'is_recruiter', 'role', 'full_name', 'profile_image']

    def get_full_name(self, obj):
        try:
            if hasattr(obj, 'profile') and obj.profile.full_name:
                return obj.profile.full_name
        except Exception:
            pass
        name = f"{obj.first_name} {obj.last_name}".strip()
        return name if name else obj.username

    def get_profile_image(self, obj):
        try:
            if hasattr(obj, 'profile') and obj.profile.profile_image:
                return obj.profile.profile_image
        except Exception:
            pass
        return None

    def get_role(self, obj):
        return "recruiter" if obj.is_staff else "candidate"


class JobPostingSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobPosting
        fields = [
            'id', 'title', 'company', 'description', 'required_skills',
            'nice_to_have', 'experience', 'responsibilities',
            'max_questions', 'max_followups', 'ats_threshold', 'ats_weights', 'security_settings', 'custom_questions', 'recruiter', 'created_at', 'is_active'
        ]
        read_only_fields = ['recruiter', 'created_at']


class ApplicationSerializer(serializers.ModelSerializer):
    job_details = JobPostingSerializer(source='job', read_only=True)
    resume_file_url = serializers.SerializerMethodField()
    candidate_image_url = serializers.SerializerMethodField()

    class Meta:
        model = Application
        fields = [
            'id', 'job', 'job_details', 'user', 'candidate_name', 'candidate_email',
            'resume_file', 'resume_file_url', 'candidate_image', 'candidate_image_url',
            'resume_text', 'status', 'ats_score', 'ats_breakdown', 'ats_feedback',
            'interview_thread_id', 'interview_report', 'interview_rating',
            'interview_percentage', 'interview_recommendation', 'interview_speaking_fluency',
            'interview_vocab_level', 'interview_filler_ratio', 'interview_analytics',
            'applied_at', 'updated_at', 'is_verified', 'verification_score',
            'verification_attempts', 'security_warnings', 'is_disqualified', 'security_log'
        ]
        read_only_fields = [
            'user', 'resume_text', 'ats_score', 'ats_breakdown', 'ats_feedback',
            'interview_thread_id', 'interview_report', 'interview_rating',
            'interview_percentage', 'interview_recommendation', 'interview_speaking_fluency',
            'interview_vocab_level', 'interview_filler_ratio', 'interview_analytics',
            'is_verified', 'verification_score', 'verification_attempts',
            'security_warnings', 'is_disqualified', 'security_log'
        ]

    def get_resume_file_url(self, obj):
        if obj.resume_file:
            return obj.resume_file.url
        return None

    def get_candidate_image_url(self, obj):
        if obj.candidate_image:
            return obj.candidate_image.url
        return None


class ResumeAnalysisSerializer(serializers.ModelSerializer):
    resume_file_url = serializers.SerializerMethodField()
    fixed_resume_file_url = serializers.SerializerMethodField()

    class Meta:
        model = ResumeAnalysis
        fields = [
            'id', 'user', 'resume_file', 'resume_file_url', 'fixed_resume_file', 'fixed_resume_file_url',
            'resume_text', 'target_role', 'target_jd', 'overall_score', 'formatting_score',
            'font_score', 'content_score', 'grammar_score', 'word_choice_score',
            'feedback_details', 'fixed_resume_json', 'created_at'
        ]
        read_only_fields = [
            'user', 'resume_text', 'overall_score', 'formatting_score',
            'font_score', 'content_score', 'grammar_score', 'word_choice_score',
            'feedback_details', 'fixed_resume_json', 'created_at', 'fixed_resume_file', 'fixed_resume_file_url'
        ]

    def get_resume_file_url(self, obj):
        if obj.resume_file:
            return obj.resume_file.url
        return None

    def get_fixed_resume_file_url(self, obj):
        if obj.fixed_resume_file:
            return obj.fixed_resume_file.url
        return None
class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = [
            'id', 'full_name', 'phone', 'location', 'bio',
            'college_name', 'degree', 'education_level', 'graduation_year',
            'skills', 'interests', 'projects', 'experience',
            'company_name', 'designation', 'company_website', 'hiring_focus',
            'profile_image', 'updated_at'
        ]


class UserApiKeySerializer(serializers.ModelSerializer):
    masked_key = serializers.SerializerMethodField()

    class Meta:
        from .models import UserApiKey
        model = UserApiKey
        fields = ['id', 'provider', 'provider_name', 'api_base_url', 'selected_model', 'masked_key', 'is_active', 'updated_at']

    def get_masked_key(self, obj):
        from .key_manager import decrypt_key, mask_key
        raw_key = decrypt_key(obj.encrypted_key)
        return mask_key(raw_key)


