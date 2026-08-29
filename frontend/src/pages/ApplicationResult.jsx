import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Award, ShieldAlert, Sparkles, FileText, CheckCircle2, AlertTriangle, ArrowRight, User, Volume2 } from 'lucide-react';
import { AuthContext } from '../App';

function ApplicationResult() {
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [feedback, setFeedback] = useState(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [isShared, setIsShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [practicingConcept, setPracticingConcept] = useState(null);

  useEffect(() => {
    fetch(`/api/applications/${applicationId}/`)
      .then(res => {
        if (!res.ok) throw new Error("Application not found or unauthorized");
        return res.json();
      })
      .then(data => {
        setApp(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [applicationId]);

  useEffect(() => {
    fetch(`/api/interview/${applicationId}/growth-feedback/`)
      .then(res => res.json())
      .then(data => {
        if (data && data.weaknesses) {
          setFeedback(data);
          setIsShared(data.is_shared_with_candidate);
        }
      })
      .catch(err => console.error("Error fetching growth feedback:", err))
      .finally(() => setFeedbackLoading(false));
  }, [applicationId]);

  const handleToggleShareFeedback = () => {
    setSharing(true);
    fetch(`/api/interview/${applicationId}/share-feedback/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share: !isShared })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setIsShared(data.is_shared_with_candidate);
        }
      })
      .catch(err => console.error("Error toggling share feedback:", err))
      .finally(() => setSharing(false));
  };

  const handlePracticeWeakness = (concept) => {
    setPracticingConcept(concept);
    fetch('/api/recruiter/create-mock-job/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Practice: ${concept}`,
        description: `Practice session targeting your understanding of: ${concept}.`,
        focus_topics: concept
      })
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to create practice room");
        return res.json();
      })
      .then(jobData => {
        const formData = new FormData();
        formData.append("candidate_name", app?.candidate_name || "Practice Candidate");
        formData.append("candidate_email", app?.candidate_email || "practice@hireai.internal");
        const dummyPdf = new Blob(["%PDF-1.4 ... dummy content"], { type: "application/pdf" });
        formData.append("resume", dummyPdf, "practice_resume.pdf");

        return fetch(`/api/jobs/${jobData.job_id}/apply/`, {
          method: 'POST',
          body: formData
        });
      })
      .then(res => {
        if (!res.ok) throw new Error("Failed to register practice session");
        return res.json();
      })
      .then(appData => {
        navigate(`/interview/${appData.id}`);
      })
      .catch(err => {
        console.error(err);
        alert("Failed to initialize practice session: " + err.message);
        setPracticingConcept(null);
      });
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <div className="pulse-spinner" style={{ margin: '0 auto' }}>AI</div>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Retrieving assessment reports...</p>
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <h2>Assessment Load Failed</h2>
        <p style={{ color: 'var(--danger)' }}>{error || "Application not found."}</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Return Home</button>
      </div>
    );
  }

  const job = app.job_details || {};
  const atsBreakdown = app.ats_breakdown || {};
  const analytics = app.interview_analytics || {};
  const securityLog = app.security_log || [];

  const isMockPractice = job.company === "Mock Practice Room";

  return (
    <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', paddingBottom: '6rem', maxWidth: '800px' }}>
      
      {/* Upper Status Banner */}
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ textAlign: 'left' }}>
          <span className={`status-badge badge-${
            app.status.includes('passed') || app.status === 'interview_scheduled' ? 'passed' :
            app.status.includes('failed') || app.status === 'rejected' ? 'failed' :
            app.status === 'hired' ? 'passed' : 'done'
          }`} style={{ marginBottom: '0.75rem' }}>
            {app.status.replace('_', ' ')}
          </span>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>{job.title}</h2>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>🏢 {job.company} &nbsp;·&nbsp; {app.candidate_name}</span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {user?.is_recruiter && (app.status === 'interview_done' || app.status === 'hired' || app.status === 'rejected') && (
            <button 
              className={`btn ${isShared ? 'btn-primary' : 'btn-secondary'}`}
              disabled={sharing}
              onClick={handleToggleShareFeedback}
              style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem' }}
            >
              <span>{isShared ? '🟢 AI Feedback Shared' : '⚪ Share AI Feedback'}</span>
            </button>
          )}

          {app.status === 'interview_scheduled' && (
            <button className="btn btn-primary animate-pulse" onClick={() => navigate(`/interview/${app.id}`)}>
              Enter Interview Room <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Grid: ATS and Proctoring Logs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        {/* ATS SCREENING SCORE SECTION */}
        <section className="glass-panel" style={{ padding: '2.25rem 2rem', textAlign: 'left' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
            <FileText size={20} style={{ color: 'var(--primary)' }} /> ATS Match Report
          </h3>

          <div className="responsive-half-grid" style={{ marginBottom: '1.5rem' }}>
            {/* Circle ATS Score */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: app.ats_score >= job.ats_threshold ? 'var(--success)' : 'var(--danger)' }}>
                {Math.round(app.ats_score || 0)}%
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.25rem' }}>
                Match Score <br />(Threshold: {job.ats_threshold}%)
              </span>
            </div>

            {/* ATS Feedback details */}
            <div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 700 }}>AI Parsing Summary:</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
                {app.ats_feedback || "The candidate's resume match calculation indicates alignment parameters."}
              </p>
            </div>
          </div>

          {/* Detailed breakdown list */}
          {atsBreakdown && Object.keys(atsBreakdown).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem', borderTop: '1px solid var(--panel-border)', paddingTop: '1.5rem' }}>
              <div>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Skill Matching:</strong>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--text-main)' }}>
                  {atsBreakdown.skills_match_score ? `${Math.round(atsBreakdown.skills_match_score)}%` : 'N/A'}
                </div>
              </div>
              <div>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Experience Fit:</strong>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--text-main)' }}>
                  {atsBreakdown.experience_fit_score ? `${Math.round(atsBreakdown.experience_fit_score)}%` : 'N/A'}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* DETAILED INTERVIEW EVALUATION SECTION (Visible if complete) */}
        {(app.status === 'interview_done' || app.status === 'hired' || app.status === 'rejected') && (
          <section className="glass-panel" style={{ padding: '2.25rem 2rem', textAlign: 'left' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
              <Award size={20} style={{ color: 'var(--success)' }} /> Technical Interview Report
            </h3>

            {/* Overview scores */}
            <div className="stats-breakdown-grid" style={{ marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{app.interview_percentage ? app.interview_percentage.toFixed(1) : '0.0'}%</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Overall Score</div>
              </div>
              <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: app.status === 'hired' ? 'var(--success)' : app.status === 'rejected' ? 'var(--danger)' : 'var(--accent)' }}>
                  {app.interview_rating || 'N/A'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Performance Rating</div>
              </div>
              {!isMockPractice ? (
                <>
                  <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {analytics.avg_confidence !== undefined ? `${analytics.avg_confidence}%` : 'N/A'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avg Confidence</div>
                  </div>
                  <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {analytics.avg_nervousness !== undefined ? `${analytics.avg_nervousness}%` : 'N/A'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avg Nervousness</div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {app.interview_speaking_fluency ? `${app.interview_speaking_fluency.toFixed(1)}/10` : '—'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Speaking Fluency</div>
                  </div>
                  <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {app.interview_filler_ratio !== undefined ? `${app.interview_filler_ratio.toFixed(1)}%` : '—'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Filler Words Ratio</div>
                  </div>
                </>
              )}
            </div>

            {/* Verdict */}
            <div style={{ padding: '1rem 1.25rem', backgroundColor: 'rgba(139, 92, 246, 0.05)', borderLeft: '3px solid var(--primary)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', marginBottom: '1.5rem' }}>
              <strong style={{ fontSize: '0.85rem', color: 'var(--primary)' }}>Hiring Verdict: </strong>
              <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{app.interview_recommendation}</span>
            </div>

            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 700 }}>Detailed Verdict:</h4>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: '2rem', whiteSpace: 'pre-wrap' }}>
              {app.interview_report}
            </div>

            {/* Speaking breakdown */}
            <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 700, borderTop: '1px solid var(--panel-border)', paddingTop: '1.5rem' }}>Verbal Expression Assessment:</h4>
            <div className="stats-breakdown-grid" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <div style={{ border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {app.interview_speaking_fluency ? `${app.interview_speaking_fluency.toFixed(1)}/10` : '—'}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Fluency Score</div>
              </div>
              <div style={{ border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>{app.interview_vocab_level || '—'}</span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Vocabulary Tier</div>
              </div>
              <div style={{ border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {app.interview_filler_ratio ? `${app.interview_filler_ratio.toFixed(1)}%` : '—'}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Filler Words Ratio</div>
              </div>
              <div style={{ border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {analytics.avg_ttr !== undefined ? `${(analytics.avg_ttr * 100).toFixed(1)}%` : '—'}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Vocabulary Richness</div>
              </div>
            </div>

            {/* Emotions Duration and Frequency Breakdown */}
            {((analytics.emotion_durations && Object.keys(analytics.emotion_durations).length > 0) || 
              (analytics.emotions_distribution && Object.keys(analytics.emotions_distribution).length > 0)) && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--panel-border)', paddingTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 1.25rem 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  🎭 Facial Expression Durations & Frequencies:
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {['happy', 'sad', 'neutral'].map((em) => {
                    const duration = analytics.emotion_durations?.[em] || 0;
                    const count = analytics.emotion_counts?.[em] || 0;
                    
                    // Calculate percentage based on total duration of happy, sad, and neutral
                    const totalDur = (analytics.emotion_durations?.happy || 0) + 
                                     (analytics.emotion_durations?.sad || 0) + 
                                     (analytics.emotion_durations?.neutral || 0);
                    const pct = totalDur > 0 ? Math.round((duration / totalDur) * 100) : 0;
                    
                    const emojiMap = { happy: '😊 Happy', sad: '😢 Sad', neutral: '😐 Neutral' };
                    const colorMap = {
                      happy: 'linear-gradient(90deg, #10b981, #34d399)',
                      sad: 'linear-gradient(90deg, #ef4444, #f87171)',
                      neutral: 'linear-gradient(90deg, #6366f1, #818cf8)'
                    };

                    return (
                      <div key={em} style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
                        <span style={{ width: '90px', fontWeight: 600 }}>{emojiMap[em]}</span>
                        <div style={{ flex: 1, height: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: colorMap[em], borderRadius: '4px' }} />
                        </div>
                        <span style={{ width: '150px', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          <strong>{Math.round(duration)}s</strong> duration ({count} time{count !== 1 ? 's' : ''})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* AUDIO INTEGRITY / VOICE SPOOFING DETECTION CARD */}
        {analytics.voice_spoof_summary && (
          <section className="glass-panel" style={{ padding: '2.25rem 2rem', textAlign: 'left', borderColor: analytics.voice_spoof_summary.risk_level === 'High' ? 'rgba(239, 68, 68, 0.2)' : 'var(--panel-border)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
              <Volume2 size={20} style={{ color: analytics.voice_spoof_summary.risk_level === 'High' ? 'var(--danger)' : analytics.voice_spoof_summary.risk_level === 'Medium' ? 'var(--warning)' : 'var(--success)' }} /> Audio Voice Spoofing Check
            </h3>

            <div className="responsive-half-grid" style={{ marginBottom: '1.5rem' }}>
              {/* Risk Badge */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-md)' }}>
                <span style={{
                  fontSize: '1.4rem',
                  fontWeight: 800,
                  color: analytics.voice_spoof_summary.risk_level === 'High' ? 'var(--danger)' :
                         analytics.voice_spoof_summary.risk_level === 'Medium' ? 'var(--warning)' : 'var(--success)'
                }}>
                  {analytics.voice_spoof_summary.risk_level} Risk
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.5rem' }}>
                  Spoofing Risk Level
                </span>
              </div>

              {/* Spoofing metric details */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 700 }}>Acoustic Jitter & Spectral Analysis:</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>
                  The AI voice verification module screens audio segments to identify digital vocal synthesizers, cloned neural models, or vocoder artifacts.
                </p>
                <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem', fontSize: '0.85rem' }}>
                  <div>
                    Average Anomaly Score: <strong style={{ color: 'var(--text-main)' }}>{analytics.voice_spoof_summary.average_score}%</strong>
                  </div>
                  <div>
                    Total Audited Answers: <strong style={{ color: 'var(--text-main)' }}>{analytics.voice_spoof_summary.total_checks}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Diagnostic warning logs */}
            {analytics.voice_spoof_summary.flagged_reasons && analytics.voice_spoof_summary.flagged_reasons.length > 0 && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--panel-border)', paddingTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-muted)' }}>Flagged Acoustic Anomaly Logs:</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {analytics.voice_spoof_summary.flagged_reasons.map((reason, idx) => (
                    <div key={idx} style={{ background: 'rgba(239, 68, 68, 0.03)', borderLeft: '3px solid #ef4444', padding: '0.5rem 0.75rem', borderRadius: '0 4px 4px 0', fontSize: '0.8rem', color: 'var(--text-main)' }}>
                      ⚠️ {reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* STUDENT PRACTICE COACH SECTION */}
        {(app.status === 'interview_done' || app.status === 'hired' || app.status === 'rejected') && (() => {
          // Derive practice strengths and areas of improvements dynamically
          const faultsList = [];
          const strengthsList = [];

          // 1. Filler words check
          const fillerRatio = app.interview_filler_ratio || 0;
          const topFillers = analytics.top_fillers || [];
          if (fillerRatio > 5.0) {
            faultsList.push({
              title: "Overuse of Filler Words 🗣️",
              desc: `Your filler words ratio was ${fillerRatio.toFixed(1)}%. We detected frequent use of: "${topFillers.join(', ')}". Try pausing briefly for 1-2 seconds instead of filling silence with voice sounds.`
            });
          } else if (fillerRatio > 0) {
            strengthsList.push({
              title: "Exceptional Filler Control 🤫",
              desc: `Excellent verbal control! Your filler word usage was only ${fillerRatio.toFixed(1)}%, proving highly concise and clean speech flow.`
            });
          }

          // 2. Fluency check
          const fluencyScore = app.interview_speaking_fluency || 0;
          if (fluencyScore < 6.5 && fluencyScore > 0) {
            faultsList.push({
              title: "Speaking Pacing & Flow ⏱️",
              desc: `Your speech fluency is scored at ${fluencyScore.toFixed(1)}/10. Focus on maintaining a steady speaking speed and try not to trail off at the end of sentences.`
            });
          } else if (fluencyScore >= 7.5) {
            strengthsList.push({
              title: "Natural Fluency & Cadence 🎙️",
              desc: `Excellent conversational pace! Your fluency rating is ${fluencyScore.toFixed(1)}/10, showing highly natural and professional speech delivery.`
            });
          }

          // 3. Vocabulary check
          const vocabLevel = app.interview_vocab_level || "N/A";
          if (vocabLevel === "Basic") {
            faultsList.push({
              title: "Vocabulary Complexity 📚",
              desc: "Your vocabulary complexity tier is registered as Basic. Practice explaining your logic using specific technical terminology (e.g. state keys, REST endpoints, MVC structures) instead of simple verbs."
            });
          } else if (vocabLevel === "Advanced" || vocabLevel === "Intermediate") {
            strengthsList.push({
              title: "Professional Vocabulary 🧠",
              desc: `Strong keyword density! Your vocabulary is in the ${vocabLevel} tier, proving strong competency in expressing technical concepts clearly.`
            });
          }

          // 4. Proctor / Focus check
          const warnings = app.security_warnings || 0;
          if (warnings > 0) {
            faultsList.push({
              title: "Visual Eye Contact & Gaze 🔒",
              desc: `You triggered ${warnings} proctor alerts. While practicing, ensure you keep your eyes focused on the monitor/webcam to build standard online assessment discipline.`
            });
          } else {
            strengthsList.push({
              title: "Visual Proctoring Focus 👁️",
              desc: "Outstanding eye contact! You remained centered and fully focused on the viewport without triggering any gaze drift warnings."
            });
          }

          // Fallbacks
          if (faultsList.length === 0) {
            strengthsList.push({
              title: "Perfect Practice Attempt 🏆",
              desc: "Superb interview execution! Shlok detected no major verbal mistakes, filler overruns, or posture drift during this mock attempt."
            });
          }

          return (
            <section className="glass-panel" style={{ padding: '2.25rem 2rem', textAlign: 'left', border: '1px solid rgba(139, 92, 246, 0.25)', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.02) 0%, rgba(192, 132, 252, 0.02) 100%)', marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
                <span style={{ fontSize: '1.4rem' }}>🎓</span> AI Practice Coach & Preparation Insights
              </h3>
              
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '2rem' }}>
                Great job completing this practice session! Shlok has analyzed your speech cadence and proctoring telemetry. Use this targeted checklist to prepare for your real corporate exams:
              </p>

              <div className="form-grid-2" style={{ gap: '1.5rem', alignItems: 'stretch' }}>
                
                {/* Improvement Card (Red theme) */}
                <div className="glass-panel" style={{ padding: '1.5rem', border: faultsList.length > 0 ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid var(--panel-border)', background: 'rgba(239, 68, 68, 0.01)' }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--danger)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    🔍 Mistakes to Fix & Improve:
                  </h4>
                  {faultsList.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                      No major communication faults or visual errors detected. Excellent!
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {faultsList.map((item, idx) => (
                        <div key={idx} style={{ paddingLeft: '0.5rem', borderLeft: '3px solid var(--danger)' }}>
                          <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>{item.title}</h5>
                          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Strengths Card (Green theme) */}
                <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid rgba(16, 185, 129, 0.15)', background: 'rgba(16, 185, 129, 0.01)' }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--success)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    🌟 Strengths to Maintain:
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {strengthsList.map((item, idx) => (
                      <div key={idx} style={{ paddingLeft: '0.5rem', borderLeft: '3px solid var(--success)' }}>
                        <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)' }}>{item.title}</h5>
                        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </section>
          );
        })()}

        {/* AI LEARNING HUB & GROWTH REPORT SECTION */}
        {feedback && (
          <section className="glass-panel animate-fade-in" style={{
            padding: '2.25rem 2rem',
            textAlign: 'left',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.02) 0%, rgba(79, 70, 229, 0.02) 100%)',
            marginBottom: '2rem'
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
              <Sparkles size={20} style={{ color: 'var(--success)' }} /> 💡 AI Learning Hub & Coaching Reports
            </h3>
            
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '2rem' }}>
              Based on your technical screening, Shlok has compiled a learning pathway for you. Review weak concepts and practice them directly in a targeted sandbox:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2.5rem' }}>
              {feedback.weaknesses && feedback.weaknesses.map((item, idx) => (
                <div key={idx} className="glass-panel" style={{
                  padding: '1.5rem',
                  border: '1px solid rgba(79, 70, 229, 0.15)',
                  background: 'rgba(255, 255, 255, 0.01)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '1.5rem'
                }}>
                  <div style={{ flex: '1 1 350px' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: 'var(--text-main)', fontWeight: 700 }}>
                      ⚠️ Weakness: {item.concept}
                    </h4>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {item.feedback}
                    </p>
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>
                      💡 Recommended Study Query: <em>"{item.study_query}"</em>
                    </span>
                  </div>
                  
                  <button
                    className="btn btn-primary"
                    disabled={practicingConcept !== null}
                    onClick={() => handlePracticeWeakness(item.concept)}
                    style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', alignSelf: 'center' }}
                  >
                    {practicingConcept === item.concept ? 'Launching...' : 'Practice This Weakness ⚡'}
                  </button>
                </div>
              ))}
            </div>

            {feedback.study_resources && feedback.study_resources.length > 0 && (
              <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  📖 Curated Reference Materials & Documentation:
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {feedback.study_resources.map((res, rIdx) => (
                    <a
                      key={rIdx}
                      href={res.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-panel"
                      style={{
                        padding: '1rem',
                        display: 'block',
                        textDecoration: 'none',
                        color: 'var(--text-main)',
                        border: '1px solid var(--panel-border)',
                        background: 'rgba(255, 255, 255, 0.01)',
                        transition: 'transform 0.2s, border-color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--primary)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--panel-border)';
                        e.currentTarget.style.transform = 'none';
                      }}
                    >
                      <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: '0.25rem' }}>{res.title}</strong>
                      <span style={{ fontSize: '0.72rem', color: 'var(--primary)' }}>Read Documentation &rarr;</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* SECURITY & PROCTORING AUDIT LOG */}
        {securityLog.length > 0 && (
          <section className="glass-panel" style={{ padding: '2.25rem 2rem', textAlign: 'left', borderColor: app.is_disqualified ? 'rgba(239, 68, 68, 0.2)' : 'var(--panel-border)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0, marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
              <ShieldAlert size={20} style={{ color: app.is_disqualified ? 'var(--danger)' : 'var(--warning)' }} /> Proctoring Security Audit
            </h3>

            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              <div>
                Total Warning Events: <strong style={{ color: app.security_warnings > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {app.security_warnings} / 5
                </strong>
              </div>
              <div>
                Liveness Identity Verified: <strong style={{ color: app.is_verified ? 'var(--success)' : 'var(--danger)' }}>
                  {app.is_verified ? "Yes (Score: " + app.verification_score + "%)" : "No"}
                </strong>
              </div>
              {app.is_disqualified && (
                <div style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  ⚠️ Session Auto-Disqualified
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto', paddingRight: '0.5rem' }}>
              {securityLog.map((log, idx) => {
                const time = log.timestamp ? log.timestamp.split(" ")[1] : "Log";
                return log.violations.map((v, vIdx) => (
                  <div key={`${idx}-${vIdx}`} style={{ background: 'rgba(239, 68, 68, 0.05)', borderLeft: '3px solid #ef4444', padding: '0.6rem 1rem', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{v}</span>
                    <strong style={{ color: '#ef4444' }}>[{time}]</strong>
                  </div>
                ));
              })}
            </div>
          </section>
        )}
        
      </div>

      <div style={{ textAlign: 'center', marginTop: '3rem' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/profile')}>
          Return to My Applications
        </button>
      </div>

    </div>
  );
}

export default ApplicationResult;
