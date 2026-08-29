import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, RotateCcw } from 'lucide-react';

function AudioStreamer({ applicationId, onTranscriptChange, onFinalTranscript, isSubmitting, disabled }) {
  const [socketStatus, setSocketStatus] = useState('disconnected'); // 'connected', 'disconnected', 'error'
  const [isRecording, setIsRecording] = useState(false);
  const [micLabel, setMicLabel] = useState('Connecting to transcription server...');
  const [analysis, setAnalysis] = useState(null);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const submitAfterTranscriptRef = useRef(false);
  const fullTranscriptRef = useRef("");
  const isMountedRef = useRef(true);
  const isStartingRecordingRef = useRef(false);
  const shouldStopRecordingRef = useRef(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    shouldStopRecordingRef.current = false;
    connectWebSocket();

    return () => {
      isMountedRef.current = false;
      shouldStopRecordingRef.current = true;
      stopRecording();
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [applicationId]);

  useEffect(() => {
    if ((disabled || isSubmitting) && isRecording) {
      stopRecording();
    }
  }, [disabled, isSubmitting, isRecording]);


  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // Proxies to /ws/transcript/<applicationId>/ through vite config
    const wsUrl = `${protocol}//${host}/ws/transcript/${applicationId}/`;

    setSocketStatus('disconnected');
    setMicLabel('Connecting...');

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setSocketStatus('connected');
      setMicLabel('Click the mic button to start recording');
    };

    socket.onclose = () => {
      setSocketStatus('disconnected');
      setMicLabel('Reconnecting...');
      setTimeout(connectWebSocket, 2000);
    };

    socket.onerror = () => {
      setSocketStatus('error');
      setMicLabel('Connection error');
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "interim" || data.type === "partial_final") {
        fullTranscriptRef.current = data.transcript;
        onTranscriptChange(data.transcript);
      } else if (data.type === "final") {
        fullTranscriptRef.current = data.transcript;
        onTranscriptChange(data.transcript);
        setAnalysis(data.analysis);
        onFinalTranscript(data.transcript, data.analysis);

        if (submitAfterTranscriptRef.current) {
          submitAfterTranscriptRef.current = false;
        }
      }
    };
  };

  const startRecording = async () => {
    if (disabled || isSubmitting || socketStatus !== 'connected' || isRecording || isStartingRecordingRef.current) return;

    isStartingRecordingRef.current = true;
    shouldStopRecordingRef.current = false;
    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      if (!isMountedRef.current || shouldStopRecordingRef.current) {
        stream.getTracks().forEach(track => track.stop());
        isStartingRecordingRef.current = false;
        return;
      }

      streamRef.current = stream;
      fullTranscriptRef.current = "";
      onTranscriptChange("");
      setAnalysis(null);

      // Downsample input to 16kHz PCM
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert float32 -> int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }

        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(int16.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Initialize Web Speech API for real-time local transcription (zero delay)
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          const fullResult = Array.from(event.results)
            .map(r => r[0].transcript)
            .join(' ');
            
          fullTranscriptRef.current = fullResult;
          onTranscriptChange(fullResult);
        };

        recognition.onerror = (e) => {
          console.warn("Speech recognition error:", e.error);
        };

        recognition.onend = () => {
          if (shouldStopRecordingRef.current === false && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (err) {}
          }
        };

        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch (err) {
          console.error("Failed to start speech recognition:", err);
        }
      }

      setIsRecording(true);
      setMicLabel('Recording... click stop to finish');
    } catch (err) {
      console.error("Microphone access failed:", err);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (err.name === "NotAllowedError") {
        setMicLabel("Microphone access denied. Please check permissions.");
      } else {
        setMicLabel("Could not access microphone.");
      }
    } finally {
      isStartingRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    shouldStopRecordingRef.current = true;
    setIsRecording(false);

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: "stop" }));
    }

    setMicLabel('Transcribing audio... please wait');
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const clearRecording = () => {
    stopRecording();
    fullTranscriptRef.current = "";
    onTranscriptChange("");
    setAnalysis(null);
    setMicLabel('Click the mic button to start recording');

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: "clear" }));
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
      {/* WS Connection Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', alignSelf: 'flex-start', fontSize: '0.8rem' }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: socketStatus === 'connected' ? '#10b981' : socketStatus === 'disconnected' ? '#f59e0b' : '#ef4444',
          boxShadow: socketStatus === 'connected' ? '0 0 6px #10b981' : 'none'
        }} />
        <span style={{ color: 'var(--text-muted)' }}>
          {socketStatus === 'connected' ? 'Speech Server Connected' : socketStatus === 'disconnected' ? 'Connecting to Speech Server...' : 'Server Connection Error'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Mic toggle button */}
        <button
          onClick={toggleRecording}
          disabled={disabled || isSubmitting || socketStatus !== 'connected'}
          className="btn"
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isRecording ? 'var(--danger)' : 'var(--primary)',
            color: '#fff',
            cursor: (disabled || isSubmitting || socketStatus !== 'connected') ? 'not-allowed' : 'pointer',
            opacity: (disabled || isSubmitting || socketStatus !== 'connected') ? 0.5 : 1,
            transition: 'all 0.2s'
          }}
        >
          {isRecording ? <Square size={24} /> : <Mic size={24} />}
        </button>

        {/* Clear/Reset button */}
        <button
          onClick={clearRecording}
          disabled={disabled || isSubmitting || (!isRecording && !fullTranscriptRef.current)}
          className="btn btn-secondary"
          style={{
            width: '45px',
            height: '45px',
            borderRadius: '50%',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Reset Answer"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <span style={{ fontSize: '0.9rem', color: isRecording ? 'var(--danger)' : 'var(--text-muted)', fontWeight: isRecording ? '600' : '400' }}>
        {micLabel}
      </span>

      {/* Speaking Metrics Feedback */}
      {analysis && (
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-around',
          padding: '0.75rem',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--panel-border)',
          fontSize: '0.85rem'
        }}>
          <div>
            📊 Richness: <strong style={{ color: analysis.ttr > 0.6 ? 'var(--success)' : analysis.ttr > 0.4 ? 'var(--warning)' : 'var(--danger)' }}>
              {Math.round((analysis.ttr || 0) * 100)}%
            </strong>
          </div>
          <div>
            💬 Words: <strong style={{ color: 'var(--text-main)' }}>{analysis.word_count}</strong>
          </div>
          <div>
            🔁 Fillers: <strong style={{ color: analysis.filler_count > 3 ? 'var(--danger)' : 'var(--success)' }}>
              {analysis.filler_count}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}

export default AudioStreamer;
