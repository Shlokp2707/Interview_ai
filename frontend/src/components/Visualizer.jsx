import React, { useRef, useEffect } from 'react';

function Visualizer({ stream, active }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);

  useEffect(() => {
    if (active && stream) {
      initAudio();
    } else {
      cleanupAudio();
    }

    return () => {
      cleanupAudio();
    };
  }, [active, stream]);

  const initAudio = () => {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      draw();
    } catch (e) {
      console.warn("Visualizer audio setup failed:", e);
    }
  };

  const cleanupAudio = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    dataArrayRef.current = null;

    // Draw clear state on canvas
    drawClear();
  };

  const drawClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw flat line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  };

  const draw = () => {
    if (!active) return;
    animationRef.current = requestAnimationFrame(draw);

    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (!canvas || !analyser || !dataArray) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const barWidth = (width / dataArray.length) * 1.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      barHeight = (dataArray[i] / 255) * height * 0.8;

      // Draw symmetric bars from center
      const gradient = ctx.createLinearGradient(0, height / 2 - barHeight / 2, 0, height / 2 + barHeight / 2);
      gradient.addColorStop(0, '#c084fc'); // purple accent
      gradient.addColorStop(1, '#8b5cf6'); // primary

      ctx.fillStyle = gradient;
      ctx.fillRect(x, height / 2 - barHeight / 2, barWidth - 2, barHeight);

      x += barWidth;
    }

    // Add subtle divider line in the center
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  };

  return (
    <div style={{ width: '100%', height: '50px', backgroundColor: '#f8fafc', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--panel-border)' }}>
      <canvas
        ref={canvasRef}
        width={300}
        height={50}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

export default Visualizer;
