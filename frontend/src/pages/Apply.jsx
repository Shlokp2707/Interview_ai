import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, File, Image, Check, AlertTriangle, ArrowRight } from 'lucide-react';

function Apply() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitState, setSubmitState] = useState('idle'); // 'idle', 'submitting', 'error'
  const [statusMessage, setStatusMessage] = useState('');
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [resume, setResume] = useState(null);
  const [profilePic, setProfilePic] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/`)
      .then(res => {
        if (!res.ok) throw new Error("Job not found");
        return res.json();
      })
      .then(data => {
        setJob(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [jobId]);

  useEffect(() => {
    fetch('/api/auth/profile/')
      .then(res => res.json())
      .then(data => {
        if (!data.is_recruiter && data.passport) {
          setPassport(data.passport);
        }
      })
      .catch(err => console.error("Error loading profile passport info:", err));
  }, []);

  const handleFileChange = (e, type) => {
    if (usePassport) return;
    const file = e.target.files[0];
    if (!file) return;

    if (type === 'resume') {
      if (file.type !== 'application/pdf') {
        setError("Only PDF files are supported for resume uploading.");
        return;
      }
      setResume(file);
      setError('');
    } else if (type === 'pic') {
      if (!file.type.startsWith('image/')) {
        setError("Only image files are supported for profile verification.");
        return;
      }
      setProfilePic(file);
      setError('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!usePassport && (!name || !email || !resume)) {
      setError("Please fill in your name, email, and upload a valid PDF resume.");
      return;
    }
    if (usePassport && (!name || !email)) {
      setError("Please fill in your name and email.");
      return;
    }

    setSubmitState('submitting');
    setError('');
    
    // Live simulation text loader
    const stages = usePassport ? [
      "Authenticating HireAI Interview Passport...",
      "Mapping pre-verified skills match...",
      "Duplicating verified screening report...",
      "Routing application to recruiter dashboard..."
    ] : [
      "Reading PDF document data...",
      "Extracting resume experience details...",
      "Analyzing required skills match parameters...",
      "Calculating threshold matching score...",
      "Registering candidate profile details...",
      "Generating AI conversational session ID..."
    ];
    let stageIdx = 0;
    setStatusMessage(stages[0]);
    const timer = setInterval(() => {
      if (stageIdx < stages.length - 1) {
        stageIdx++;
        setStatusMessage(stages[stageIdx]);
      }
    }, usePassport ? 700 : 1200);

    const formData = new FormData();
    formData.append("candidate_name", name);
    formData.append("candidate_email", email);
    if (usePassport) {
      formData.append("use_passport", "true");
    } else {
      formData.append("resume", resume);
      if (profilePic) {
        formData.append("candidate_image", profilePic);
      }
    }

    fetch(`/api/jobs/${jobId}/apply/`, {
      method: 'POST',
      body: formData
    })
      .then(res => {
        clearInterval(timer);
        if (!res.ok) {
          return res.json().then(data => { throw new Error(data.error || "Application submission failed") });
        }
        return res.json();
      })
      .then(data => {
        setSubmitState('idle');
        // Redirect to results view which shows if ATS passed or failed
        navigate(`/result/${data.id}`);
      })
      .catch(err => {
        clearInterval(timer);
        setSubmitState('error');
        setError(err.message || "An error occurred during submission. Please try again.");
      });
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <div className="pulse-spinner" style={{ margin: '0 auto' }}>AI</div>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Loading job details...</p>
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <h2>Error Loading Job</h2>
        <p style={{ color: 'var(--text-danger)' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate('/jobs')}>Return to Vacancies</button>
      </div>
    );
  }

  if (submitState === 'submitting') {
    return (
      <div className="container" style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="glass-panel scan-loader" style={{ maxWidth: '450px', width: '100%' }}>
          <div className="pulse-spinner">
            <Upload size={32} />
          </div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
            {usePassport ? "HireAI Quick Apply Active" : "ATS Scanning Active"}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', lineHeight: 1.5 }}>
            {usePassport ? 
              `Submitting your verified passport credentials for the ${job.title} role.` :
              `Our AI engine is currently analyzing your resume against the ${job.title} role requirements.`
            }
          </p>
          <div style={{ padding: '0.6rem 1.2rem', backgroundColor: 'rgba(139, 92, 246, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(139, 92, 246, 0.15)', fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>
            {statusMessage}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="glass-panel" style={{ maxWidth: '600px', width: '100%', padding: '2.5rem', textAlign: 'left' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Apply for Role</h2>
        <h4 style={{ fontSize: '1.05rem', color: 'var(--accent)', fontWeight: 600, margin: '0 0 2rem 0' }}>
          🏢 {job.company} &nbsp;·&nbsp; {job.title}
        </h4>

        {error && (
          <div style={{ padding: '0.8rem', backgroundColor: 'var(--danger-glow)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          
          {passport && (
            <div className="glass-panel" style={{
              padding: '1.25rem',
              border: '1px solid rgba(79, 70, 229, 0.2)',
              background: 'rgba(79, 70, 229, 0.03)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.5rem',
              textAlign: 'left'
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', margin: 0 }}>
                <input
                  type="checkbox"
                  checked={usePassport}
                  onChange={(e) => {
                    setUsePassport(e.target.checked);
                    setError('');
                  }}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
                />
                <div>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.92rem', color: 'var(--text-main)' }}>
                    🛡️ Quick Apply with my HireAI Interview Passport ({Math.round(passport.average_score)}%)
                  </strong>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Bypass the assessment phase using your pre-verified identity scan, resume file, and interview results.
                  </span>
                </div>
              </label>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="cand-name">Candidate Name *</label>
            <input
              type="text"
              id="cand-name"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your full name"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="cand-email">Email Address *</label>
            <input
              type="email"
              id="cand-email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your contact email"
              required
            />
          </div>

          {/* Resume Upload Dropzone */}
          <div className="form-group" style={{ opacity: usePassport ? 0.4 : 1, transition: 'opacity 0.2s' }}>
            <label className="form-label">Upload Resume (PDF only) *</label>
            <label className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', cursor: usePassport ? 'not-allowed' : 'pointer', borderStyle: 'dashed', borderColor: resume ? 'var(--success)' : 'var(--panel-border)' }}>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => handleFileChange(e, 'resume')}
                disabled={usePassport}
                style={{ display: 'none' }}
              />
              <File size={28} style={{ color: resume ? 'var(--success)' : 'var(--text-muted)', marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: resume ? 'var(--success)' : 'var(--text-main)' }}>
                {usePassport ? "Attached from Passport" : (resume ? resume.name : "Select PDF Resume")}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {usePassport ? "Using pre-verified resume file" : "Drag and drop or click to upload"}
              </span>
            </label>
          </div>

          {/* Profile Picture Upload Dropzone */}
          <div className="form-group" style={{ opacity: usePassport ? 0.4 : 1, transition: 'opacity 0.2s' }}>
            <label className="form-label">Profile Verification Image (Recommended for Liveness Checks)</label>
            <label className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', cursor: usePassport ? 'not-allowed' : 'pointer', borderStyle: 'dashed', borderColor: profilePic ? 'var(--success)' : 'var(--panel-border)' }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e, 'pic')}
                disabled={usePassport}
                style={{ display: 'none' }}
              />
              <Image size={28} style={{ color: profilePic ? 'var(--success)' : 'var(--text-muted)', marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: profilePic ? 'var(--success)' : 'var(--text-main)' }}>
                {usePassport ? "Attached from Passport" : (profilePic ? profilePic.name : "Select Profile Picture")}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {usePassport ? "Using pre-verified profile picture" : "Used to verify candidate identity during webcam scan"}
              </span>
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: '2rem' }}
          >
            {usePassport ? "Submit Quick Application" : "Submit Application & Start Scan"} <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default Apply;
