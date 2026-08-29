import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, User, FileText, ArrowRight, ShieldCheck, ShieldAlert, Award, Filter, Eye } from 'lucide-react';

function HrDashboard() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  
  // Job creation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [experience, setExperience] = useState('0-2 years');
  const [description, setDescription] = useState('');
  const [skills, setSkills] = useState('');
  const [maxQ, setMaxQ] = useState(5);
  const [maxFollowups, setMaxFollowups] = useState(2);
  const [atsThreshold, setAtsThreshold] = useState(50.0);
  const [createError, setCreateError] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [liveMonitorAppId, setLiveMonitorAppId] = useState(null);

  const [securitySettings, setSecuritySettings] = useState({
    looking_away: true,
    fullscreen: true,
    tab_switching: true,
    multiple_faces: true,
    liveness: true,
    blink_detection: true,
  });
  const [customQuestions, setCustomQuestions] = useState([]);

  // Custom ATS weights state & handler
  const [atsWeights, setAtsWeights] = useState({
    skill: 35,
    technology_and_tools: 25,
    experience: 10,
    qualification: 10,
    has_strong_project: 5,
    achievement: 5,
    internship: 5,
    soft_skill: 5,
  });

  const [lockedWeights, setLockedWeights] = useState({
    skill: false,
    technology_and_tools: false,
    experience: false,
    qualification: false,
    has_strong_project: false,
    achievement: false,
    internship: false,
    soft_skill: false,
  });

  const handleWeightChange = (key, newValue) => {
    if (lockedWeights[key]) return; // If this key is locked, do not allow editing

    const otherKeys = Object.keys(atsWeights).filter(k => k !== key);
    const lockedKeys = otherKeys.filter(k => lockedWeights[k]);
    const unlockedKeys = otherKeys.filter(k => !lockedWeights[k]);

    if (unlockedKeys.length === 0) return; // If all others are locked, we cannot change this weight

    const sumLocked = lockedKeys.reduce((sum, k) => sum + atsWeights[k], 0);
    const sumOthers = unlockedKeys.reduce((sum, k) => sum + atsWeights[k], 0);

    // Clamp newValue to the remaining budget
    newValue = Math.max(0, Math.min(100 - sumLocked, Math.round(Number(newValue))));

    let newWeights = { ...atsWeights };
    newWeights[key] = newValue;

    const targetRemaining = 100 - newValue - sumLocked;

    if (targetRemaining === 0) {
      // If no budget left for unlocked weights, set them to 0
      unlockedKeys.forEach(k => {
        newWeights[k] = 0;
      });
    } else if (sumOthers === 0) {
      // If all unlocked weights were 0, distribute targetRemaining equally among them
      const share = Math.floor(targetRemaining / unlockedKeys.length);
      let remainder = targetRemaining % unlockedKeys.length;
      unlockedKeys.forEach((k, idx) => {
        newWeights[k] = share + (idx < remainder ? 1 : 0);
      });
    } else {
      // Distribute targetRemaining proportionally to other unlocked keys
      let tempWeights = {};
      let sumRounded = 0;

      unlockedKeys.forEach(k => {
        const floatVal = targetRemaining * (atsWeights[k] / sumOthers);
        tempWeights[k] = {
          floor: Math.floor(floatVal),
          remainder: floatVal - Math.floor(floatVal)
        };
        newWeights[k] = tempWeights[k].floor;
        sumRounded += tempWeights[k].floor;
      });

      let difference = targetRemaining - sumRounded;
      if (difference > 0) {
        const sortedKeys = [...unlockedKeys].sort((a, b) => tempWeights[b].remainder - tempWeights[a].remainder);
        for (let i = 0; i < difference; i++) {
          newWeights[sortedKeys[i]] += 1;
        }
      }
    }

    setAtsWeights(newWeights);
  };

  const applyPreset = (preset) => {
    setLockedWeights({
      skill: false,
      technology_and_tools: false,
      experience: false,
      qualification: false,
      has_strong_project: false,
      achievement: false,
      internship: false,
      soft_skill: false,
    });

    if (preset === 'balanced') {
      setAtsWeights({
        skill: 35,
        technology_and_tools: 25,
        experience: 10,
        qualification: 10,
        has_strong_project: 5,
        achievement: 5,
        internship: 5,
        soft_skill: 5,
      });
    } else if (preset === 'tech') {
      setAtsWeights({
        skill: 45,
        technology_and_tools: 35,
        experience: 5,
        qualification: 5,
        has_strong_project: 5,
        achievement: 2,
        internship: 2,
        soft_skill: 1,
      });
    } else if (preset === 'exp') {
      setAtsWeights({
        skill: 25,
        technology_and_tools: 15,
        experience: 40,
        qualification: 5,
        has_strong_project: 10,
        achievement: 2,
        internship: 1,
        soft_skill: 2,
      });
    }
  };

  // Stats calculation
  const [totalAppsCount, setTotalAppsCount] = useState(0);
  const [hiredCount, setHiredCount] = useState(0);
  const [disqualifiedCount, setDisqualifiedCount] = useState(0);

  useEffect(() => {
    loadDashboard();
  }, []);

  // Listen to AI Recruiter Assistant events
  useEffect(() => {
    const handleApplyRecruiterData = (e) => {
      const { description: newDesc, skills: newSkills, customQuestions: newQuestions } = e.detail;
      if (newDesc) {
        setDescription(newDesc);
      }
      if (newSkills) {
        setSkills(newSkills);
      }
      if (newQuestions && newQuestions.length > 0) {
        setCustomQuestions(newQuestions);
      }
    };
    window.addEventListener('apply-recruiter-assistant-data', handleApplyRecruiterData);
    return () => {
      window.removeEventListener('apply-recruiter-assistant-data', handleApplyRecruiterData);
    };
  }, []);

  // Polling for live applications telemetry
  useEffect(() => {
    let interval = null;
    if (selectedJob) {
      interval = setInterval(() => {
        fetch(`/api/recruiter/jobs/${selectedJob.id}/applications/`)
          .then(res => res.json())
          .then(data => {
            setApplications(data.applications || []);
            // Recalculate metrics
            setTotalAppsCount(data.applications.length);
            setHiredCount(data.applications.filter(a => a.status === 'hired').length);
            setDisqualifiedCount(data.applications.filter(a => a.is_disqualified).length);
          })
          .catch(err => console.error("Polling error:", err));
      }, 4000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedJob]);

  const loadDashboard = () => {
    setLoading(true);
    fetch('/api/recruiter/dashboard/')
      .then(res => {
        if (!res.ok) throw new Error("Could not load recruiter data");
        return res.json();
      })
      .then(data => {
        setJobs(data.jobs || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Dashboard error:", err);
        setLoading(false);
      });
  };

  const handleSelectJob = (job) => {
    setSelectedJob(job);
    setAppsLoading(true);
    setApplications([]);

    fetch(`/api/recruiter/jobs/${job.id}/applications/`)
      .then(res => res.json())
      .then(data => {
        setApplications(data.applications || []);
        
        // Calculate metrics
        setTotalAppsCount(data.applications.length);
        setHiredCount(data.applications.filter(a => a.status === 'hired').length);
        setDisqualifiedCount(data.applications.filter(a => a.is_disqualified).length);
        
        setAppsLoading(false);
      })
      .catch(err => {
        console.error("Error fetching applications:", err);
        setAppsLoading(false);
      });
  };

  const handleCreateJobSubmit = (e) => {
    e.preventDefault();
    if (!title || !company || !description) {
      setCreateError("Role title, Company, and Description are required.");
      return;
    }

    setCreateLoading(true);
    setCreateError('');

    fetch('/api/recruiter/create-job/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        company,
        experience,
        description,
        required_skills: skills,
        max_questions: maxQ,
        max_followups: maxFollowups,
        ats_threshold: atsThreshold,
        ats_weights: atsWeights,
        security_settings: securitySettings,
        custom_questions: customQuestions.filter(q => q.trim() !== '')
      })
    })
      .then(res => {
        if (!res.ok) throw new Error("Job creation failed");
        return res.json();
      })
      .then(() => {
        setCreateLoading(false);
        setShowCreateModal(false);
        // Reset form
        setTitle('');
        setCompany('');
        setDescription('');
        setSkills('');
        setSecuritySettings({
          looking_away: true,
          fullscreen: true,
          tab_switching: true,
          multiple_faces: true,
          liveness: true,
          blink_detection: true,
        });
        setCustomQuestions([]);
        setMaxFollowups(2);
        setLockedWeights({
          skill: false,
          technology_and_tools: false,
          experience: false,
          qualification: false,
          has_strong_project: false,
          achievement: false,
          internship: false,
          soft_skill: false,
        });
        setAtsWeights({
          skill: 35,
          technology_and_tools: 25,
          experience: 10,
          qualification: 10,
          has_strong_project: 5,
          achievement: 5,
          internship: 5,
          soft_skill: 5,
        });
        loadDashboard();
      })
      .catch(err => {
        setCreateLoading(false);
        setCreateError(err.message);
      });
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <div className="pulse-spinner" style={{ margin: '0 auto' }}>AI</div>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Loading recruitment console...</p>
      </div>
    );
  }

  return (
    <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', paddingBottom: '6rem' }}>
      
      {/* Dashboard Top Header */}
      <div className="dashboard-header">
        <h2 className="dashboard-title">Hiring Management</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          Create Job Posting <Plus size={16} />
        </button>
      </div>

      {/* Main Grid: Jobs List vs Application Details */}
      <div className="dashboard-layout-grid">
        
        {/* Left side: Job Postings list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, textAlign: 'left', margin: '0 0 0.5rem 0' }}>Job Listings</h3>
          {jobs.length === 0 ? (
            <div className="glass-panel" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)' }}>No jobs posted yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="glass-panel"
                  onClick={() => handleSelectJob(job)}
                  style={{
                    padding: '1.25rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderColor: selectedJob?.id === job.id ? 'var(--primary)' : 'var(--panel-border)',
                    boxShadow: selectedJob?.id === job.id ? '0 0 12px var(--primary-glow)' : 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  <strong style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{job.title}</strong>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    <span>🏢 {job.company}</span>
                    <span>Threshold: {job.ats_threshold}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right side: Applicants dashboard */}
        <div style={{ textAlign: 'left' }}>
          {selectedJob ? (
            <div className="animate-fade-in">
              <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.25rem 0' }}>{selectedJob.title}</h3>
              <p style={{ color: 'var(--text-muted)', margin: '0 0 2rem 0', fontSize: '0.9rem' }}>🏢 {selectedJob.company} &nbsp;·&nbsp; Applicants review dashboard</p>

              {/* Stats overview banner */}
              <div className="stats-grid" style={{ marginBottom: '2rem' }}>
                <div className="glass-panel stat-card" style={{ padding: '1rem 1.25rem' }}>
                  <span className="stat-label">Total Applied</span>
                  <span className="stat-value" style={{ fontSize: '1.8rem' }}>{totalAppsCount}</span>
                </div>
                <div className="glass-panel stat-card" style={{ padding: '1rem 1.25rem' }}>
                  <span className="stat-label">Hired Candidates</span>
                  <span className="stat-value" style={{ fontSize: '1.8rem', color: 'var(--success)' }}>{hiredCount}</span>
                </div>
                <div className="glass-panel stat-card" style={{ padding: '1rem 1.25rem' }}>
                  <span className="stat-label">Disqualified Logs</span>
                  <span className="stat-value" style={{ fontSize: '1.8rem', color: 'var(--danger)' }}>{disqualifiedCount}</span>
                </div>
              </div>

              {/* Candidates list table */}
              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1rem 0' }}>Candidate Applications</h4>
              
              {appsLoading ? (
                <div style={{ padding: '3rem 0', textAlign: 'center' }}>
                  <div className="pulse-spinner" style={{ margin: '0 auto' }}>AI</div>
                </div>
              ) : applications.length === 0 ? (
                <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)' }}>No candidates have applied to this posting yet.</p>
                </div>
              ) : (
                <div className="glass-panel" style={{ overflow: 'hidden', padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--panel-border)', backgroundColor: 'rgba(255,255,255,0.01)' }}>
                        <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-muted)' }}>Candidate</th>
                        <th style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>ATS Match</th>
                        <th style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Proctor Status</th>
                        <th style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Score/Rating</th>
                        <th style={{ padding: '1rem', textAlign: 'right', color: 'var(--text-muted)' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applications.map((app) => (
                        <tr key={app.id} style={{ borderBottom: '1px solid var(--panel-border)', transition: 'background-color 0.2s' }} className="table-row-hover">
                          <td style={{ padding: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{app.candidate_name}</div>
                              {app.ats_feedback?.includes("Passport") && (
                                <span className="status-badge" style={{
                                  fontSize: '0.65rem',
                                  backgroundColor: 'rgba(79, 70, 229, 0.1)',
                                  color: 'var(--primary)',
                                  border: '1px solid rgba(79, 70, 229, 0.2)',
                                  fontWeight: 700,
                                  padding: '1px 6px'
                                }}>
                                  🛡️ HireAI Verified
                                </span>
                              )}
                              {app.status === 'interview_scheduled' && (
                                <span style={{
                                  display: 'inline-block',
                                  width: '8px',
                                  height: '8px',
                                  backgroundColor: '#10b981',
                                  borderRadius: '50%',
                                  boxShadow: '0 0 8px #10b981',
                                  animation: 'pulse 2s infinite'
                                }} title="Live Session Active" />
                              )}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{app.candidate_email}</div>
                          </td>
                          
                          <td style={{ padding: '1rem', textAlign: 'center', fontWeight: 700, color: app.ats_score >= selectedJob.ats_threshold ? 'var(--success)' : 'var(--danger)' }}>
                            {Math.round(app.ats_score)}%
                          </td>
                          
                          <td style={{ padding: '1rem', textAlign: 'center' }}>
                            {app.is_disqualified ? (
                              <span className="status-badge badge-failed" style={{ fontSize: '0.7rem' }}>Disqualified</span>
                            ) : app.security_warnings > 0 ? (
                              <span className="status-badge badge-pending" style={{ fontSize: '0.7rem' }}>{app.security_warnings} Alert(s)</span>
                            ) : (
                              <span className="status-badge badge-passed" style={{ fontSize: '0.7rem' }}>Secure</span>
                            )}
                          </td>
                          
                          <td style={{ padding: '1rem', textAlign: 'center' }}>
                            {app.interview_percentage !== null ? (
                              <div>
                                <strong style={{ color: 'var(--text-main)' }}>{app.interview_percentage.toFixed(1)}%</strong>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{app.interview_rating}</div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                {app.status === 'interview_scheduled' ? (
                                  <span style={{ color: '#10b981', fontWeight: 600 }}>In Progress</span>
                                ) : 'N/A'}
                              </span>
                            )}
                          </td>

                          <td style={{ padding: '1rem', textAlign: 'right', display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                            {app.status === 'interview_scheduled' && (
                              <button
                                className="btn btn-primary"
                                onClick={() => setLiveMonitorAppId(app.id)}
                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', backgroundColor: '#10b981', borderColor: '#10b981' }}
                              >
                                <span style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: '#fff', borderRadius: '50%' }}></span>
                                Monitor Live
                              </button>
                            )}
                            <button
                              className="btn btn-secondary"
                              onClick={() => navigate(`/result/${app.id}`)}
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              <Eye size={12} /> Detail
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '6rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1.5rem' }}>🎯</div>
              <h3>Select a Job Posting</h3>
              <p style={{ color: 'var(--text-muted)', maxWidth: '360px' }}>
                Choose one of your job listings from the left sidebar to review candidate ATS matches, visual proctoring warnings, and final interview ratings.
              </p>
            </div>
          )}
        </div>

      </div>

      {/* LIVE CANDIDATE MONITORING MODAL OVERLAY */}
      {liveMonitorAppId && (() => {
        const liveApp = applications.find(a => a.id === liveMonitorAppId);
        if (!liveApp) return null;
        
        const telemetry = liveApp.interview_analytics?.live_telemetry || {};
        const status = telemetry.status || "verifying";
        
        let statusBadge = null;
        if (status === "verifying") {
          statusBadge = <span className="status-badge badge-pending">👤 Verifying Identity</span>;
        } else if (status === "thinking") {
          statusBadge = <span className="status-badge" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)' }}>⏳ Reading / Thinking</span>;
        } else if (status === "answering") {
          statusBadge = <span className="status-badge badge-passed" style={{ animation: 'pulse 1.5s infinite', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>🎙️ Active Recording / Answering</span>;
        } else if (status === "tabbed_out") {
          statusBadge = <span className="status-badge badge-failed" style={{ animation: 'flash 1s infinite' }}>🚨 WARNING: Tab Switched Out</span>;
        } else if (status === "completed") {
          statusBadge = <span className="status-badge" style={{ backgroundColor: 'rgba(107, 114, 128, 0.1)', color: '#9ca3af', border: '1px solid rgba(107, 114, 128, 0.2)' }}>✅ Completed (Evaluating)</span>;
        }

        return (
          <div className="fullscreen-blocker animate-fade-in" style={{ background: 'rgba(10, 11, 16, 0.85)', zIndex: 1001 }}>
            <div className="glass-panel" style={{ maxWidth: '600px', width: '100%', padding: '2.5rem', textAlign: 'left', maxHeight: '90vh', overflowY: 'auto', margin: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '1rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>📡 Live Session Monitor</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Monitoring: <strong>{liveApp.candidate_name}</strong></span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%', boxShadow: '0 0 8px #10b981', animation: 'pulse 2s infinite' }}></span>
                    Live Feed Active
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Updated at {telemetry.last_active_timestamp || 'N/A'}</span>
                </div>
              </div>

              {/* Status Section */}
              <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.01)' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Current Candidate State:</span>
                {statusBadge}
              </div>

              {/* Question progress */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--accent)', fontWeight: 700, margin: '0 0 0.5rem 0' }}>📋 Active Progress</h4>
                <div className="glass-panel" style={{ padding: '1rem' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                    Question Index: <strong>{telemetry.current_question_index || 0}</strong>
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.75rem' }}>
                    {telemetry.current_question_text || 'Waiting to start first question...'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', borderTop: '1px solid var(--panel-border)', paddingTop: '0.5rem', color: 'var(--text-muted)' }}>
                    <span>Spoken Word Count:</span>
                    <strong style={{ color: 'var(--text-main)' }}>{telemetry.current_word_count || 0} words</strong>
                  </div>
                </div>
              </div>

              {/* Telemetry Details */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--accent)', fontWeight: 700, margin: '0 0 0.5rem 0' }}>📷 Visual Proctoring Feed</h4>
                <div className="form-grid-2">
                  <div className="glass-panel" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Live Emotion</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, textTransform: 'capitalize', color: 'var(--text-main)', marginTop: '0.25rem' }}>
                      {telemetry.live_emotion === 'neutral' ? '😐 Neutral' :
                       telemetry.live_emotion === 'happy' ? '😊 Happy' :
                       telemetry.live_emotion === 'sad' ? '😢 Sad' :
                       telemetry.live_emotion === 'angry' ? '😠 Angry' :
                       telemetry.live_emotion === 'fear' ? '😨 Fear' :
                       telemetry.live_emotion === 'surprise' ? '😮 Surprise' : '😐 ' + (telemetry.live_emotion || 'Neutral')}
                    </div>
                  </div>

                  <div className="glass-panel" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Head Position Offset</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: (Math.abs(telemetry.live_yaw || 0) > 15 || Math.abs(telemetry.live_pitch || 0) > 15) ? 'var(--danger)' : 'var(--success)', marginTop: '0.5rem' }}>
                      Yaw: {telemetry.live_yaw || 0.0}° | Pitch: {telemetry.live_pitch || 0.0}°
                    </div>
                  </div>
                </div>
              </div>

              {/* Real-time Expression Analytics for Recruiter */}
              {telemetry.emotion_durations && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--accent)', fontWeight: 700, margin: '0 0 0.5rem 0' }}>🎭 Real-time Emotion Statistics</h4>
                  <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {['happy', 'sad', 'neutral'].map((em) => {
                      const dur = telemetry.emotion_durations?.[em] || 0;
                      const cnt = telemetry.emotion_counts?.[em] || 0;
                      
                      const totalDur = (telemetry.emotion_durations?.happy || 0) + 
                                       (telemetry.emotion_durations?.sad || 0) + 
                                       (telemetry.emotion_durations?.neutral || 0);
                      const pct = totalDur > 0 ? Math.round((dur / totalDur) * 100) : 0;
                      
                      const emojiMap = { happy: '😊 Happy', sad: '😢 Sad', neutral: '😐 Neutral' };
                      const colorMap = {
                        happy: 'linear-gradient(90deg, #10b981, #34d399)',
                        sad: 'linear-gradient(90deg, #ef4444, #f87171)',
                        neutral: 'linear-gradient(90deg, #6366f1, #818cf8)'
                      };

                      return (
                        <div key={em} style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.8rem' }}>
                          <span style={{ width: '80px', fontWeight: 600 }}>{emojiMap[em]}</span>
                          <div style={{ flex: 1, height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: colorMap[em], borderRadius: '3px' }} />
                          </div>
                          <span style={{ width: '140px', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            {Math.round(dur)}s ({cnt} time{cnt !== 1 ? 's' : ''})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Safety Alerts */}
              <div style={{ marginBottom: '2rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--accent)', fontWeight: 700, margin: '0 0 0.5rem 0' }}>🚨 Cheating Warnings Triggered</h4>
                <div className="glass-panel" style={{ padding: '1.25rem', border: liveApp.security_warnings > 0 ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid var(--panel-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span>Warnings Counter:</span>
                    <strong style={{ fontSize: '1.2rem', color: liveApp.security_warnings >= 4 ? 'var(--danger)' : liveApp.security_warnings > 0 ? 'var(--warning)' : 'var(--success)' }}>
                      {liveApp.security_warnings} / 5 Warnings
                    </strong>
                  </div>
                  {liveApp.is_disqualified ? (
                    <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-glow)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', fontWeight: 600 }}>
                      ⚠️ Candidate Disqualified (Warnings threshold reached)
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${(liveApp.security_warnings / 5) * 100}%`, height: '100%', backgroundColor: liveApp.security_warnings >= 3 ? 'var(--danger)' : 'var(--primary)', transition: 'width 0.3s' }}></div>
                    </div>
                  )}

                  {/* Warning logs */}
                  {liveApp.security_log && liveApp.security_log.length > 0 && (
                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--panel-border)', paddingTop: '0.75rem', maxHeight: '120px', overflowY: 'auto', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {liveApp.security_log.map((log, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>[{log.timestamp?.split(" ")?.[1] || log.timestamp}]</span>
                          <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{log.violations.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setLiveMonitorAppId(null)}>
                  Close Monitor
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* JOB CREATION MODAL OVERLAY */}
      {showCreateModal && (
        <div className="fullscreen-blocker animate-fade-in" style={{ background: 'rgba(10, 11, 16, 0.9)', zIndex: 1000 }}>
          <div className="glass-panel" style={{ maxWidth: '560px', width: '100%', padding: '2.5rem', textAlign: 'left', maxHeight: '90vh', overflowY: 'auto', margin: 'auto' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 1.5rem 0' }}>Post New Opportunity</h2>

            {createError && (
              <div style={{ padding: '0.8rem', backgroundColor: 'var(--danger-glow)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                ⚠️ {createError}
              </div>
            )}

            <form onSubmit={handleCreateJobSubmit}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="role-title">Role Title *</label>
                  <input type="text" id="role-title" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Frontend Engineer" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="company-name">Company Name *</label>
                  <input type="text" id="company-name" className="form-input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. HireAI Corp" required />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="exp-req">Experience Req.</label>
                  <input type="text" id="exp-req" className="form-input" value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="e.g. 1-3 years" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="ats-thresh">ATS Threshold (%)</label>
                  <input type="number" id="ats-thresh" className="form-input" value={atsThreshold} onChange={(e) => setAtsThreshold(e.target.value)} min="1" max="100" />
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="max-questions">Max AI Questions</label>
                  <input type="number" id="max-questions" className="form-input" value={maxQ} onChange={(e) => setMaxQ(e.target.value)} min="1" max="15" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="max-followups">Max Follow-ups</label>
                  <input type="number" id="max-followups" className="form-input" value={maxFollowups} onChange={(e) => setMaxFollowups(e.target.value)} min="0" max="5" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="req-skills">Required Skills (Comma separated)</label>
                <input type="text" id="req-skills" className="form-input" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="e.g. React, JavaScript, Python" />
              </div>

              <div className="form-group" style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1.25rem', marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ margin: 0, fontWeight: 700, color: 'var(--accent)' }}>🎯 ATS Shortlisting Weights (Sum: 100%)</label>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }} onClick={() => applyPreset('balanced')}>Balanced</button>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }} onClick={() => applyPreset('tech')}>Tech-Heavy</button>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }} onClick={() => applyPreset('exp')}>Exp-Heavy</button>
                  </div>
                </div>

                 <div className="form-grid-2" style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', gap: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.skill}
                          onChange={(e) => setLockedWeights({...lockedWeights, skill: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Technical Skills
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.skill}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.skill ? 0.5 : 1 }} value={atsWeights.skill} min="0" max="100" disabled={lockedWeights.skill} onChange={(e) => handleWeightChange('skill', e.target.value)} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.technology_and_tools}
                          onChange={(e) => setLockedWeights({...lockedWeights, technology_and_tools: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Technologies & Tools
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.technology_and_tools}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.technology_and_tools ? 0.5 : 1 }} value={atsWeights.technology_and_tools} min="0" max="100" disabled={lockedWeights.technology_and_tools} onChange={(e) => handleWeightChange('technology_and_tools', e.target.value)} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.experience}
                          onChange={(e) => setLockedWeights({...lockedWeights, experience: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Work Experience
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.experience}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.experience ? 0.5 : 1 }} value={atsWeights.experience} min="0" max="100" disabled={lockedWeights.experience} onChange={(e) => handleWeightChange('experience', e.target.value)} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.qualification}
                          onChange={(e) => setLockedWeights({...lockedWeights, qualification: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Education & Degree
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.qualification}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.qualification ? 0.5 : 1 }} value={atsWeights.qualification} min="0" max="100" disabled={lockedWeights.qualification} onChange={(e) => handleWeightChange('qualification', e.target.value)} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.has_strong_project}
                          onChange={(e) => setLockedWeights({...lockedWeights, has_strong_project: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Projects Highlight
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.has_strong_project}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.has_strong_project ? 0.5 : 1 }} value={atsWeights.has_strong_project} min="0" max="100" disabled={lockedWeights.has_strong_project} onChange={(e) => handleWeightChange('has_strong_project', e.target.value)} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.achievement}
                          onChange={(e) => setLockedWeights({...lockedWeights, achievement: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Achievements / Certs
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.achievement}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.achievement ? 0.5 : 1 }} value={atsWeights.achievement} min="0" max="100" disabled={lockedWeights.achievement} onChange={(e) => handleWeightChange('achievement', e.target.value)} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.internship}
                          onChange={(e) => setLockedWeights({...lockedWeights, internship: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Internships Match
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.internship}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.internship ? 0.5 : 1 }} value={atsWeights.internship} min="0" max="100" disabled={lockedWeights.internship} onChange={(e) => handleWeightChange('internship', e.target.value)} />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={lockedWeights.soft_skill}
                          onChange={(e) => setLockedWeights({...lockedWeights, soft_skill: e.target.checked})}
                          style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        Soft Skills
                      </label>
                      <strong style={{ color: 'var(--text-main)' }}>{atsWeights.soft_skill}%</strong>
                    </div>
                    <input type="range" className="form-input" style={{ width: '100%', height: '5px', padding: 0, opacity: lockedWeights.soft_skill ? 0.5 : 1 }} value={atsWeights.soft_skill} min="0" max="100" disabled={lockedWeights.soft_skill} onChange={(e) => handleWeightChange('soft_skill', e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1.25rem', marginTop: '1.25rem' }}>
                <label className="form-label" style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: '0.75rem' }}>🔒 Interview Security & Proctoring Features</label>
                <div className="form-grid-2" style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', gap: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={securitySettings.looking_away} onChange={(e) => setSecuritySettings({...securitySettings, looking_away: e.target.checked})} />
                    Looking Away Warning
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={securitySettings.fullscreen} onChange={(e) => setSecuritySettings({...securitySettings, fullscreen: e.target.checked})} />
                    Force Fullscreen Mode
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={securitySettings.tab_switching} onChange={(e) => setSecuritySettings({...securitySettings, tab_switching: e.target.checked})} />
                    Tab Switch Detection
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={securitySettings.multiple_faces} onChange={(e) => setSecuritySettings({...securitySettings, multiple_faces: e.target.checked})} />
                    Multiple Faces Warning
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={securitySettings.liveness} onChange={(e) => setSecuritySettings({...securitySettings, liveness: e.target.checked})} />
                    Liveness Check (Static Photo)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={securitySettings.blink_detection} onChange={(e) => setSecuritySettings({...securitySettings, blink_detection: e.target.checked})} />
                    Blink Notice / Eye Detection
                  </label>
                </div>
              </div>

              <div className="form-group" style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1.25rem', marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ margin: 0, fontWeight: 700, color: 'var(--accent)' }}>❓ Predefined Custom Questions (Optional)</label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                    onClick={() => setCustomQuestions([...customQuestions, ''])}
                  >
                    + Add Question
                  </button>
                </div>
                
                {customQuestions.length === 0 ? (
                  <div style={{ padding: '0.75rem', border: '1px dashed var(--panel-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    No custom questions added. AI will generate questions dynamically.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {customQuestions.map((q, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: '1.5rem' }}>#{idx + 1}</span>
                        <input
                          type="text"
                          className="form-input"
                          style={{ flex: 1, padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                          value={q}
                          onChange={(e) => {
                            const newQs = [...customQuestions];
                            newQs[idx] = e.target.value;
                            setCustomQuestions(newQs);
                          }}
                          placeholder={`e.g. Can you explain your experience with Django?`}
                          required
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.4rem 0.6rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                          onClick={() => {
                            const newQs = customQuestions.filter((_, i) => i !== idx);
                            setCustomQuestions(newQs);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="role-desc">Job Description *</label>
                <textarea id="role-desc" className="form-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Enter details about responsibilities, qualifications, and parameters..." rows="4" style={{ resize: 'vertical' }} required />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createLoading}>
                  {createLoading ? "Saving..." : "Create Listing"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default HrDashboard;
