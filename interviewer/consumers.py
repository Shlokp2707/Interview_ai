import json
import asyncio
import os
import httpx
import numpy as np
import io
import wave
from django.conf import settings
from channels.generic.websocket import AsyncWebsocketConsumer
from .voice_analyzer import analyze_speaking

GROQ_API_KEY = getattr(settings, "GROQ_API_KEY", None) or os.getenv("GROQ_API_KEY", "")
GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
    """Convert raw PCM int16 bytes to WAV format for Groq API."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)       # int16 = 2 bytes
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


async def transcribe_with_groq(wav_bytes: bytes) -> str:
    """Send WAV audio to Groq Whisper API, return transcript text."""
    if len(wav_bytes) < 1000:
        return ""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GROQ_WHISPER_URL,
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            files={"file": ("audio.wav", wav_bytes, "audio/wav")},
            data={
                "model":    "whisper-large-v3-turbo",
                "language": "en",
            },
        )
        if response.status_code == 200:
            return response.json().get("text", "").strip()
        else:
            print(f"Groq Whisper error {response.status_code}: {response.text}")
            return ""


class TranscriptConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4003)
            return

        self.audio_buffer    = bytearray()
        self.full_transcript = ""
        self.is_recording    = False
        await self.accept()
        await self.send(json.dumps({"type": "ready"}))

    async def disconnect(self, close_code):
        self.audio_buffer    = bytearray()
        self.full_transcript = ""

    async def receive(self, text_data=None, bytes_data=None):

        if bytes_data:
            # Accumulate raw PCM audio
            self.audio_buffer.extend(bytes_data)

            # Send interim update every ~3 seconds of audio
            # 3 sec = 16000 samples * 2 bytes = 96000 bytes
            if len(self.audio_buffer) >= 96000:
                await self.flush_buffer(final=False)

        elif text_data:
            try:
                data = json.loads(text_data)
            except Exception:
                return

            action = data.get("action")

            if action == "stop":
                # Flush whatever is left in buffer
                if self.audio_buffer:
                    await self.flush_buffer(final=True)

                # Send final message with speaking analysis
                analysis = analyze_speaking(self.full_transcript)
                await self.send(json.dumps({
                    "type":       "final",
                    "transcript": self.full_transcript.strip(),
                    "analysis":   analysis,
                }))

                # Reset for next question
                self.audio_buffer    = bytearray()
                self.full_transcript = ""

            elif action == "clear":
                self.audio_buffer    = bytearray()
                self.full_transcript = ""
                await self.send(json.dumps({"type": "cleared"}))

    async def flush_buffer(self, final: bool = False):
        """Transcribe current buffer via Groq and send result to client."""
        if not self.audio_buffer:
            return

        # Grab and clear buffer immediately so audio keeps flowing
        chunk             = bytes(self.audio_buffer)
        self.audio_buffer = bytearray()

        # Must have at least 0.5 seconds of audio (16000 bytes)
        if len(chunk) < 16000:
            return

        # Convert PCM → WAV
        wav_bytes = pcm_to_wav_bytes(chunk)

        # Send to Groq
        try:
            text = await transcribe_with_groq(wav_bytes)
        except Exception as e:
            print(f"Transcription error: {e}")
            await self.send(json.dumps({
                "type":    "error",
                "message": "Transcription failed — check your connection.",
            }))
            return

        if text:
            self.full_transcript += text + " "
            await self.send(json.dumps({
                "type":       "partial_final" if final else "interim",
                "transcript": self.full_transcript.strip(),
                "chunk":      text,
            }))