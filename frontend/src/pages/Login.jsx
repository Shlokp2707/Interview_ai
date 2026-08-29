import React, { useState, useEffect, useRef, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../App';

function Login() {
  const { loginUser } = useContext(AuthContext);
  const navigate = useNavigate();

  // Login Mode: 'password' or 'otp'
  const [loginMode, setLoginMode] = useState('otp'); // default to OTP for instant smooth flow

  // Password Login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // OTP Login state
  const [identifier, setIdentifier] = useState('shlokp2406@gmail.com');
  const [otpStep, setOtpStep] = useState('request'); // 'request' or 'verify'

  // 6 discrete pin box values
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const pinInputRefs = useRef([]);

  const [otpSent, setOtpSent] = useState(false);
  const [timeLeft, setTimeLeft] = useState(45);
  const [demoCode, setDemoCode] = useState('');
  const [lastChannel, setLastChannel] = useState('email');

  // General feedback state
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // 45-second OTP Timer Countdown
  useEffect(() => {
    let timer;
    if (otpSent && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [otpSent, timeLeft]);

  // Handle individual pin box change
  const handlePinChange = (index, value) => {
    const val = value.replace(/\D/g, '');
    if (!val && value !== '') return;

    const newPin = [...pin];
    newPin[index] = val ? val.slice(-1) : '';
    setPin(newPin);

    // Auto-advance to next input box
    if (val && index < 5) {
      pinInputRefs.current[index + 1]?.focus();
    }
  };

  // Handle backspace key in pin box
  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
    }
  };

  // Handle paste into pin boxes
  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData) {
      const newPin = Array(6).fill('');
      for (let i = 0; i < pastedData.length; i++) {
        newPin[i] = pastedData[i];
      }
      setPin(newPin);
      pinInputRefs.current[Math.min(pastedData.length, 5)]?.focus();
    }
  };

  // Send or Resend OTP via selected channel
  const handleSendOTP = (channel = 'email') => {
    if (!identifier.trim()) {
      setError("Please enter your email address or phone number.");
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');
    setLastChannel(channel);

    fetch('/api/auth/send-otp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier.trim(), channel })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setOtpSent(true);
          setOtpStep('verify');
          setTimeLeft(45); // Strict 45-second expiration timer
          if (data.otp_code) {
            setDemoCode(data.otp_code);
          }
          const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : channel === 'call' ? 'Phone Call' : 'Email';
          setSuccessMsg(`✅ 6-digit code sent via ${channelLabel}! You have 45 seconds to verify.`);
        } else {
          setError(data.error || "Could not send verification code. Please try again.");
        }
      })
      .catch(() => setError("Server error while sending code. Please check your connection."))
      .finally(() => setLoading(false));
  };

  // Verify OTP submit
  const handleVerifyOTP = (e) => {
    if (e) e.preventDefault();
    const fullCode = pin.join('');

    if (fullCode.length !== 6) {
      setError("Please enter all 6 digits of your verification code.");
      return;
    }

    if (timeLeft <= 0) {
      setError("⏰ Code expired after 45 seconds! Please tap one of the resend options below.");
      return;
    }

    setLoading(true);
    setError('');

    fetch('/api/auth/verify-otp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier.trim(), otp_code: fullCode })
    })
      .then(res => {
        if (!res.ok) {
          return res.json().then(data => { throw new Error(data.error || "Verification failed.") });
        }
        return res.json();
      })
      .then(data => {
        if (data.success) {
          loginUser(data.user);
          navigate(data.user.is_recruiter ? '/hr' : '/jobs');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  // Fill quick demo code helper
  const handleFillDemoCode = () => {
    if (demoCode && demoCode.length === 6) {
      setPin(demoCode.split(''));
    }
  };

  // Password Submit
  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please fill in both your username and password.");
      return;
    }

    setLoading(true);
    setError('');

    fetch('/api/auth/login/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then(res => {
        if (!res.ok) {
          return res.json().then(data => { throw new Error(data.error || "Incorrect login details.") });
        }
        return res.json();
      })
      .then(data => {
        if (data.success) {
          loginUser(data.user);
          navigate(data.user.is_recruiter ? '/hr' : '/jobs');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  const [googleClientId, setGoogleClientId] = useState('');
  const googleBtnRef = useRef(null);

  useEffect(() => {
    fetch('/api/auth/config/')
      .then((res) => res.json())
      .then((data) => {
        if (data.google_client_id) {
          setGoogleClientId(data.google_client_id);
        }
      })
      .catch(() => { });
  }, []);

  const processGoogleCredential = (credential) => {
    if (!credential) return;
    setLoading(true);
    setError('');

    fetch('/api/auth/google/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: credential,
        role: 'candidate'
      })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          loginUser(data.user);
          navigate(data.user.is_recruiter ? '/hr' : '/jobs');
        } else {
          setError(data.error || 'Google Sign-In failed.');
        }
      })
      .catch(() => setError('Server error during Google Authentication.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!googleClientId) return;

    const initGoogle = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => processGoogleCredential(response.credential)
        });

        if (googleBtnRef.current) {
          googleBtnRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: 'outline',
            size: 'large',
            width: 380,
            text: 'continue_with'
          });
        }
      }
    };

    if (window.google?.accounts?.id) {
      initGoogle();
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          initGoogle();
        }
      }, 300);
      return () => clearInterval(interval);
    }
  }, [googleClientId]);

  // Google OAuth Direct Sign-In Handler
  const handleGoogleSignIn = () => {
    if (googleClientId && window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      let targetEmail = identifier.includes('@') ? identifier.trim() : '';
      if (!targetEmail) {
        targetEmail = window.prompt("Enter your Google Email Address to Sign In (or add GOOGLE_CLIENT_ID to backend/.env):", "shlokp2406@gmail.com");
      }

      if (!targetEmail) return;

      setLoading(true);
      setError('');

      const targetName = targetEmail.split('@')[0];

      fetch('/api/auth/google/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail.trim(),
          name: targetName.charAt(0).toUpperCase() + targetName.slice(1),
          picture: 'https://lh3.googleusercontent.com/a/default-user',
          role: 'candidate'
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            loginUser(data.user);
            navigate(data.user.is_recruiter ? '/hr' : '/jobs');
          } else {
            setError(data.error || "Google Sign-In failed.");
          }
        })
        .catch(() => setError("Server error during Google Authentication."))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="auth-container animate-fade-in">
      <div className="glass-panel auth-card" style={{ maxWidth: '440px', width: '100%', padding: '2rem' }}>

        {/* Header */}
        <div className="auth-header" style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
          <h2 className="auth-title" style={{ fontSize: '1.6rem', fontWeight: 800 }}>Welcome Back</h2>
          <p className="auth-subtitle" style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Simple, fast & secure access to your portal
          </p>
        </div>

        {/* Google OAuth Official Button Container */}
        <div
          ref={googleBtnRef}
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '1.25rem',
            minHeight: googleClientId ? '44px' : '0px'
          }}
        />

        {/* Fallback Google Button if Client ID not rendered yet */}
        {(!googleClientId || !window.google?.accounts?.id) && (
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="btn btn-secondary"
            style={{
              width: '100%',
              justifyContent: 'center',
              marginBottom: '1.25rem',
              padding: '0.7rem',
              fontSize: '0.92rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: 'var(--radius-md)'
            }}
            disabled={loading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Continue with Google
          </button>
        )}


        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>OR</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }} />
        </div>

        {/* Mode Switcher */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: 'rgba(0,0,0,0.03)', padding: '0.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--panel-border)' }}>
          <button
            type="button"
            className="btn"
            onClick={() => { setLoginMode('otp'); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              justifyContent: 'center',
              borderRadius: 'var(--radius-sm)',
              background: loginMode === 'otp' ? 'var(--primary)' : 'transparent',
              color: loginMode === 'otp' ? '#fff' : 'var(--text-muted)'
            }}
          >
            📱 OTP Login
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => { setLoginMode('password'); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              justifyContent: 'center',
              borderRadius: 'var(--radius-sm)',
              background: loginMode === 'password' ? 'var(--primary)' : 'transparent',
              color: loginMode === 'password' ? '#fff' : 'var(--text-muted)'
            }}
          >
            🔑 Password
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.8rem', backgroundColor: 'var(--danger-glow)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', marginBottom: '1.25rem', textAlign: 'left', lineHeight: 1.4 }}>
            ⚠️ {error}
          </div>
        )}

        {successMsg && (
          <div style={{ padding: '0.8rem', backgroundColor: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', marginBottom: '1.25rem', textAlign: 'left', lineHeight: 1.4 }}>
            {successMsg}
          </div>
        )}

        {/* MODE A: OTP LOGIN FLOW */}
        {loginMode === 'otp' ? (
          otpStep === 'request' ? (
            /* STEP 1: ENTER EMAIL / PHONE */
            <div>
              <div className="form-group">
                <label className="form-label">Email or Phone Number</label>
                <input
                  type="text"
                  className="form-input"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. shlokp2406@gmail.com"
                  required
                />
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleSendOTP('email')}
                style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
                disabled={loading}
              >
                {loading ? "Sending OTP..." : "Send 45s Verification OTP"}
              </button>
            </div>
          ) : (
            /* STEP 2: VERIFY OTP SCREEN (MATCHING USER REQUEST EXACTLY) */
            <div className="animate-fade-in" style={{ textAlign: 'center' }}>

              {/* Target Recipient Banner */}
              <div style={{ marginBottom: '1.5rem', background: 'rgba(99, 102, 241, 0.06)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99, 102, 241, 0.15)' }}>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  Enter OTP Sent to
                </p>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {identifier}
                </p>
                <button
                  type="button"
                  onClick={() => setOtpStep('request')}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600, marginTop: '0.35rem', textDecoration: 'underline' }}
                >
                  Change Email / Phone
                </button>
              </div>

              {/* 6 Discrete Box Pin Inputs (Dot placeholders • • • • • • when empty) */}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.25rem' }} onPaste={handlePaste}>
                {pin.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (pinInputRefs.current[idx] = el)}
                    type="text"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handlePinChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    placeholder="•"
                    style={{
                      width: '46px',
                      height: '52px',
                      fontSize: '1.4rem',
                      fontWeight: '800',
                      textAlign: 'center',
                      borderRadius: 'var(--radius-sm)',
                      border: digit ? '2px solid var(--primary)' : '1px solid var(--panel-border)',
                      background: 'var(--panel-bg)',
                      color: 'var(--text-main)',
                      outline: 'none',
                      transition: 'all 0.2s ease'
                    }}
                  />
                ))}
              </div>

              {/* Live 45-Second Expiration Timer Badge */}
              <div style={{ marginBottom: '1.5rem' }}>
                <span style={{
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  padding: '0.3rem 0.8rem',
                  borderRadius: '20px',
                  backgroundColor: timeLeft > 15 ? 'rgba(16, 185, 129, 0.12)' : timeLeft > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  color: timeLeft > 15 ? '#10b981' : timeLeft > 0 ? '#f59e0b' : '#ef4444',
                  display: 'inline-block'
                }}>
                  {timeLeft > 0 ? `⏳ OTP expires in ${timeLeft}s` : '⏰ OTP Expired (45s passed)'}
                </span>
              </div>

              {/* Quick Demo Fill Button */}
              {demoCode && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <button
                    type="button"
                    onClick={handleFillDemoCode}
                    style={{
                      background: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.2)',
                      color: 'var(--primary)',
                      padding: '0.35rem 0.85rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    💡 Auto-Fill Test Code ({demoCode})
                  </button>
                </div>
              )}

              {/* Submit Verification Button */}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleVerifyOTP}
                disabled={loading || pin.join('').length !== 6 || timeLeft <= 0}
                style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', fontSize: '1rem' }}
              >
                {loading ? "Verifying..." : "Verify & Sign In"}
              </button>

              {/* DIDN'T RECEIVE OTP? MULTI-CHANNEL RESEND OPTIONS */}
              <div style={{ marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid var(--panel-border)' }}>
                <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  Didn't receive OTP?
                </p>

                <p style={{ margin: '0 0 0.85rem 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Resend OTP via your preferred channel:
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                  {/* Resend via Email */}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleSendOTP('email')}
                    disabled={loading || timeLeft > 0}
                    style={{ flex: 1, padding: '0.5rem 0.25rem', fontSize: '0.78rem', justifyContent: 'center' }}
                    title="Resend OTP via Email"
                  >
                    ✉️ Email
                  </button>

                  {/* Resend via WhatsApp */}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleSendOTP('whatsapp')}
                    disabled={loading || timeLeft > 0}
                    style={{ flex: 1, padding: '0.5rem 0.25rem', fontSize: '0.78rem', justifyContent: 'center' }}
                    title="Resend OTP via WhatsApp"
                  >
                    💬 WhatsApp
                  </button>

                  {/* Resend via Phone Call */}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleSendOTP('call')}
                    disabled={loading || timeLeft > 0}
                    style={{ flex: 1, padding: '0.5rem 0.25rem', fontSize: '0.78rem', justifyContent: 'center' }}
                    title="Resend OTP via Phone Call"
                  >
                    📞 Call
                  </button>
                </div>

                {timeLeft > 0 && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.65rem' }}>
                    Resend options unlock in {timeLeft} seconds
                  </p>
                )}
              </div>

            </div>
          )
        ) : (
          /* MODE B: STANDARD PASSWORD LOGIN */
          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="username">Username</label>
              <input
                type="text"
                id="username"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '1.5rem', textAlign: 'center' }}>
          Don't have an account? <Link to="/register" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: '700' }}>Register here</Link>
        </p>

      </div>
    </div>
  );
}

export default Login;
