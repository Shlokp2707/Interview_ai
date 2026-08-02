from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"^ws/transcript/(?P<application_id>\d+)/$", consumers.TranscriptConsumer.as_asgi()),
]