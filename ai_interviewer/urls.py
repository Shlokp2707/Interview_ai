from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path("", include("user.urls")),
    path("", include("accounts.urls")),
    path("hr/", include("recruiter.urls")),
    path("", include("interviewer.urls")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
