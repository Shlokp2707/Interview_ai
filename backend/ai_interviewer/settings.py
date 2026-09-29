import os
from pathlib import Path

# Prevent OpenBLAS/OpenMP memory allocation failures in multi-threaded environments on Windows
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

try:
    from dotenv import load_dotenv
    load_dotenv(override=True)
except ImportError:
    pass


BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-change-me")
DEBUG = True
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "daphne",   
    "django.contrib.staticfiles",
    "django.contrib.sessions",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "corsheaders",
    "interviewer",
    "accounts",
    "recruiter",
    "user",
    "channels",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "ai_interviewer.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "ai_interviewer.wsgi.application"

# DATABASES Configuration with SQLite fallback support
USE_SQLITE = os.getenv("USE_SQLITE", "False").lower() in ("true", "1", "yes")

if USE_SQLITE or not os.getenv("DB_ENGINE"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': os.getenv("DB_ENGINE", "django.db.backends.sqlite3").strip("\"'").strip(),
            'NAME': os.getenv("DB_NAME", "interview_db").strip("\"'").strip(),
            'USER': os.getenv("DB_USER", "root").strip("\"'").strip(),
            'PASSWORD': os.getenv("DB_PASSWORD", "").strip("\"'").strip(),
            'HOST': os.getenv("DB_HOST", "127.0.0.1").strip("\"'").strip(),
            'PORT': os.getenv("DB_PORT", "3306").strip("\"'").strip(),
        }
    }
# Channels
ASGI_APPLICATION = "ai_interviewer.asgi.application"

# Use in-memory channel layer for development (no Redis needed)
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}
STATIC_URL = "/static/"
MEDIA_URL  = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

SESSION_ENGINE     = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 86400

GROQ_API_KEY   = os.getenv("GROQ_API_KEY", "").strip("\"'").strip()
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "").strip("\"'").strip()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "").strip("\"'").strip()
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip("\"'").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip("\"'").strip()

EMAIL_BACKEND       = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST          = "smtp.gmail.com"
EMAIL_PORT          = 587
EMAIL_USE_TLS       = True
EMAIL_HOST_USER     = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")

ATS_PASS_THRESHOLD = float(os.getenv("ATS_PASS_THRESHOLD", "40.0"))
ALLOWED_HOSTS = [
    # "172.26.37.244",
    "10.119.182.158",
    "localhost",
    "127.0.0.1",
]
LOGIN_URL = "/login/"

# Django REST Framework Settings
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'interviewer.authentication.CsrfExemptSessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}

# CORS Settings
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]