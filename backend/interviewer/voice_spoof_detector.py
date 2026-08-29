import io
import numpy as np
import scipy.io.wavfile as wav
from scipy.signal import find_peaks

def detect_voice_spoofing(wav_bytes: bytes) -> dict:
    """
    Analyzes in-memory WAV audio bytes for AI voice synthesis / vocoder artifacts.
    Evaluates:
      1. Pitch Jitter (micro-stability of fundamental frequency).
      2. Spectral cut-off (energy ratio of high frequencies > 8kHz).
    """
    if not wav_bytes or len(wav_bytes) < 1000:
        return {
            "risk_level": "Low",
            "score": 0.0,
            "metrics": {"pitch_jitter_pct": 0.0, "high_freq_ratio_pct": 0.0},
            "reasons": ["Insufficient audio data to run acoustic scans."]
        }

    try:
        sample_rate, audio_data = wav.read(io.BytesIO(wav_bytes))
        
        # Ensure mono audio channel
        if len(audio_data.shape) > 1:
            audio_data = audio_data[:, 0]
            
        # Convert audio to float32 normalized signal
        max_val = np.max(np.abs(audio_data))
        if max_val == 0:
            return {
                "risk_level": "Low",
                "score": 0.0,
                "metrics": {"pitch_jitter_pct": 0.0, "high_freq_ratio_pct": 0.0},
                "reasons": ["Silent audio frame."]
            }
        audio_data = audio_data.astype(np.float32) / max_val
        
        # 1. Pitch Tracking (using Autocorrelation)
        frame_size = int(sample_rate * 0.03)  # 30ms window
        step_size = int(sample_rate * 0.015)  # 15ms step
        pitches = []
        
        for i in range(0, len(audio_data) - frame_size, step_size):
            frame = audio_data[i:i+frame_size]
            # Skip silent/very quiet frames
            if np.std(frame) < 0.02:
                continue
            
            # Autocorrelation
            corr = np.correlate(frame, frame, mode='full')
            corr = corr[len(corr)//2:]
            
            # Limit peak finding to human vocal frequency range (e.g. 50Hz to 400Hz)
            # 50Hz = sample_rate / 50 samples
            # 400Hz = sample_rate / 400 samples
            min_dist = int(sample_rate / 400)
            max_dist = int(sample_rate / 50)
            
            peaks, _ = find_peaks(corr, distance=min_dist)
            valid_peaks = [p for p in peaks if min_dist <= p <= max_dist]
            
            if len(valid_peaks) > 0:
                pitch_period = valid_peaks[0]
                pitches.append(sample_rate / pitch_period)

        # 2. Calculate Jitter (cycle-to-cycle frequency variations)
        # Human Jitter is naturally > 1.0% due to physiological instability.
        # AI/vocoder voices are mathematically perfect and show very low Jitter (often < 0.5%).
        jitter = 0.0
        if len(pitches) >= 5:
            differences = np.abs(np.diff(pitches))
            avg_pitch = np.mean(pitches)
            if avg_pitch > 0:
                jitter = (np.mean(differences) / avg_pitch) * 100

        # 3. Analyze High-Frequency Spectral Rolloff (> 8kHz cutoff)
        # TTS models/vocoders commonly lack natural room noise / high frequency harmonics above 8kHz.
        fft_vals = np.abs(np.fft.rfft(audio_data))
        freqs = np.fft.rfftfreq(len(audio_data), 1/sample_rate)
        
        energy_high = np.sum(fft_vals[freqs > 8000])
        energy_total = np.sum(fft_vals)
        high_freq_ratio = (energy_high / max(1e-6, energy_total)) * 100

        # 4. Score Classification
        risk_score = 0.0
        reasons = []
        
        # Check for unnatural pitch smoothness (Jitter warning)
        if len(pitches) >= 5:
            if jitter < 0.6:
                risk_score += 45.0
                reasons.append("Unnatural pitch stability (Jitter below 0.6%)")
            elif jitter < 0.9:
                risk_score += 20.0
                reasons.append("Low vocal pitch micro-variance")
        else:
            # Insufficient pitch data (e.g. flat voice synth, whispers, or static)
            risk_score += 15.0
            reasons.append("Flat fundamental frequency profile")
            
        # Check for vocoder/TTS high frequency roll-off cutoff
        if high_freq_ratio < 0.05:
            risk_score += 45.0
            reasons.append("Lack of high-frequency spectral components (vocoder cutoff)")
        elif high_freq_ratio < 0.15:
            risk_score += 20.0
            reasons.append("Reduced high-frequency spectrum signature")

        risk_level = "Low"
        if risk_score >= 65.0:
            risk_level = "High"
        elif risk_score >= 30.0:
            risk_level = "Medium"

        return {
            "risk_level": risk_level,
            "score": round(risk_score, 1),
            "metrics": {
                "pitch_jitter_pct": round(jitter, 3),
                "high_freq_ratio_pct": round(high_freq_ratio, 3)
            },
            "reasons": reasons
        }
    except Exception as e:
        print(f"[SpoofDetector] Analysis error: {e}")
        return {
            "risk_level": "Low",
            "score": 0.0,
            "metrics": {"pitch_jitter_pct": 0.0, "high_freq_ratio_pct": 0.0},
            "reasons": [f"Integrity check skipped due to analysis error: {str(e)}"]
        }
