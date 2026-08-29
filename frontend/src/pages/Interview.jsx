import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WebcamMonitor from '../components/WebcamMonitor';
import AudioStreamer from '../components/AudioStreamer';
import Visualizer from '../components/Visualizer';
import { Shield, ShieldAlert, Award, Volume2, VolumeX, SkipForward, ArrowRight, CheckSquare, Maximize } from 'lucide-react';

function Interview() {
  const { applicationId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // App parameters
  const [app, setApp] = useState(null);
  const isMockPractice = app?.job_details?.company === "Mock Practice Room";
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [isDisqualified, setIsDisqualified] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  
  // Interview flow state
  const [interviewState, setInterviewState] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [vocabAnalysis, setVocabAnalysis] = useState(null);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState('');

  // Proctor variables
  const [warningsCount, setWarningsCount] = useState(0);
  const [livenessStatus, setLivenessStatus] = useState('Liveness Verified');
  const [blinksCount, setBlinksCount] = useState(0);
  const [proctorStatus, setProctorStatus] = useState('Secure'); // 'Secure', 'Warning'
  const [proctorLog, setProctorLog] = useState([]);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [rulesAgree, setRulesAgree] = useState(false);
  const [webcamVerifying, setWebcamVerifying] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState('AI Security Engine Initialized. Ready to verify.');
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [emotion, setEmotion] = useState('neutral');
  const [pitch, setPitch] = useState(0.0);
  const [yaw, setYaw] = useState(0.0);
  const [emotionDurations, setEmotionDurations] = useState({ happy: 0, sad: 0, neutral: 0 });
  const [emotionCounts, setEmotionCounts] = useState({ happy: 0, sad: 0, neutral: 0 });
  const [timeLeft, setTimeLeft] = useState(120);

  // Flags for proctor check-ins
  const flagTabSwitching = useRef(false);
  const flagFullscreenExit = useRef(false);
  const webcamStreamRef = useRef(null);
  const proctorCheckingRef = useRef(false);
  const verificationWebcamRef = useRef(null);
  const securitySettingsRef = useRef({
    looking_away: true,
    fullscreen: true,
    tab_switching: true,
    multiple_faces: true,
    liveness: true,
    blink_detection: true,
  });

  // Load initial state
  useEffect(() => {
    loadInterviewState();
    
    // Tab switching event listener
    const handleVisibilityChange = () => {
      if (securitySettingsRef.current.tab_switching !== false && document.hidden && isStarted && !isDisqualified) {
        flagTabSwitching.current = true;
        setWarningsCount(prev => prev + 1);
        triggerLocalWarning("Security Alert: Tab switching detected!");
      }
    };
    
    // Fullscreen exit listener
    const handleFullscreenChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (securitySettingsRef.current.fullscreen !== false && !isFull && isStarted && !isDisqualified) {
        flagFullscreenExit.current = true;
        setWarningsCount(prev => prev + 1);
        triggerLocalWarning("Security Alert: Fullscreen mode exited!");
      }
    };

    // Prevent cheating keys/copy/paste
    const preventCheating = (e) => {
      e.preventDefault();
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    
    if (isStarted) {
      document.addEventListener("contextmenu", preventCheating);
      document.addEventListener("copy", preventCheating);
      document.addEventListener("cut", preventCheating);
      document.addEventListener("paste", preventCheating);
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("contextmenu", preventCheating);
      document.removeEventListener("copy", preventCheating);
      document.removeEventListener("cut", preventCheating);
      document.removeEventListener("paste", preventCheating);
      document.body.style.userSelect = "auto";
      cancelTTS();
    };
  }, [isStarted, isDisqualified]);

  // Question timer and auto-increment countdown loop
  useEffect(() => {
    if (!isStarted || isDisqualified || submittingAnswer) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          console.log("Time's up! Auto-submitting response...");
          setTimeout(() => {
            // Retrieve current transcript at the time of submission
            submitAnswer(transcript);
          }, 0);
          return 0;
        }

        const nextTime = prev - 1;

        // Silence check: 60s elapsed (reaches 60s remaining), and no words spoken
        if (nextTime === 60 && !transcript.trim()) {
          clearInterval(interval);
          console.log("No speech detected for 60 seconds. Auto-skipping to next question...");
          setTimeout(() => {
            submitAnswer(""); // auto-skip as "did not respond"
          }, 0);
          return 60;
        }

        return nextTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isStarted, isDisqualified, submittingAnswer, transcript, app]);

  // Reset timer whenever a new question is loaded
  useEffect(() => {
    if (interviewState && interviewState.question) {
      setTimeLeft(120);
    }
  }, [interviewState]);


  // TTS helper functions
  const speakQuestion = (text) => {
    if (!ttsEnabled || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    
    // A micro-delay to let the speech synthesis engine clear its queue before speaking
    setTimeout(() => {
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = "en-US";
      utt.rate = 0.95;
      
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const enVoice = voices.find(v => v.lang.startsWith("en-"));
        if (enVoice) {
          utt.voice = enVoice;
        }
      }
      
      window.speechSynthesis.speak(utt);
    }, 50);
  };

  const cancelTTS = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  const loadInterviewState = () => {
    fetch(`/api/interview/${applicationId}/state/`)
      .then(res => {
        if (!res.ok) throw new Error("Could not load state");
        return res.json();
      })
      .then(data => {
        if (data.eligible) {
          setApp(data.application);
          setRulesAccepted(data.rules_accepted);
          setIsVerified(data.application.is_verified);
          setIsDisqualified(data.application.is_disqualified);
          setWarningsCount(data.application.security_warnings);
          setProctorLog(data.application.security_log);
          
          if (data.application?.job_details?.security_settings) {
            securitySettingsRef.current = {
              ...securitySettingsRef.current,
              ...data.application.job_details.security_settings
            };
          }

          if (data.state) {
            setInterviewState(data.state);
          }
          setLoading(false);
          
          // Warm up models
          setVerifyFeedback("AI Security Engine Initializing... Please wait. ⏳");
          fetch(`/api/interview/${applicationId}/preload/`, { method: 'POST' })
            .then(res => res.json())
            .then(resData => {
              if (resData.success) {
                setIsModelLoaded(true);
                setVerifyFeedback("✅ AI Security Engine initialized. Ready to verify.");
              } else {
                setVerifyFeedback("⚠️ AI Security Engine warning: preloading failed. Ready to attempt verification.");
                setIsModelLoaded(true); // allow as fallback
              }
            })
            .catch(() => {
              setVerifyFeedback("⚠️ AI Security Engine offline. Ready to attempt verification.");
              setIsModelLoaded(true); // allow as fallback
            });
        } else {
          setError(data.message || "Unauthorized access to interview room.");
          setLoading(false);
        }
      })
      .catch(err => {
        setError(err.message || "Failed to establish secure interview session.");
        setLoading(false);
      });
  };

  const triggerLocalWarning = (msg) => {
    // Show a floating warning banner
    const banner = document.createElement("div");
    
    if (isMockPractice) {
      banner.style.cssText = "position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%); z-index: 99999; padding: 0.85rem 1.75rem; background: rgba(139, 92, 246, 0.95); color: white; border-radius: 8px; font-weight: 600; box-shadow: 0 4px 20px rgba(139, 92, 246, 0.35); font-family: sans-serif; font-size: 0.92rem; transition: all 0.3s; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);";
      let cleanMsg = msg.replace("Security Alert:", "💡 Practice Tip:").replace("Proctor Violation:", "💡 Practice Tip:").replace("Warnings:", "Tip Counts:");
      banner.innerHTML = `💡 &nbsp; ${cleanMsg}`;
    } else {
      banner.style.cssText = "position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%); z-index: 99999; padding: 0.85rem 1.75rem; background: rgba(239, 68, 68, 0.95); color: white; border-radius: 8px; font-weight: 600; box-shadow: 0 4px 20px rgba(239, 68, 68, 0.35); font-family: sans-serif; font-size: 0.92rem; transition: all 0.3s; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);";
      banner.innerHTML = `⚠️ &nbsp; ${msg}`;
    }
    
    document.body.appendChild(banner);
    setTimeout(() => {
      banner.remove();
    }, 4000);
  };

  const handleStartSession = () => {
    if (!rulesAgree) return;
    
    fetch(`/api/interview/${applicationId}/start/`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setRulesAccepted(true);
        }
      })
      .catch(err => console.error("Error starting session:", err));
  };

  const handleVerifyCapture = (base64Image) => {
    setWebcamVerifying(true);
    setVerifyFeedback("Capturing frame and running DeepFace matching... 🤔");

    fetch(`/api/interview/${applicationId}/verify/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image })
    })
      .then(res => res.json())
      .then(data => {
        setWebcamVerifying(false);
        if (data.success && data.verified) {
          setVerifyFeedback("✅ Face verified successfully! Ready to begin.");
          setIsVerified(true);
        } else {
          if (isMockPractice) {
            setIsVerified(true);
          } else {
            setVerifyFeedback(`❌ verification failed: ${data.message || data.error}`);
          }
        }
      })
      .catch(() => {
        setWebcamVerifying(false);
        if (isMockPractice) {
          setIsVerified(true);
        } else {
          setVerifyFeedback("⚠️ Matching timed out. Please click capture to try again.");
        }
      });
  };

  const enterFullscreenAndBegin = () => {
    const promise = document.documentElement.requestFullscreen();
    if (promise && typeof promise.then === 'function') {
      promise
        .then(() => {
          setIsFullscreen(true);
          setIsStarted(true);
          if (interviewState && interviewState.question) {
            speakQuestion(interviewState.question);
          }
        })
        .catch((err) => {
          console.error("Fullscreen request failed:", err);
          setIsStarted(true);
        });
    } else {
      setIsFullscreen(true);
      setIsStarted(true);
      if (interviewState && interviewState.question) {
        speakQuestion(interviewState.question);
      }
    }
  };

  const handleStartInterview = () => {
    if (securitySettingsRef.current.fullscreen !== false) {
      enterFullscreenAndBegin();
    } else {
      setIsStarted(true);
    }
  };

  // periodic proctor check loop
  const handleProctorCheck = (base64Image) => {
    if (isDisqualified || !isStarted) return;
    if (proctorCheckingRef.current) {
      console.log("Proctor check in progress, skipping frame...");
      return;
    }
    proctorCheckingRef.current = true;

    const currentTabSwitch = flagTabSwitching.current;
    const currentFullscreenExit = flagFullscreenExit.current;
    flagTabSwitching.current = false;
    flagFullscreenExit.current = false;

    fetch(`/api/interview/${applicationId}/proctor/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64Image,
        warnings: {
          tab_switching: currentTabSwitch,
          fullscreen_exit: currentFullscreenExit,
          is_tabbed_out: document.hidden
        },
        question_count: interviewState?.question_count || 0,
        current_question: interviewState?.question || "",
        word_count: transcript ? transcript.trim().split(/\s+/).filter(Boolean).length : 0
      })
    })
      .then(res => res.json())
      .then(data => {
        proctorCheckingRef.current = false;
        if (data.success) {
          setWarningsCount(data.warnings_count);
          setProctorLog(data.security_log);
          setBlinksCount(data.blinks_count);
          setLivenessStatus(data.liveness_status);
          setEmotion(data.emotion || 'neutral');
          setPitch(data.pitch || 0.0);
          setYaw(data.yaw || 0.0);
          if (data.emotion_durations) {
            setEmotionDurations(data.emotion_durations);
          }
          if (data.emotion_counts) {
            setEmotionCounts(data.emotion_counts);
          }

          if (data.violations && data.violations.length > 0) {
            setProctorStatus('Warning');
            triggerLocalWarning(`${data.violations[0]} (Warnings: ${data.warnings_count}/5)`);
          } else {
            setProctorStatus('Secure');
            if (data.notice) {
              triggerLocalWarning(data.notice);
            }
          }

          if (data.is_disqualified) {
            setIsDisqualified(true);
            cancelTTS();
          }
        }
      })
      .catch(err => {
        proctorCheckingRef.current = false;
        console.error("Telemetry failed:", err);
      });
  };

  const submitAnswer = (answerText) => {
    setSubmittingAnswer(true);
    setThinkingMessage("Evaluating your response...");
    cancelTTS();

    fetch(`/api/interview/${applicationId}/submit/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: answerText })
    })
      .then(res => res.json())
      .then(data => {
        if (data.phase === 'finished') {
          navigate(`/result/${app.id}`);
        } else {
          setSubmittingAnswer(false);
          setTranscript('');
          setVocabAnalysis(null);
          setInterviewState(data);
          speakQuestion(data.question);
        }
      })
      .catch((err) => {
        console.error("Submit answer failed:", err);
        setSubmittingAnswer(false);
        triggerLocalWarning("Submit failed. Please try again.");
      });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', color: '#0f172a' }}>
        <div className="pulse-spinner">AI</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <h2>Interview Room Restricted</h2>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate('/profile')}>Return to Applications</button>
      </div>
    );
  }

  // ── 1. SESSION TERMINATED OVERLAY (DISQUALIFIED STATE) ──────────────────────
  if (isDisqualified) {
    return (
      <div className="container animate-fade-in" style={{ padding: '4rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.2)', maxWidth: '560px', background: 'rgba(239, 68, 68, 0.04)' }}>
          <div style={{ fontSize: '4.5rem', marginBottom: '1rem' }}>🚫</div>
          <h2 style={{ color: 'var(--danger)', fontSize: '1.8rem', margin: '0 0 1rem 0' }}>Session Terminated</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '2rem' }}>
            This session has been terminated due to repeated proctoring warnings and security violations detected during the interview. Below is your activity logs checklist:
          </p>
          
          <div style={{ textAlign: 'left', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', padding: '1rem', border: '1px solid rgba(239, 68, 68, 0.15)', maxHeight: '180px', overflowY: 'auto' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#ef4444', fontSize: '0.85rem', fontWeight: 600 }}>Recorded violations checklist:</h4>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {proctorLog.map((log, idx) => (
                <li key={idx}>
                  <strong style={{ color: '#ef4444' }}>[{log.timestamp?.split(" ")[1] || "Log"}]</strong>: {log.violations.join(", ")}
                </li>
              ))}
            </ul>
          </div>

          <button className="btn btn-secondary" onClick={() => navigate('/profile')} style={{ marginTop: '2rem' }}>
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── 2. INITIAL RULES CONSENT STATE ──────────────────────────
  if (!rulesAccepted) {
    return (
      <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="glass-panel" style={{ maxWidth: '600px', width: '100%', padding: '2.5rem', textAlign: 'left' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0 0 1.5rem 0', color: 'var(--text-main)' }}>
            {isMockPractice ? "🎓 Mock Practice Guidelines" : "🛡️ Security Agreement"}
          </h2>
          
          <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
            {isMockPractice ? 
              "Welcome to the practice room! Let's get familiar with how automated interviews work. To help you prepare, we will use supportive coaching alerts instead of strict disqualifications:" :
              "To ensure authentication and fair play, the following active security monitoring will be enforced throughout your session:"
            }
          </p>

          <ul style={{ color: 'var(--text-main)', fontSize: '0.9rem', paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
            {isMockPractice ? (
              <>
                <li><strong>Identity Check Scan:</strong> We'll capture a face match to verify liveness at the start.</li>
                <li><strong>Friendly Coaching:</strong> Shlok will display helpful visual eye-contact tips if you look away.</li>
                <li><strong>Untimed Sandbox:</strong> Take your time to formulate your thoughts without any countdown pressure.</li>
                <li><strong>Zero Penalties:</strong> Fullscreen lock and tab switching checks are disabled so you can focus on practicing.</li>
              </>
            ) : (
              <>
                <li><strong>Liveness Checks:</strong> Profile image checks will verify candidate identity.</li>
                <li><strong>Single Candidate View:</strong> Zero extra faces are allowed in webcam frame.</li>
                <li><strong>Head Pose Tracking:</strong> Candidates must look directly at the screen.</li>
                <li><strong>Locked Fullscreen:</strong> Fullscreen exit or tab switches trigger warning flags.</li>
                <li><strong>Auto-Disqualification:</strong> Session automatically terminates after <strong>5 warning flags</strong>.</li>
              </>
            )}
          </ul>

          <label className="glass-panel" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '1rem', cursor: 'pointer', marginBottom: '2rem' }}>
            <input
              type="checkbox"
              id="rules-agree"
              checked={rulesAgree}
              onChange={(e) => setRulesAgree(e.target.checked)}
              style={{ marginTop: '0.25rem', accentColor: 'var(--primary)' }}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {isMockPractice ? 
                "I understand these practice guidelines and I am ready to start my mock interview." :
                "I understand and agree that my webcam and audio volumes will be monitored. I agree to keep my browser locked in fullscreen."
              }
            </span>
          </label>

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={!rulesAgree}
            onClick={handleStartSession}
          >
            {isMockPractice ? "Start Practice" : "Agree & Proceed"} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── 3. PROFILE WEBCAM IDENTITY VERIFICATION STATE ──────────
  if (!isVerified) {
    return (
      <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="glass-panel" style={{ maxWidth: '480px', width: '100%', padding: '2.5rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>👤 Verification Check</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Position yourself in the center of the frame and click capture.
          </p>

          <div style={{ width: '100%', height: '240px', marginBottom: '1.5rem', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <WebcamMonitor
              ref={verificationWebcamRef}
              active={true}
              enableAutoCapture={false}
              onFrameCaptured={handleVerifyCapture}
            />
          </div>

          <div style={{ padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--panel-border)', fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600, marginBottom: '1.5rem' }}>
            {verifyFeedback}
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={webcamVerifying || !isModelLoaded}
            onClick={() => {
              if (verificationWebcamRef.current) {
                verificationWebcamRef.current.capture();
              }
            }}
          >
            {webcamVerifying ? "Matching..." : !isModelLoaded ? "Loading AI Models..." : "Capture & Verify Face"}
          </button>
        </div>
      </div>
    );
  }

  // ── 4. BEGIN ASSESSMENT PROMPT OR FULLSCREEN OVERLAY ────────
  if (!isStarted) {
    return (
      <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="glass-panel" style={{ maxWidth: '480px', width: '100%', padding: '2.5rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>✅ Face Verified!</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2.5rem' }}>
            Your identity has been authenticated successfully. You are now ready to begin the interview.
          </p>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleStartInterview}>
            {securitySettingsRef.current.fullscreen !== false ? "Enter Fullscreen & Start" : "Begin Interview"} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (securitySettingsRef.current.fullscreen !== false && !isFullscreen) {
    return (
      <div className="fullscreen-blocker animate-fade-in">
        <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🖥️</div>
        <h2>Fullscreen Mode Required</h2>
        <p>
          To maintain proctoring rules, you must run this assessment in fullscreen. Exiting fullscreen mode registers as a warning violation.
        </p>
        <button className="btn btn-primary" onClick={enterFullscreenAndBegin}>
          Enter Fullscreen <Maximize size={16} />
        </button>
      </div>
    );
  }

  // ── 5. ACTIVE INTERVIEW INTERFACE ───────────────────────────
  return (
    <div className="container animate-fade-in" style={{ padding: '2rem 1.5rem' }}>
      
      {/* Upper Status Panel */}
      <div className="glass-panel" style={{ padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
          <Shield size={18} style={{ color: 'var(--success)' }} />
          <span>Secure Assessment Room Active</span>
        </div>

        <button className="btn btn-secondary" onClick={() => setTtsEnabled(!ttsEnabled)} style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>
          {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          {ttsEnabled ? 'Speech ON' : 'Speech OFF'}
        </button>
      </div>

      <div className="interview-grid">
        {/* Left: Chat Card & Recorder */}
        <div className="chat-workspace" style={{ width: '100%' }}>
          {submittingAnswer ? (
            <div className="glass-panel scan-loader" style={{ minHeight: '300px' }}>
              <div className="pulse-spinner">AI</div>
              <h3>{thinkingMessage}</h3>
            </div>
          ) : (
            <>
              {/* Question panel */}
              <div className="glass-panel question-panel" style={{ position: 'relative', overflow: 'hidden', paddingBottom: '2.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="question-header" style={{ margin: 0 }}>
                    Question {interviewState?.question_count} of {app?.job_details?.max_questions}
                  </div>
                  
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.4rem 0.85rem',
                    borderRadius: '20px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    border: '1px solid var(--panel-border)',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    color: timeLeft <= 30 ? '#ef4444' : timeLeft <= 60 ? '#f59e0b' : '#10b981',
                    boxShadow: timeLeft <= 30 ? '0 0 10px rgba(239, 68, 68, 0.2)' : 'none',
                    transition: 'all 0.3s'
                  }}>
                    <span style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: timeLeft <= 30 ? '#ef4444' : timeLeft <= 60 ? '#f59e0b' : '#10b981',
                    }}></span>
                    <span>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
                  </div>
                </div>

                <h2 className="question-text" style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>{interviewState?.question}</h2>

                {timeLeft > 60 && !transcript.trim() && (
                  <div style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '0.75rem' }}>
                    ⚠️ Speak to start response in the next {timeLeft - 60} seconds!
                  </div>
                )}

                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  width: `${(timeLeft / 120) * 100}%`,
                  height: '4px',
                  backgroundColor: timeLeft <= 30 ? '#ef4444' : timeLeft <= 60 ? '#f59e0b' : '#10b981',
                  transition: 'width 1s linear',
                }}></div>
              </div>

              {/* Real-time transcription area */}
              <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'left' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Real-time Answer Transcript:</h4>
                <div className="transcript-area">
                  {transcript ? (
                    <span>{transcript}</span>
                  ) : (
                    <span className="placeholder-text">Your verbal responses will be typed here in real-time as you speak...</span>
                  )}
                </div>
              </div>

              {/* Audio controller & Visualizer */}
              <AudioStreamer
                applicationId={applicationId}
                onTranscriptChange={(text) => setTranscript(text)}
                onFinalTranscript={(text, analysis) => {
                  setTranscript(text);
                  setVocabAnalysis(analysis);
                }}
                disabled={submittingAnswer}
                isSubmitting={submittingAnswer}
              />
            </>
          )}

          {/* Action buttons footer */}
          {!submittingAnswer && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => submitAnswer('')} disabled={submittingAnswer}>
                Skip Question <SkipForward size={16} />
              </button>
              <button
                className="btn btn-primary"
                onClick={() => submitAnswer(transcript)}
                disabled={submittingAnswer || !transcript.trim()}
              >
                Submit Answer <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Right: Camera Telemetry logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ height: '220px', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
            <WebcamMonitor active={isStarted} onFrameCaptured={handleProctorCheck} />
          </div>

          {/* Real-time Telemetry Dashboard */}
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'left' }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 700 }}>
              📊 Proctoring Telemetry
            </h4>
            <div className="form-grid-2" style={{ gap: '0.75rem', fontSize: '0.8rem' }}>
              <div style={{ padding: '0.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem', marginBottom: '2px' }}>Proctor Security</span>
                <strong style={{
                  color: proctorStatus === 'Secure' ? 'var(--success)' : 'var(--warning)',
                  fontSize: '0.85rem'
                }}>{proctorStatus}</strong>
              </div>
              
              {securitySettingsRef.current.liveness !== false && (
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem', marginBottom: '2px' }}>Liveness Status</span>
                  <strong style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>{livenessStatus}</strong>
                </div>
              )}

              {securitySettingsRef.current.blink_detection !== false && (
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                  <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem', marginBottom: '2px' }}>Blinks Detected</span>
                  <strong style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>{blinksCount}</strong>
                </div>
              )}


              <div style={{ padding: '0.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem', marginBottom: '2px' }}>Warnings Flagged</span>
                <strong style={{ color: warningsCount > 0 ? 'var(--danger)' : 'var(--text-main)', fontSize: '0.85rem' }}>
                  {warningsCount} / 5
                </strong>
              </div>

              <div style={{ padding: '0.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem', marginBottom: '2px' }}>Current Emotion</span>
                <strong style={{ color: 'var(--success)', fontSize: '0.85rem', textTransform: 'capitalize' }}>{emotion}</strong>
              </div>

              <div style={{ padding: '0.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem', marginBottom: '2px' }}>Head Pose (P / Y)</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>
                  {pitch}° &nbsp;/&nbsp; {yaw}°
                </strong>
              </div>
            </div>
          </div>

          {/* Real-time Expression Analytics Dashboard */}
          <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'left' }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 700 }}>
              🎭 Real-Time Expression Tracker
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '4px' }}>
                  <span>😊 Happy</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {Math.round(emotionDurations.happy || 0)}s ({emotionCounts.happy || 0} times)
                  </span>
                </div>
                <div style={{ height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, ((emotionDurations.happy || 0) / Math.max(1, (emotionDurations.happy || 0) + (emotionDurations.sad || 0) + (emotionDurations.neutral || 0))) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #10b981, #34d399)',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '4px' }}>
                  <span>😢 Sad</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {Math.round(emotionDurations.sad || 0)}s ({emotionCounts.sad || 0} times)
                  </span>
                </div>
                <div style={{ height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, ((emotionDurations.sad || 0) / Math.max(1, (emotionDurations.happy || 0) + (emotionDurations.sad || 0) + (emotionDurations.neutral || 0))) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #ef4444, #f87171)',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '4px' }}>
                  <span>😐 Neutral</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {Math.round(emotionDurations.neutral || 0)}s ({emotionCounts.neutral || 0} times)
                    </span>
                </div>
                <div style={{ height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, ((emotionDurations.neutral || 0) / Math.max(1, (emotionDurations.happy || 0) + (emotionDurations.sad || 0) + (emotionDurations.neutral || 0))) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #6366f1, #818cf8)',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              </div>
            </div>
          </div>

          {/* Canvas visualizer */}
          <div className="glass-panel" style={{ padding: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'left' }}>Audio Volume Bar</h4>
            <Visualizer stream={webcamStreamRef.current} active={isStarted} />
          </div>

          {/* Proctor live checklist card */}
          {proctorLog.length > 0 && (
            <div className="glass-panel" style={{ padding: '1rem 1.25rem', textAlign: 'left' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--danger)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ShieldAlert size={16} /> Warnings Audit Log ({warningsCount}/5)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                {proctorLog.map((log, idx) => (
                  <div key={idx} style={{ background: 'rgba(239, 68, 68, 0.03)', borderLeft: '2px solid #ef4444', padding: '0.4rem 0.6rem', borderRadius: '0 4px 4px 0', fontSize: '0.75rem', lineHeight: 1.3 }}>
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>[{log.timestamp?.split(" ")[1] || "Log"}]</span> {log.violations.join(", ")}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Interview;
