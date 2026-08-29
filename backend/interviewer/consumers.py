import json
import asyncio
import os
import httpx
import numpy as np
import io
import wave
from django.conf import settings
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
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
    key_preview = f"{GROQ_API_KEY[:8]}...{GROQ_API_KEY[-4:]}" if len(GROQ_API_KEY) > 12 else "INVALID/EMPTY"
    print(f"[debug] transcribe_with_groq called with key: {key_preview} (length={len(GROQ_API_KEY)})")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            GROQ_WHISPER_URL,
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            files={"file": ("audio.wav", wav_bytes, "audio/wav")},
            data={
                "model":    "whisper-large-v3-turbo",
                "language": "en",
                "prompt":   "Technical AI interview context. Candidate names, terms: Shlok, Groq, LangGraph, Python, Django, React, JavaScript, HTML, CSS, SQL, SQLite.",
            },
        )
        if response.status_code == 200:
            return response.json().get("text", "").strip()
        else:
            print(f"Groq Whisper error {response.status_code}: {response.text}")
            return ""


@database_sync_to_async
def save_voice_spoof_result(application_id, result):
    from .models import Application
    try:
        app = Application.objects.get(id=application_id)
        analytics = app.interview_analytics or {}
        
        # Keep track of history
        voice_history = analytics.get("voice_spoof_history", [])
        voice_history.append(result)
        analytics["voice_spoof_history"] = voice_history
        
        # Calculate overall status
        risk_levels = [r.get("risk_level", "Low") for r in voice_history]
        scores = [r.get("score", 0.0) for r in voice_history]
        
        if "High" in risk_levels:
            agg_risk = "High"
        elif "Medium" in risk_levels:
            agg_risk = "Medium"
        else:
            agg_risk = "Low"
            
        avg_score = sum(scores) / len(scores) if scores else 0.0
        
        # Extract unique reasons
        all_reasons = []
        for r in voice_history:
            for reason in r.get("reasons", []):
                if reason not in all_reasons:
                    all_reasons.append(reason)
                    
        analytics["voice_spoof_summary"] = {
            "risk_level": agg_risk,
            "average_score": round(avg_score, 1),
            "flagged_reasons": all_reasons,
            "total_checks": len(voice_history)
        }
        
        app.interview_analytics = analytics
        app.save(update_fields=["interview_analytics"])
    except Exception as e:
        print(f"[SpoofDetector DB Sync] Error updating application {application_id}: {e}")


class TranscriptConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4003)
            return

        self.audio_buffer    = bytearray()
        self.full_transcript = ""
        self.last_transcribed_len = 0
        self.last_spoof_result = None
        self.is_recording    = False
        await self.accept()
        await self.send(json.dumps({"type": "ready"}))

    async def disconnect(self, close_code):
        if self.audio_buffer:
            try:
                await self.flush_buffer(final=True)
            except Exception as e:
                print(f"[TranscriptConsumer] Disconnect flush error: {e}")
        self.audio_buffer    = bytearray()
        self.full_transcript = ""
        self.last_transcribed_len = 0
        self.last_spoof_result = None

    async def receive(self, text_data=None, bytes_data=None):

        if bytes_data:
            # Accumulate raw PCM audio
            self.audio_buffer.extend(bytes_data)

            pass

        elif text_data:
            try:
                data = json.loads(text_data)
            except Exception:
                return

            action = data.get("action")

            if action == "stop":
                self.last_spoof_result = None
                # Flush whatever is left in buffer
                if self.audio_buffer:
                    await self.flush_buffer(final=True)

                # Send final message with speaking analysis
                analysis = analyze_speaking(self.full_transcript)
                await self.send(json.dumps({
                    "type":       "final",
                    "transcript": self.full_transcript.strip(),
                    "analysis":   analysis,
                    "voice_spoof": self.last_spoof_result,
                }))

                # Reset for next question
                self.audio_buffer    = bytearray()
                self.full_transcript = ""
                self.last_transcribed_len = 0
                self.last_spoof_result = None

            elif action == "clear":
                self.audio_buffer    = bytearray()
                self.full_transcript = ""
                self.last_transcribed_len = 0
                self.last_spoof_result = None
                await self.send(json.dumps({"type": "cleared"}))

    async def flush_buffer(self, final: bool = False):
        """Transcribe current buffer via Groq and send result to client."""
        if not self.audio_buffer:
            return

        # Keep the full buffer to preserve complete audio context, only clear on final
        chunk = bytes(self.audio_buffer)
        if final:
            self.audio_buffer = bytearray()
            self.last_transcribed_len = 0

        # Must have at least 0.5 seconds of audio (16000 bytes)
        if len(chunk) < 16000:
            return

        # Convert PCM → WAV
        wav_bytes = pcm_to_wav_bytes(chunk)

        # Run voice spoofing check on the final audio WAV bytes
        if final:
            is_mock_practice = False
            try:
                from channels.db import database_sync_to_async
                from .models import Application
                @database_sync_to_async
                def check_mock(app_id):
                    return Application.objects.filter(id=app_id, job__company="Mock Practice Room").exists()
                application_id = self.scope["url_route"]["kwargs"]["application_id"]
                is_mock_practice = await check_mock(application_id)
            except Exception:
                pass

            if not is_mock_practice:
                from .voice_spoof_detector import detect_voice_spoofing
                try:
                    self.last_spoof_result = await asyncio.to_thread(detect_voice_spoofing, wav_bytes)
                    application_id = self.scope["url_route"]["kwargs"]["application_id"]
                    await save_voice_spoof_result(application_id, self.last_spoof_result)
                except Exception as ex:
                    print(f"[TranscriptConsumer] Voice spoofing check error: {ex}")
                    self.last_spoof_result = None

        # Send to Groq
        try:
            text = await transcribe_with_groq(wav_bytes)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Transcription error: {e}")
            try:
                await self.send(json.dumps({
                    "type":    "error",
                    "message": "Transcription failed — check your connection.",
                }))
            except Exception:
                pass
            return

        if text:
            # Overwrite since chunk contains the entire recording from start
            self.full_transcript = text
            try:
                await self.send(json.dumps({
                    "type":       "partial_final" if final else "interim",
                    "transcript": self.full_transcript.strip(),
                    "chunk":      text,
                }))
            except Exception:
                pass