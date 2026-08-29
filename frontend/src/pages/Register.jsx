import React, { useState, useEffect, useRef, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../App';

function Register() {
  const { loginUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('candidate');

  // Optional OTP Email verification step
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [timeLeft, setTimeLeft] = useState(45);
  const [demoCode, setDemoCode] = useState('');
  const [isEmailVerified, setIsEmailVerified] = useState(false);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // 45-second Timer countdown for registration email verification
  useEffect(() => {
    let timer;
    if (otpSent && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [otpSent, timeLeft]);

  // Send 45s OTP verification code to email
  const handleSendEmailOTP = () => {
    if (!email.trim() || !email.includes('@')) {
      setError("Please enter a valid email address first.");
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    fetch('/api/auth/send-otp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email.trim() })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setOtpSent(true);
          setTimeLeft(45);
          if (data.otp_code) setDemoCode(data.otp_code);
          setSuccessMsg("✅ 6-digit code sent! You have 45 seconds to verify your email.");
        } else {
          setError(data.error || "Could not send verification code.");
        }
      })
      .catch(() => setError("Connection error. Could not send code."))
      .finally(() => setLoading(false));
  };

  // Verify registration OTP
  const handleVerifyEmailOTP = () => {
    if (!otpCode || otpCode.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    if (timeLeft <= 0) {
      setError("⏰ Code expired! Your 45-second window passed. Click 'Resend' to get a new code.");
      return;
    }

    setLoading(true);
    setError('');

    fetch('/api/auth/verify-otp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email.trim(), otp_code: otpCode.trim() })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setIsEmailVerified(true);
          setSuccessMsg("🎉 Email verified successfully! Fill password to complete.");
        } else {
          setError(data.error || "Invalid verification code.");
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username || !email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    setLoading(true);
    setError('');

    fetch('/api/auth/register/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, role })
    })
      .then(res => {
        if (!res.ok) {
          return res.json().then(data => { throw new Error(data.error || "Registration failed") });
        }
        return res.json();
      })
      .then(data => {
        if (data.success) {
          loginUser(data.user);
          navigate(data.user.is_recruiter ? '/hr' : '/jobs');
        }
      })
      .catch(err => setError(err.message || "Registration failed. Please try again."))
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
        role: role
      })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          loginUser(data.user);
          navigate(data.user.is_recruiter ? '/hr' : '/jobs');
        } else {
          setError(data.error || 'Google Registration failed.');
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
            text: 'signup_with'
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
  }, [googleClientId, role]);

  // Google OAuth Registration & Sign-Up Handler
  const handleGoogleSignUp = () => {
    if (googleClientId && window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      let targetEmail = email.includes('@') ? email.trim() : '';
      if (!targetEmail) {
        targetEmail = window.prompt("Enter your Google Email Address to Create Account (or add GOOGLE_CLIENT_ID to backend/.env):", "shlokp2406@gmail.com");
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
          role: role
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            loginUser(data.user);
            navigate(data.user.is_recruiter ? '/hr' : '/jobs');
          } else {
            setError(data.error || "Google Registration failed.");
          }
        })
        .catch(() => setError("Server error during Google Authentication."))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="auth-container animate-fade-in">
      <div className="glass-panel auth-card" style={{ maxWidth: '460px', width: '100%' }}>
        <div className="auth-header" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <h2 className="auth-title">Create Free Account</h2>
          <p className="auth-subtitle">Join HireAI in 30 seconds — Simple & Easy</p>
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
            onClick={handleGoogleSignUp}
            className="btn btn-secondary"
            style={{
              width: '100%',
              justify: 'center',
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
            Sign up with Google
          </button>
        )}


        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>OR</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--panel-border)' }} />
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

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">Username *</label>
            <input
              type="text"
              id="username"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Pick your unique username"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email address *</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="email"
                id="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
              {!isEmailVerified && (
                <button
                  type="button"
                  onClick={handleSendEmailOTP}
                  className="btn btn-secondary"
                  disabled={loading || (otpSent && timeLeft > 0)}
                  style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}
                >
                  {otpSent && timeLeft > 0 ? `Verify (${timeLeft}s)` : "Send OTP"}
                </button>
              )}
            </div>
          </div>

          {/* Demo code display for effortless testing */}
          {demoCode && !isEmailVerified && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: '6px', fontSize: '0.8rem', color: '#818cf8', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>💡 Test Code: <strong>{demoCode}</strong></span>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                onClick={() => setOtpCode(demoCode)}
              >
                Fill Code
              </button>
            </div>
          )}

          {/* OTP 45s Verification row */}
          {otpSent && !isEmailVerified && (
            <div style={{ marginBottom: '1.25rem', padding: '0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--panel-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Enter 6-Digit Email Code</span>
                <span style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: timeLeft > 0 ? '#10b981' : '#ef4444'
                }}>
                  {timeLeft > 0 ? `⏳ ${timeLeft}s remaining` : '⏰ Expired'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  maxLength={6}
                  className="form-input"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  style={{ letterSpacing: '0.2em', textAlign: 'center', fontWeight: 700 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleVerifyEmailOTP}
                  disabled={loading || timeLeft <= 0}
                  style={{ fontSize: '0.85rem' }}
                >
                  Verify
                </button>
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password *</label>
            <input
              type="password"
              id="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Account Type:</label>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
              <label className="glass-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', cursor: 'pointer', borderColor: role === 'candidate' ? 'var(--primary)' : 'var(--panel-border)' }}>
                <input
                  type="radio"
                  name="role"
                  value="candidate"
                  checked={role === 'candidate'}
                  onChange={() => setRole('candidate')}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>🎓 Candidate</span>
              </label>

              <label className="glass-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', cursor: 'pointer', borderColor: role === 'recruiter' ? 'var(--primary)' : 'var(--panel-border)' }}>
                <input
                  type="radio"
                  name="role"
                  value="recruiter"
                  checked={role === 'recruiter'}
                  onChange={() => setRole('recruiter')}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>👔 Recruiter</span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: '1.25rem' }}
            disabled={loading}
          >
            {loading ? "Creating Account..." : "Create Account"}
          </button>
        </form>

        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '1.5rem', textAlign: 'center' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: '600' }}>Sign In here</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
