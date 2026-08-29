import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

const WebcamMonitor = forwardRef(({ active, onFrameCaptured, enableAutoCapture = true }, ref) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const [error, setError] = useState(null);

  const isMountedRef = useRef(true);
  const shouldStopCameraRef = useRef(false);

  useImperativeHandle(ref, () => ({
    capture: () => {
      captureFrame();
    }
  }));

  useEffect(() => {
    isMountedRef.current = true;
    shouldStopCameraRef.current = false;
    if (active) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      isMountedRef.current = false;
      shouldStopCameraRef.current = true;
      stopCamera();
    };
  }, [active]);

  const startCamera = async () => {
    shouldStopCameraRef.current = false;
    let stream = null;
    try {
      setError(null);
      const constraints = {
        video: { width: 640, height: 480 },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!isMountedRef.current || !active || shouldStopCameraRef.current) {
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Start frame capture loop (every 5 seconds) if auto-capture is enabled
      if (enableAutoCapture) {
        intervalRef.current = setInterval(captureFrame, 5000);
      }
    } catch (err) {
      console.error("Camera access failed:", err);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      setError("Webcam access denied. Please allow camera permissions to start the interview.");
    }
  };

  const stopCamera = () => {
    shouldStopCameraRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !streamRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // 60% quality compression
      // Extract clean base64 data without prefix (matching django view expect)
      const base64Str = dataUrl.split(',')[1];
      if (onFrameCaptured) {
        onFrameCaptured(base64Str);
      }
    }
  };

  return (
    <div className="video-container" style={{ width: '100%', height: '100%', minHeight: '260px' }}>
      {error ? (
        <div style={{ padding: '2rem', color: 'var(--danger)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          {error}
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="webcam-feed"
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
          />
          <div className="video-overlay">
            <div className="video-badge badge-live">
              CAMERA ACTIVE
            </div>
          </div>
        </>
      )}
    </div>
  );
});

export default WebcamMonitor;
