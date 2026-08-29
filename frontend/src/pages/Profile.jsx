import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  User, Mail, Phone, MapPin, GraduationCap, Building, Briefcase, 
  Code, Award, Plus, Trash2, Save, Sparkles, ExternalLink, 
  CheckCircle2, Globe, FileText, Layers, ArrowRight, Eye,
  Upload, Download, RefreshCw, Zap, Send
} from 'lucide-react';
import { AuthContext } from '../App';

function Profile() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Profile Form State
  const [profile, setProfile] = useState({
    full_name: '',
    phone: '',
    location: '',
    bio: '',
    college_name: '',
    degree: '',
    education_level: 'Undergraduate',
    graduation_year: '',
    skills: [],
    interests: [],
    projects: [],
    experience: [],
    company_name: '',
    designation: '',
    company_website: '',
    hiring_focus: ''
  });

  const [applications, setApplications] = useState([]);
  const [passport, setPassport] = useState(null);
  const [recruiterStats, setRecruiterStats] = useState({ jobs_count: 0, total_applications: 0 });

  // Temp inputs for adding tags / items
  const [newSkill, setNewSkill] = useState('');
  const [newInterest, setNewInterest] = useState('');

  // Project form modal state
  const [projectForm, setProjectForm] = useState({ title: '', tech_stack: '', description: '', link: '' });
  const [showProjectModal, setShowProjectModal] = useState(false);

  // Experience form modal state
  const [expForm, setExpForm] = useState({ company: '', role: '', duration: '', description: '' });
  const [showExpModal, setShowExpModal] = useState(false);

  // Candidate Resume & Instant AI Enhancer State
  const [latestResume, setLatestResume] = useState(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeInstruction, setResumeInstruction] = useState('');
  const [resumeImproving, setResumeImproving] = useState(false);
  const [syncingProfile, setSyncingProfile] = useState(false);

  const fetchResumeHistory = () => {
    fetch('/api/ats/history/')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setLatestResume(data[0]);
        }
      })
      .catch(err => console.error("Error fetching ATS history:", err));
  };

  useEffect(() => {
    fetch('/api/auth/profile/')
      .then(res => res.json())
      .then(data => {
        if (data.profile) {
          setProfile({
            full_name: data.profile.full_name || '',
            phone: data.profile.phone || '',
            location: data.profile.location || '',
            bio: data.profile.bio || '',
            college_name: data.profile.college_name || '',
            degree: data.profile.degree || '',
            education_level: data.profile.education_level || 'Undergraduate',
            graduation_year: data.profile.graduation_year || '',
            skills: data.profile.skills || [],
            interests: data.profile.interests || [],
            projects: data.profile.projects || [],
            experience: data.profile.experience || [],
            company_name: data.profile.company_name || '',
            designation: data.profile.designation || '',
            company_website: data.profile.company_website || '',
            hiring_focus: data.profile.hiring_focus || ''
          });
        }
        if (data.applications) setApplications(data.applications);
        if (data.passport) setPassport(data.passport);
        if (data.is_recruiter) {
          setRecruiterStats({
            jobs_count: data.jobs_count || 0,
            total_applications: data.total_applications || 0
          });
        }
      })
      .catch(err => console.error("Error fetching profile:", err))
      .finally(() => setLoading(false));

    fetchResumeHistory();
  }, []);

  const handleUploadResume = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResumeUploading(true);
    const formData = new FormData();
    formData.append('resume', file);
    formData.append('target_role', profile.interests[0] || 'Software Engineer');

    fetch('/api/ats/analyze/', {
      method: 'POST',
      body: formData
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to analyze resume PDF");
        return res.json();
      })
      .then(data => {
        setResumeUploading(false);
        setLatestResume(data);
        setToastMessage("✓ Resume uploaded & analyzed successfully!");
        setTimeout(() => setToastMessage(''), 4000);
      })
      .catch(err => {
        setResumeUploading(false);
        setToastMessage("❌ Upload failed: " + err.message);
        setTimeout(() => setToastMessage(''), 4000);
      });
  };

  const handleImproveResume = (e, customText = null) => {
    if (e) e.preventDefault();
    const promptText = (customText || resumeInstruction).trim();
    if (!promptText || !latestResume?.id) return;

    setResumeInstruction('');
    setResumeImproving(true);

    fetch(`/api/ats/analysis/${latestResume.id}/chat-fix/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_instruction: promptText })
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to improve resume");
        return res.json();
      })
      .then(data => {
        setResumeImproving(false);
        setLatestResume(data);
        setToastMessage(`✨ Subh AI updated your resume: "${promptText}". Download updated PDF below!`);
        setTimeout(() => setToastMessage(''), 5000);
      })
      .catch(err => {
        setResumeImproving(false);
        setToastMessage("❌ Failed to update resume: " + err.message);
        setTimeout(() => setToastMessage(''), 4000);
      });
  };

  const handleSyncFromResume = () => {
    setSyncingProfile(true);
    fetch('/api/auth/profile-chat/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_instruction: "Sync profile details from my resume" })
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to sync profile");
        return res.json();
      })
      .then(data => {
        setSyncingProfile(false);
        if (data.profile) {
          setProfile(prev => ({
            ...prev,
            full_name: data.profile.full_name || prev.full_name,
            phone: data.profile.phone || prev.phone,
            location: data.profile.location || prev.location,
            bio: data.profile.bio || prev.bio,
            college_name: data.profile.college_name || prev.college_name,
            degree: data.profile.degree || prev.degree,
            skills: data.profile.skills || prev.skills,
            interests: data.profile.interests || prev.interests
          }));
        }
        setToastMessage("🔄 Profile fields synced with your latest resume!");
        setTimeout(() => setToastMessage(''), 4000);
      })
      .catch(err => {
        setSyncingProfile(false);
        setToastMessage("❌ Sync failed: " + err.message);
        setTimeout(() => setToastMessage(''), 4000);
      });
  };

  const handleSaveProfile = (e) => {
    if (e) e.preventDefault();
    setSaving(true);

    fetch('/api/auth/profile/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(profile)
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to update profile");
        return res.json();
      })
      .then(data => {
        setSaving(false);
        if (data.profile) {
          setProfile(prev => ({
            ...prev,
            full_name: data.profile.full_name || '',
            phone: data.profile.phone || '',
            location: data.profile.location || '',
            bio: data.profile.bio || '',
            college_name: data.profile.college_name || '',
            degree: data.profile.degree || '',
            education_level: data.profile.education_level || 'Undergraduate',
            graduation_year: data.profile.graduation_year || '',
            skills: data.profile.skills || [],
            interests: data.profile.interests || [],
            projects: data.profile.projects || [],
            experience: data.profile.experience || [],
            company_name: data.profile.company_name || '',
            designation: data.profile.designation || '',
            company_website: data.profile.company_website || '',
            hiring_focus: data.profile.hiring_focus || ''
          }));
        }
        setToastMessage("✓ Profile saved successfully! Subh AI chatbot now has access to your updated profile.");
        setTimeout(() => setToastMessage(''), 4000);
      })
      .catch(err => {
        setSaving(false);
        setToastMessage("❌ Failed to save profile: " + err.message);
        setTimeout(() => setToastMessage(''), 4000);
      });
  };

  // Skill Add / Remove
  const handleAddSkill = () => {
    if (!newSkill.trim()) return;
    if (!profile.skills.includes(newSkill.trim())) {
      setProfile(prev => ({ ...prev, skills: [...prev.skills, newSkill.trim()] }));
    }
    setNewSkill('');
  };
  const handleRemoveSkill = (skillToRemove) => {
    setProfile(prev => ({ ...prev, skills: prev.skills.filter(s => s !== skillToRemove) }));
  };

  // Interest Add / Remove
  const handleAddInterest = () => {
    if (!newInterest.trim()) return;
    if (!profile.interests.includes(newInterest.trim())) {
      setProfile(prev => ({ ...prev, interests: [...prev.interests, newInterest.trim()] }));
    }
    setNewInterest('');
  };
  const handleRemoveInterest = (interestToRemove) => {
    setProfile(prev => ({ ...prev, interests: prev.interests.filter(i => i !== interestToRemove) }));
  };

  // Project Add / Remove
  const handleAddProject = () => {
    if (!projectForm.title.trim()) return;
    setProfile(prev => ({ ...prev, projects: [...prev.projects, projectForm] }));
    setProjectForm({ title: '', tech_stack: '', description: '', link: '' });
    setShowProjectModal(false);
  };
  const handleRemoveProject = (idx) => {
    setProfile(prev => ({ ...prev, projects: prev.projects.filter((_, i) => i !== idx) }));
  };

  // Experience Add / Remove
  const handleAddExp = () => {
    if (!expForm.company.trim()) return;
    setProfile(prev => ({ ...prev, experience: [...prev.experience, expForm] }));
    setExpForm({ company: '', role: '', duration: '', description: '' });
    setShowExpModal(false);
  };
  const handleRemoveExp = (idx) => {
    setProfile(prev => ({ ...prev, experience: prev.experience.filter((_, i) => i !== idx) }));
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <div className="pulse-spinner" style={{ margin: '0 auto' }}>AI</div>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Fetching user profile & applications...</p>
      </div>
    );
  }

  const isRecruiter = user?.is_recruiter;

  return (
    <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', paddingBottom: '6rem' }}>
      
      {/* Toast Alert */}
      {toastMessage && (
        <div className="glass-panel" style={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          zIndex: 9999,
          padding: '0.85rem 1.5rem',
          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
          color: '#fff',
          fontWeight: 600,
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 25px rgba(79, 70, 229, 0.3)',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          {toastMessage}
        </div>
      )}

      {/* User Header Profile Banner */}
      <div className="glass-panel" style={{ padding: '2.5rem', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--primary), var(--accent), #ec4899)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              fontWeight: 800,
              boxShadow: '0 6px 20px rgba(139, 92, 246, 0.3)'
            }}>
              {(profile.full_name || user?.username || 'U')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0 }}>
                  {profile.full_name || user?.username}
                </h1>
                <span className={`role-pill ${isRecruiter ? 'role-recruiter' : 'role-candidate'}`}>
                  {isRecruiter ? '👔 Recruiter' : '🎓 Candidate'}
                </span>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <span><Mail size={14} style={{ verticalAlign: 'text-bottom' }} /> {user?.email}</span>
                {profile.college_name && (
                  <span><GraduationCap size={14} style={{ verticalAlign: 'text-bottom' }} /> {profile.college_name}</span>
                )}
                {profile.company_name && (
                  <span><Building size={14} style={{ verticalAlign: 'text-bottom' }} /> {profile.company_name}</span>
                )}
              </div>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving} style={{ padding: '0.75rem 1.75rem' }}>
            {saving ? 'Saving...' : <><Save size={16} /> Save Profile Changes</>}
          </button>
        </div>

        {/* Quick Stats overview */}
        <div className="stats-grid" style={{ marginTop: '2rem', marginBottom: 0 }}>
          {isRecruiter ? (
            <>
              <div className="glass-panel stat-card">
                <span className="stat-label">Active Job Postings</span>
                <span className="stat-value">{recruiterStats.jobs_count}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">Total Candidate Applications</span>
                <span className="stat-value">{recruiterStats.total_applications}</span>
              </div>
            </>
          ) : (
            <>
              <div className="glass-panel stat-card">
                <span className="stat-label">Submitted Applications</span>
                <span className="stat-value">{applications.length}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">Verified Skills</span>
                <span className="stat-value">{profile.skills.length}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">Portfolio Projects</span>
                <span className="stat-value">{profile.projects.length}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">Interview Passport Score</span>
                <span className="stat-value" style={{ color: 'var(--accent)' }}>
                  {passport ? `${passport.average_score}%` : 'N/A'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Profile Form Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
        
        {/* Section 1: Basic & Contact Info */}
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <User size={20} style={{ color: 'var(--primary)' }} /> Basic & Contact Details
          </h3>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input 
                type="text" 
                className="form-input"
                value={profile.full_name}
                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                placeholder="e.g. Alex Johnson"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input 
                type="text" 
                className="form-input"
                value={profile.phone}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                placeholder="+1 (555) 019-2834"
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Location / City</label>
              <input 
                type="text" 
                className="form-input"
                value={profile.location}
                onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                placeholder="e.g. San Francisco, CA"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Account Email (Registered)</label>
              <input 
                type="text" 
                className="form-input"
                value={user?.email || ''}
                disabled
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Bio / Career Overview</label>
            <textarea 
              className="form-input"
              rows={3}
              value={profile.bio}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
              placeholder="Brief summary of your professional background, strengths, and goals..."
            />
          </div>
        </div>

        {/* Candidate Resume & Instant AI Enhancer Section */}
        {!isRecruiter && (
          <div className="glass-panel" style={{ padding: '2rem', border: '1px solid rgba(139, 92, 246, 0.35)', boxShadow: '0 12px 35px rgba(79, 70, 229, 0.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <FileText size={22} style={{ color: 'var(--primary)' }} /> My Resume & Instant AI Enhancer ⚡
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                  Upload, view, and instantly enhance your resume with Subh AI. Auto-sync details directly into your profile!
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                  <Upload size={16} />
                  {resumeUploading ? 'Uploading & Analyzing...' : 'Upload New Resume PDF'}
                  <input 
                    type="file" 
                    accept=".pdf" 
                    onChange={handleUploadResume}
                    disabled={resumeUploading}
                    style={{ display: 'none' }}
                  />
                </label>

                {latestResume && (
                  <button 
                    className="btn btn-primary" 
                    onClick={handleSyncFromResume}
                    disabled={syncingProfile}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <RefreshCw size={15} style={{ animation: syncingProfile ? 'spin 1.5s linear infinite' : 'none' }} />
                    {syncingProfile ? 'Syncing...' : '🔄 Sync Details to Profile'}
                  </button>
                )}
              </div>
            </div>

            {latestResume ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Metrics Badges Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                  <div style={{ padding: '1rem', background: 'rgba(79, 70, 229, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(79, 70, 229, 0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Overall ATS Score</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary)', marginTop: '0.2rem' }}>
                      {latestResume.overall_score || 0}%
                    </div>
                  </div>

                  <div style={{ padding: '1rem', background: 'rgba(168, 85, 247, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(168, 85, 247, 0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Formatting Match</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent)', marginTop: '0.2rem' }}>
                      {latestResume.formatting_score || 0}%
                    </div>
                  </div>

                  <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16, 185, 129, 0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Content Depth</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981', marginTop: '0.2rem' }}>
                      {latestResume.content_score || 0}%
                    </div>
                  </div>

                  <div style={{ padding: '1rem', background: 'rgba(59, 130, 246, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(59, 130, 246, 0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Target Role</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {latestResume.target_role || "General Role"}
                    </div>
                  </div>
                </div>

                {/* PDF Download Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--panel-border)' }}>
                  <div style={{ flexGrow: 1 }}>
                    <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>Resume Artifact Files:</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Uploaded on {new Date(latestResume.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  {latestResume.resume_file && (
                    <a 
                      href={latestResume.resume_file} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="btn btn-secondary btn-sm"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <Eye size={14} /> Original PDF
                    </a>
                  )}

                  {(latestResume.fixed_resume_file || latestResume.resume_file) && (
                    <a 
                      href={latestResume.fixed_resume_file || latestResume.resume_file} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="btn btn-primary btn-sm"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <Download size={14} /> Download Enhanced PDF
                    </a>
                  )}
                </div>

                {/* Instant AI Resume Enhancer Prompt & Quick Chips */}
                <div style={{ background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.04), rgba(147, 51, 234, 0.04))', padding: '1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Sparkles size={16} style={{ color: 'var(--accent)' }} /> Instant AI Resume Editor & Rephraser
                  </div>

                  <form onSubmit={handleImproveResume} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={resumeInstruction}
                      onChange={(e) => setResumeInstruction(e.target.value)}
                      placeholder="e.g. 'Rephrase bullet points to emphasize Python, AWS, and system design' or 'Add Docker project'"
                      disabled={resumeImproving}
                      style={{ flexGrow: 1 }}
                    />
                    <button 
                      type="submit" 
                      className="btn btn-primary" 
                      disabled={resumeImproving || !resumeInstruction.trim()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0 1.25rem' }}
                    >
                      {resumeImproving ? (
                        <>
                          <RefreshCw size={15} style={{ animation: 'spin 1.5s linear infinite' }} /> Improving...
                        </>
                      ) : (
                        <>
                          <Zap size={15} /> Enhance Resume
                        </>
                      )}
                    </button>
                  </form>

                  {/* Quick Action Chips */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: '0.25rem' }}>Quick Actions:</span>
                    <button 
                      type="button" 
                      className="subh-chip" 
                      onClick={(e) => handleImproveResume(e, "Auto-fix resume ATS formatting, bullet points, and high-impact keywords")}
                      disabled={resumeImproving}
                    >
                      ⚡ Auto-Fix ATS Formatting
                    </button>
                    <button 
                      type="button" 
                      className="subh-chip" 
                      onClick={(e) => handleImproveResume(e, "Rephrase experience bullet points to quantify metrics and achievements for senior engineering roles")}
                      disabled={resumeImproving}
                    >
                      🎯 Quantify Achievements & Bullets
                    </button>
                    <button 
                      type="button" 
                      className="subh-chip" 
                      onClick={(e) => handleImproveResume(e, "Add Docker, Kubernetes, Microservices, and Cloud Architecture to skills section")}
                      disabled={resumeImproving}
                    >
                      🛠️ Add Cloud & DevOps Skills
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'rgba(0,0,0,0.02)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--panel-border)' }}>
                <FileText size={40} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
                <h4 style={{ margin: '0 0 0.4rem 0', fontWeight: 700 }}>No Resume Uploaded Yet</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '450px', margin: '0 auto 1.25rem auto' }}>
                  Upload your resume PDF to unlock instant AI formatting fixes, ATS keyword enhancement, and automatic profile population!
                </p>
                <label className="btn btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Upload size={16} /> Upload Resume PDF
                  <input 
                    type="file" 
                    accept=".pdf" 
                    onChange={handleUploadResume}
                    disabled={resumeUploading}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* Section 2: Academic & Education Info (for Students/Candidates) OR Company Info (for Recruiters) */}
        {!isRecruiter ? (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <GraduationCap size={20} style={{ color: 'var(--accent)' }} /> Academic & Education Details
            </h3>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">College / University Name</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profile.college_name}
                  onChange={(e) => setProfile({ ...profile, college_name: e.target.value })}
                  placeholder="e.g. Stanford University / IIT Delhi"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Degree & Field of Study</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profile.degree}
                  onChange={(e) => setProfile({ ...profile, degree: e.target.value })}
                  placeholder="e.g. B.Tech Computer Science & Engineering"
                />
              </div>
            </div>

            <div className="form-grid-2" style={{ marginBottom: 0 }}>
              <div className="form-group">
                <label className="form-label">Education Level</label>
                <select 
                  className="form-input"
                  value={profile.education_level}
                  onChange={(e) => setProfile({ ...profile, education_level: e.target.value })}
                >
                  <option value="High School">High School</option>
                  <option value="Undergraduate">Undergraduate (Bachelor's)</option>
                  <option value="Postgraduate">Postgraduate (Master's)</option>
                  <option value="PhD">PhD / Doctorate</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Expected Graduation Year</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profile.graduation_year}
                  onChange={(e) => setProfile({ ...profile, graduation_year: e.target.value })}
                  placeholder="e.g. 2026"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building size={20} style={{ color: 'var(--primary)' }} /> Recruiter & Organization Profile
            </h3>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Company / Organization Name</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profile.company_name}
                  onChange={(e) => setProfile({ ...profile, company_name: e.target.value })}
                  placeholder="e.g. TechCorp Systems"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Job Designation / Role Title</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profile.designation}
                  onChange={(e) => setProfile({ ...profile, designation: e.target.value })}
                  placeholder="e.g. Senior Technical Recruiter"
                />
              </div>
            </div>

            <div className="form-grid-2" style={{ marginBottom: 0 }}>
              <div className="form-group">
                <label className="form-label">Company Website URL</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profile.company_website}
                  onChange={(e) => setProfile({ ...profile, company_website: e.target.value })}
                  placeholder="e.g. https://techcorp.io"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Primary Hiring Focus</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profile.hiring_focus}
                  onChange={(e) => setProfile({ ...profile, hiring_focus: e.target.value })}
                  placeholder="e.g. Full Stack, Backend Engineers, GenAI Specialists"
                />
              </div>
            </div>
          </div>
        )}

        {/* Section 3: Skills & Career Interests (For Candidates) */}
        {!isRecruiter && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Code size={20} style={{ color: '#10b981' }} /> Skills & Career Interests
            </h3>

            {/* Skills Tag Editor */}
            <div style={{ marginBottom: '2rem' }}>
              <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Technical & Professional Skills
              </label>
              
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem' }}>
                <input 
                  type="text" 
                  className="form-input"
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSkill(); } }}
                  placeholder="Add skill (e.g. Python, React, PostgreSQL) and press Enter"
                  style={{ flexGrow: 1 }}
                />
                <button type="button" className="btn btn-secondary" onClick={handleAddSkill}>
                  <Plus size={16} /> Add
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {profile.skills.length === 0 ? (
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No skills added yet.</span>
                ) : (
                  profile.skills.map((skill, idx) => (
                    <span 
                      key={idx} 
                      style={{
                        padding: '0.35rem 0.75rem',
                        borderRadius: '999px',
                        background: 'rgba(16, 185, 129, 0.12)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        color: '#10b981',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      {skill}
                      <span 
                        onClick={() => handleRemoveSkill(skill)}
                        style={{ cursor: 'pointer', opacity: 0.7, fontSize: '0.9rem' }}
                        title="Remove skill"
                      >
                        ×
                      </span>
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Career Interests Tag Editor */}
            <div>
              <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Career Interests & Target Roles
              </label>
              
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem' }}>
                <input 
                  type="text" 
                  className="form-input"
                  value={newInterest}
                  onChange={(e) => setNewInterest(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddInterest(); } }}
                  placeholder="Add interest (e.g. AI Engineering, Cloud DevOps) and press Enter"
                  style={{ flexGrow: 1 }}
                />
                <button type="button" className="btn btn-secondary" onClick={handleAddInterest}>
                  <Plus size={16} /> Add
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {profile.interests.length === 0 ? (
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No interests added yet.</span>
                ) : (
                  profile.interests.map((interest, idx) => (
                    <span 
                      key={idx} 
                      style={{
                        padding: '0.35rem 0.75rem',
                        borderRadius: '999px',
                        background: 'rgba(139, 92, 246, 0.12)',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                        color: 'var(--accent)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      {interest}
                      <span 
                        onClick={() => handleRemoveInterest(interest)}
                        style={{ cursor: 'pointer', opacity: 0.7, fontSize: '0.9rem' }}
                        title="Remove interest"
                      >
                        ×
                      </span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Section 4: Projects Portfolio (For Candidates) */}
        {!isRecruiter && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Layers size={20} style={{ color: '#3b82f6' }} /> Projects Portfolio
              </h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowProjectModal(true)}>
                <Plus size={16} /> Add Project
              </button>
            </div>

            {/* Modal for adding project */}
            {showProjectModal && (
              <div style={{ background: 'rgba(0,0,0,0.04)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--panel-border)', marginBottom: '1.5rem' }}>
                <h4 style={{ margin: '0 0 1rem 0', fontWeight: 700 }}>Add New Project</h4>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Project Title</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={projectForm.title}
                      onChange={(e) => setProjectForm({ ...projectForm, title: e.target.value })}
                      placeholder="e.g. AI Interview Proctoring Suite" 
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tech Stack</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={projectForm.tech_stack}
                      onChange={(e) => setProjectForm({ ...projectForm, tech_stack: e.target.value })}
                      placeholder="e.g. React, Django, OpenCV, WebRTC" 
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea 
                    className="form-input" 
                    rows={2}
                    value={projectForm.description}
                    onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                    placeholder="Key highlights, architecture decisions, and results..." 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Github or Live Demo Link</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={projectForm.link}
                    onChange={(e) => setProjectForm({ ...projectForm, link: e.target.value })}
                    placeholder="https://github.com/..." 
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowProjectModal(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={handleAddProject}>Save Project</button>
                </div>
              </div>
            )}

            {/* List of Projects */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
              {profile.projects.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontStyle: 'italic', gridColumn: '1 / -1' }}>
                  No projects added yet. Click "Add Project" to showcase your work to recruiters and Subh AI!
                </div>
              ) : (
                profile.projects.map((proj, idx) => (
                  <div key={idx} className="glass-panel" style={{ padding: '1.25rem', position: 'relative' }}>
                    <button 
                      onClick={() => handleRemoveProject(idx)}
                      style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                      title="Delete project"
                    >
                      <Trash2 size={16} />
                    </button>
                    <h4 style={{ margin: '0 0 0.25rem 0', fontWeight: 800, fontSize: '1.05rem' }}>{proj.title}</h4>
                    <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', borderRadius: '4px', fontWeight: 600, display: 'inline-block', marginBottom: '0.5rem' }}>
                      {proj.tech_stack}
                    </span>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45, margin: '0 0 0.75rem 0' }}>
                      {proj.description}
                    </p>
                    {proj.link && (
                      <a href={proj.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        View Project <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Section 5: Work Experience (For Candidates) */}
        {!isRecruiter && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Briefcase size={20} style={{ color: '#f59e0b' }} /> Work Experience & Internships
              </h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowExpModal(true)}>
                <Plus size={16} /> Add Experience
              </button>
            </div>

            {/* Modal for adding experience */}
            {showExpModal && (
              <div style={{ background: 'rgba(0,0,0,0.04)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--panel-border)', marginBottom: '1.5rem' }}>
                <h4 style={{ margin: '0 0 1rem 0', fontWeight: 700 }}>Add Work Experience</h4>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Company Name</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={expForm.company}
                      onChange={(e) => setExpForm({ ...expForm, company: e.target.value })}
                      placeholder="e.g. Google / Microsoft" 
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Role Title</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={expForm.role}
                      onChange={(e) => setExpForm({ ...expForm, role: e.target.value })}
                      placeholder="e.g. Software Engineering Intern" 
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Duration</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={expForm.duration}
                    onChange={(e) => setExpForm({ ...expForm, duration: e.target.value })}
                    placeholder="e.g. Jun 2025 - Aug 2025 (3 Months)" 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description / Responsibilities</label>
                  <textarea 
                    className="form-input" 
                    rows={2}
                    value={expForm.description}
                    onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
                    placeholder="Key achievements and technologies used..." 
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowExpModal(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={handleAddExp}>Save Experience</button>
                </div>
              </div>
            )}

            {/* List of Experience */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {profile.experience.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                  No work experience or internships added yet. Click "Add Experience" to include past roles.
                </div>
              ) : (
                profile.experience.map((exp, idx) => (
                  <div key={idx} className="glass-panel" style={{ padding: '1.25rem', position: 'relative' }}>
                    <button 
                      onClick={() => handleRemoveExp(idx)}
                      style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                      title="Delete experience"
                    >
                      <Trash2 size={16} />
                    </button>
                    <h4 style={{ margin: '0 0 0.2rem 0', fontWeight: 800, fontSize: '1.05rem' }}>{exp.role}</h4>
                    <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600, marginBottom: '0.4rem' }}>
                      🏢 {exp.company} • <span style={{ color: 'var(--text-muted)' }}>{exp.duration}</span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45, margin: 0 }}>
                      {exp.description}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Section 6: Submitted Job Applications History (For Candidates) */}
        {!isRecruiter && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={20} style={{ color: 'var(--primary)' }} /> Submitted Applications History
            </h3>

            {applications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                No applications submitted yet. Browse <a href="/jobs" style={{ color: 'var(--primary)' }}>open vacancies</a> to apply!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {applications.map(app => (
                  <div key={app.id} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', fontWeight: 800, fontSize: '1.1rem' }}>
                        {app.job_details?.title || "Job Application"}
                      </h4>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        🏢 {app.job_details?.company || "Company"} • Applied on {new Date(app.applied_at).toLocaleDateString()}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span className={`status-badge badge-${app.status}`}>
                        {app.status.replace('_', ' ')}
                      </span>
                      {app.ats_score !== null && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)' }}>
                          ATS Match: {app.ats_score}%
                        </span>
                      )}
                      <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/result/${app.id}`)}>
                        <Eye size={14} /> View Report
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default Profile;
