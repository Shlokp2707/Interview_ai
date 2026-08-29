import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';
import { 
  Sparkles, Zap, ShieldCheck, FileText, BarChart3, Users, 
  CheckCircle2, ArrowRight, Lock, Cpu, Award, Brain, 
  LayoutDashboard, Target, ChevronRight, Briefcase, UserCheck, Play, Eye
} from 'lucide-react';

function LandingPage() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState('student'); // 'student' or 'recruiter'

  // Handle scroll to section if triggered from navbar
  useEffect(() => {
    if (location.state?.scrollTo) {
      const el = document.getElementById(location.state.scrollTo);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    }
  }, [location.state]);

  const handleGetStarted = (role) => {
    if (user) {
      if (role === 'recruiter' || user.is_recruiter) {
        navigate('/hr');
      } else {
        navigate('/jobs');
      }
    } else {
      navigate('/register');
    }
  };

  return (
    <div className="container animate-fade-in" style={{ paddingBottom: '6rem' }}>
      
      {/* Hero Section */}
      <header className="hero-section" style={{ padding: '4rem 0 3rem' }}>
        <div className="hero-badge">
          <Sparkles size={14} /> Next-Gen AI Talent Acquisition & Voice Evaluation
        </div>
        <h1 className="hero-title" style={{ fontSize: '3.2rem', lineHeight: '1.15', fontWeight: 800 }}>
          Automated AI Interviews & <br />
          <span style={{ background: 'linear-gradient(135deg, var(--primary), #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Fraud-Proof Screening
          </span>
        </h1>
        <p className="hero-subtitle" style={{ maxWidth: '780px', margin: '0 auto 2.5rem', fontSize: '1.15rem' }}>
          HireAI seamlessly unifies Conversational Voice LLM Interviews, Automated ATS Resume Matching, and Smart Visual Proctoring. Empowering candidates to practice and win, while HR teams cut screening effort by 80%.
        </p>

        <div className="hero-ctas" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <button className="btn btn-primary" onClick={() => handleGetStarted('candidate')} style={{ padding: '0.85rem 2rem', fontSize: '1rem' }}>
            Explore Candidate Suite <Zap size={18} />
          </button>
          <button className="btn btn-secondary" onClick={() => handleGetStarted('recruiter')} style={{ padding: '0.85rem 2rem', fontSize: '1rem' }}>
            Explore Recruiter Portal <Briefcase size={18} />
          </button>
        </div>
      </header>

      {/* Investor Metric Highlights Bar */}
      <div id="investor-highlights" className="glass-panel" style={{ padding: '2rem 1.5rem', marginBottom: '4rem', marginTop: '1rem' }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', textAlign: 'center', marginBottom: '1.25rem' }}>
          Investor Key Performance Metrics & Benchmarks
        </div>
        <div className="stats-breakdown-grid">
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--primary)' }}>10x</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Faster Screening</div>
          </div>
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--accent)' }}>99.8%</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Proctoring Accuracy</div>
          </div>
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--success)' }}>80%</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>HR Time Saved</div>
          </div>
          <div style={{ textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--warning)' }}>100%</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Unbiased AI Evaluation</div>
          </div>
        </div>
      </div>

      {/* Interactive Role Switcher Section */}
      <div style={{ marginBottom: '5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 800, margin: '0 0 0.75rem 0' }}>
            Built for Both Sides of the Hiring Table
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '640px', margin: '0 auto 2rem', fontSize: '1rem' }}>
            Toggle below to discover tailored features engineered specifically for Candidates & Students and HR & Recruiters.
          </p>

          {/* Tab buttons */}
          <div style={{ display: 'inline-flex', background: 'rgba(255, 255, 255, 0.05)', padding: '0.35rem', borderRadius: '999px', border: '1px solid var(--panel-border)', gap: '0.5rem' }}>
            <button
              id="student-features"
              onClick={() => setActiveTab('student')}
              style={{
                padding: '0.65rem 1.75rem',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.95rem',
                transition: 'all 0.3s ease',
                background: activeTab === 'student' ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'transparent',
                color: activeTab === 'student' ? '#ffffff' : 'var(--text-muted)',
                boxShadow: activeTab === 'student' ? '0 4px 15px rgba(139, 92, 246, 0.25)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              🎓 Candidate & Student Suite
            </button>
            <button
              id="recruiter-features"
              onClick={() => setActiveTab('recruiter')}
              style={{
                padding: '0.65rem 1.75rem',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.95rem',
                transition: 'all 0.3s ease',
                background: activeTab === 'recruiter' ? 'linear-gradient(135deg, var(--primary), var(--accent))' : 'transparent',
                color: activeTab === 'recruiter' ? '#ffffff' : 'var(--text-muted)',
                boxShadow: activeTab === 'recruiter' ? '0 4px 15px rgba(139, 92, 246, 0.25)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              👔 Recruiter & HR Suite
            </button>
          </div>
        </div>

        {/* Tab Content 1: Candidate / Student */}
        {activeTab === 'student' && (
          <div className="features-grid animate-fade-in" style={{ marginTop: '0' }}>
            {/* Feature 1 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(139, 92, 246, 0.12)', color: 'var(--primary)' }}>
                <Zap size={26} />
              </div>
              <h3>AI Practice Room ⚡</h3>
              <p>
                Simulate real-time voice interviews powered by dynamic speech evaluation. Practice answering technical and behavioral questions while receiving instant feedback on speech speed, filler word usage, and technical depth.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => navigate('/practice')}>
                Launch Practice Room <ArrowRight size={14} />
              </div>
            </div>

            {/* Feature 2 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' }}>
                <Target size={26} />
              </div>
              <h3>ATS Scorer & Resume Editor 🎯</h3>
              <p>
                Upload your resume against target Job Descriptions to get instant ATS match percentages, missing keyword analyses, and actionable fixes. Includes an interactive AI Resume Assistant to reframe bullets.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#3b82f6', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => navigate('/ats-scorer')}>
                Try ATS Scorer <ArrowRight size={14} />
              </div>
            </div>

            {/* Feature 3 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}>
                <ShieldCheck size={26} />
              </div>
              <h3>Proctored Live Evaluation 🛡️</h3>
              <p>
                Complete verified AI interviews with automatic facial tracking, gaze monitoring, and audio integrity checks. Proof of skills guarantees high trust for hiring managers.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontWeight: 600, fontSize: '0.85rem' }}>
                <CheckCircle2 size={14} /> Verified Integrity Included
              </div>
            </div>

            {/* Feature 4 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' }}>
                <FileText size={26} />
              </div>
              <h3>Job Applications & Transcripts 👤</h3>
              <p>
                Track all your submitted applications in one dashboard. Review past interview transcripts, proctoring report logs, performance trends, and shortlisting status in real-time.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => navigate('/jobs')}>
                Browse Open Opportunities <ArrowRight size={14} />
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 2: Recruiter / HR */}
        {activeTab === 'recruiter' && (
          <div className="features-grid animate-fade-in" style={{ marginTop: '0' }}>
            {/* Feature 1 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(79, 70, 229, 0.12)', color: 'var(--primary)' }}>
                <LayoutDashboard size={26} />
              </div>
              <h3>Unified HR Candidate Pipeline 💼</h3>
              <p>
                Review applicant pools sorted automatically by combined score (ATS Match + Conversational AI Interview score). Filter applications instantly by Passed ATS, Disqualified, or Pending.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => handleGetStarted('recruiter')}>
                Open HR Dashboard <ArrowRight size={14} />
              </div>
            </div>

            {/* Feature 2 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#a855f7' }}>
                <UserCheck size={26} />
              </div>
              <h3>Custom Job Posting & ATS Thresholds 🏢</h3>
              <p>
                Create job vacancies with custom required skills, experience levels, custom AI interview question sets, and custom minimum ATS match threshold percentages.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#a855f7', fontWeight: 600, fontSize: '0.85rem' }}>
                <CheckCircle2 size={14} /> Configurable Criteria
              </div>
            </div>

            {/* Feature 3 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444' }}>
                <Eye size={26} />
              </div>
              <h3>Proctor Audit & Anomaly Logs 🛡️</h3>
              <p>
                Access detailed anti-cheating audit trails: face detection status, gaze divergence counts, tab focus loss timestamps, and multi-face alert flags for total integrity.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', fontWeight: 600, fontSize: '0.85rem' }}>
                <Lock size={14} /> Fraud Protection Active
              </div>
            </div>

            {/* Feature 4 */}
            <div className="glass-panel feature-card">
              <div className="feature-icon-wrapper" style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' }}>
                <BarChart3 size={26} />
              </div>
              <h3>Audio Recordings & Transcripts 🎙️</h3>
              <p>
                Listen to complete candidate voice recordings, inspect exact question-by-question speech transcripts, and review AI emotion & confidence metrics before scheduling final rounds.
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#3b82f6', fontWeight: 600, fontSize: '0.85rem' }}>
                <CheckCircle2 size={14} /> Full Audio Archive
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Visual Live System Preview Box */}
      <div className="glass-panel" style={{ padding: '2.5rem', marginBottom: '5rem', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
              Live Platform Demonstration
            </div>
            <h3 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>
              End-to-End Autonomous AI Hiring Engine
            </h3>
          </div>
          <span style={{ padding: '0.35rem 0.85rem', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '0.8rem', fontWeight: 700 }}>
            🟢 Engine Online & Ready
          </span>
        </div>

        <div className="responsive-half-grid">
          {/* Simulated Candidate Video & Voice Interface */}
          <div style={{ background: 'rgba(10, 11, 16, 0.7)', borderRadius: 'var(--radius-md)', padding: '1.5rem', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Play size={14} style={{ color: 'var(--primary)' }} /> AI Interview Room (Candidate View)
              </span>
              <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>LIVE PROCTORING</span>
            </div>

            <div style={{ height: '140px', background: '#090a0f', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge-live">RECORDING</span>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>STT Active | 16kHz PCM</span>
              </div>
              <div style={{ display: 'flex', gap: '4px', height: '24px', alignItems: 'center' }}>
                <span style={{ width: '4px', height: '12px', background: 'var(--primary)', borderRadius: '2px' }}></span>
                <span style={{ width: '4px', height: '22px', background: 'var(--accent)', borderRadius: '2px' }}></span>
                <span style={{ width: '4px', height: '18px', background: 'var(--primary)', borderRadius: '2px' }}></span>
                <span style={{ width: '4px', height: '8px', background: 'var(--accent)', borderRadius: '2px' }}></span>
                <span style={{ width: '4px', height: '20px', background: 'var(--primary)', borderRadius: '2px' }}></span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI Question: "Explain your experience with microservices architecture."</span>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              💬 <strong>Live Voice Stream:</strong> "I built REST services using Django and integrated asynchronous task queues..."
            </div>
          </div>

          {/* Simulated Recruiter Assessment Dashboard */}
          <div style={{ background: 'rgba(10, 11, 16, 0.7)', borderRadius: 'var(--radius-md)', padding: '1.5rem', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <BarChart3 size={14} style={{ color: 'var(--accent)' }} /> Candidate Analytics (HR View)
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 700 }}>RECOMMENDED PASS</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', textCenter: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ATS MATCH</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#10b981' }}>92%</div>
              </div>
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', textCenter: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>VOICE SCORE</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)' }}>88%</div>
              </div>
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', textCenter: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>PROCTOR INTEGRITY</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#3b82f6' }}>100%</div>
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              ⚡ <strong>AI Summary:</strong> High confidence rating. Strong match in Python, Django, and System Architecture. Zero proctoring violation alerts.
            </div>
          </div>
        </div>
      </div>

      {/* Technology Stack & Architecture Section */}
      <div style={{ marginBottom: '5rem', textAlign: 'center' }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem' }}>
          Industry Grade Technology Architecture
        </div>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '2.5rem' }}>
          Engineered for Enterprise Scalability
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '1.75rem 1.5rem', textCenter: 'left' }}>
            <Brain size={28} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>LLM Intelligence Engine</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              DeepSeek & Gemini driven parsing algorithms extract entities, calculate TF-IDF keyword weights, and evaluate technical speech context.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '1.75rem 1.5rem', textCenter: 'left' }}>
            <Cpu size={28} style={{ color: 'var(--accent)', marginBottom: '1rem' }} />
            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>WebRTC & WebAudio API</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              Real-time browser speech capture with low-latency PCM downsampling, live spectral frequency rendering, and instant transcript sync.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '1.75rem 1.5rem', textCenter: 'left' }}>
            <Eye size={28} style={{ color: '#10b981', marginBottom: '1rem' }} />
            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>Computer Vision Proctor</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              MediaPipe & FaceMesh powered facial verification, eye-blink frequency counter, head orientation bounds, and tab blur monitoring.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '1.75rem 1.5rem', textCenter: 'left' }}>
            <Lock size={28} style={{ color: '#f59e0b', marginBottom: '1rem' }} />
            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.5rem 0' }}>Django REST Infrastructure</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
              Robust Django backend with SQLite/PostgreSQL, modular API views, token authentication, and encrypted proctoring logs storage.
            </p>
          </div>
        </div>
      </div>

      {/* Call to Action Banner */}
      <div className="glass-panel" style={{ padding: '3.5rem 2rem', textAlign: 'center', background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)', borderRadius: 'var(--radius-lg)' }}>
        <h2 style={{ fontSize: '2.4rem', fontWeight: 800, margin: '0 0 1rem 0' }}>
          Ready to Showcase to Investors & Enterprise Clients?
        </h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '600px', margin: '0 auto 2.5rem', fontSize: '1.05rem' }}>
          Create an account now to test both Candidate AI practice sessions and Recruiter applicant screening.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/register')} style={{ padding: '0.85rem 2.25rem', fontSize: '1rem' }}>
            Get Started Now <ChevronRight size={18} />
          </button>
          {!user && (
            <button className="btn btn-secondary" onClick={() => navigate('/login')} style={{ padding: '0.85rem 2.25rem', fontSize: '1rem' }}>
              Sign In to Account
            </button>
          )}
        </div>
      </div>

    </div>
  );
}

export default LandingPage;
