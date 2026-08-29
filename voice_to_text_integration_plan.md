# Voice-to-Text Integration Plan

This plan outlines the architecture and implementation steps to integrate a real-time streaming audio transcription system (using React, WebSockets, Django Channels, and the Groq Whisper API) into a web application.

---

## 🏗️ System Architecture

```mermaid
graph TD
    User[User Microphone] -->|Capture Audio| React[React Frontend Component]
    React -->|Convert Float32 to Int16 PCM| PCM[PCM Binary Stream]
    PCM -->|WebSocket Send| WS[WebSocket Connection]
    WS -->|Receive bytes| Django[Django Channels Consumer]
    Django -->|Accumulate Buffer| Buffer[(In-Memory Audio Buffer)]
    React -->|Stop Action| StopMsg[{"action": "stop"}]
    StopMsg -->|WebSocket Send| Django
    Django -->|Convert PCM to WAV| WAV[WAV Bytes]
    WAV -->|HTTP POST| Groq[Groq Whisper API]
    Groq -->|Return Transcript| Django
    Django -->|JSON final response| React
```

---

## 1. Frontend Implementation (React)

The frontend captures user microphone audio, downsamples it to a format accepted by transcription models, and streams it in binary chunks over a WebSocket.

### Key Steps:
1. **Initialize WebSocket Connection**:
   Connect to the backend WebSocket route. Keep track of socket connection states (`connected`, `disconnected`, `error`).
2. **Request Microphone Access**:
   Utilize `navigator.mediaDevices.getUserMedia` to fetch a mono audio channel at a `16000` Hz sample rate.
3. **Configure Web Audio Context**:
   - Instantiate `AudioContext` (or `webkitAudioContext`).
   - **Crucial**: Ensure `audioCtx.resume()` is explicitly called if the browser initializes it in a `suspended` state (due to security/autoplay policies).
4. **Create ScriptProcessor Node**:
   - Setup a `ScriptProcessorNode` (with a buffer size like `4096`) to process real-time input samples.
   - Connect the microphone stream source to the processor, and connect the processor to the destination.
5. **Convert & Stream Chunks**:
   - In the `onaudioprocess` callback, grab the Float32 samples from the input buffer.
   - Convert Float32 samples into **Int16 PCM** (multiplying by `32768` and clamping between `-32768` and `32767`).
   - Send the resulting `Int16Array` buffer directly to the WebSocket as binary data.
6. **Terminate Recording**:
   - Disconnect the audio node sources and close the `AudioContext`.
   - Send a control frame (e.g. `{"action": "stop"}`) to notify the server that recording is complete.

---

## 2. Backend Implementation (Django Channels)

The backend exposes a WebSocket consumer that accumulates binary packets, constructs a valid audio file, and coordinates with the transcription API.

### Key Steps:
1. **Define WebSocket Routing**:
   Create a WebSocket pattern pointing to an asynchronous Channels consumer.
2. **Buffer Accumulation**:
   - Maintain an in-memory byte array (`bytearray`) associated with the WebSocket socket channel.
   - In the consumer's `receive` method, detect binary frames and append them directly to the bytearray.
3. **Convert PCM to WAV**:
   When the `"stop"` command is received, package the accumulated PCM bytes into the **WAV format** by prepending a standard 44-byte WAV header:
   ```python
   import io
   import wave

   def pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
       buf = io.BytesIO()
       with wave.open(buf, "wb") as wf:
           wf.setnchannels(1)   # Mono
           wf.setsampwidth(2)   # 16-bit PCM = 2 bytes
           wf.setframerate(sample_rate)
           wf.writeframes(pcm_bytes)
       return buf.getvalue()
   ```
4. **Send to Transcription API (Groq/Whisper)**:
   Post the WAV bytes to the Groq Whisper endpoint using an asynchronous HTTP client (such as `httpx`):
   ```python
   async def transcribe_audio(wav_bytes: bytes, api_key: str) -> str:
       url = "https://api.groq.com/openai/v1/audio/transcriptions"
       headers = {"Authorization": f"Bearer {api_key}"}
       files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
       data = {
           "model": "whisper-large-v3-turbo",
           "language": "en"
       }
       async with httpx.AsyncClient(timeout=30.0) as client:
           response = await client.post(url, headers=headers, files=files, data=data)
           if response.status_code == 200:
               return response.json().get("text", "").strip()
           return ""
   ```
5. **Return Text to Client**:
   Send the transcribed text response back to the client over the WebSocket, then reset the session buffer.

---

## 3. Configuration & Optimization Checklist

- [ ] **Secure Origin requirement**: Ensure the production environment uses HTTPS/WSS. Modern browsers will refuse to initialize microphone capturing APIs over insecure HTTP.
- [ ] **Proxy Configuration**: If you run a development proxy (e.g. Vite dev server proxy), configure it to forward WebSocket connections (e.g., set `ws: true` in your proxy configs) to your backend ASGI host.
- [ ] **Buffer Size Tuning**: A buffer size of `4096` samples in the browser processor provides a good balance between transmission frequency and latency.
- [ ] **Minimum Duration Guard**: Check if the accumulated buffer is longer than `0.5` seconds (at 16kHz, this is at least `16000` bytes) before querying the API, preventing failures on short accidental clicks.
