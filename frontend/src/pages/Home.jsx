import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, ArrowRight, Star, Sparkles } from 'lucide-react';
import { AuthContext } from '../App';

function Home() {
  const { user } = useContext(AuthContext);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/jobs/')
      .then(res => res.json())
      .then(data => setJobs(data))
      .catch(err => console.error("Error fetching jobs:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
        <div className="pulse-spinner" style={{ margin: '0 auto' }}>AI</div>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Fetching open vacancies...</p>
      </div>
    );
  }

  return (
    <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem', paddingBottom: '6rem' }}>
      
      {/* Platform Features Navigator */}
      <div style={{ marginBottom: '4rem', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <Sparkles size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>AI Career Suite Nav</h2>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1.5rem'
        }}>
          {((user?.is_recruiter) ? [
            {
              title: "Recruitment Dashboard 💼",
              description: "Manage candidate pipelines, post new jobs, and adjust shortlisting ATS weights.",
              path: "/hr",
              icon: "💼",
              color: "linear-gradient(135deg, rgba(79, 70, 229, 0.04) 0%, rgba(139, 92, 246, 0.04) 100%)"
            },
            {
              title: "Opportunities View 🏢",
              description: "Review current job openings published to the candidate portal.",
              path: "/jobs",
              icon: "🏢",
              color: "linear-gradient(135deg, rgba(59, 130, 246, 0.04) 0%, rgba(99, 102, 241, 0.04) 100%)"
            }
          ] : [
            {
              title: "AI Interview Arena ⚡",
              description: "Practice mock interviews with dynamic visual and voice analysis scoring.",
              path: "/practice",
              icon: "⚡",
              color: "linear-gradient(135deg, rgba(139, 92, 246, 0.04) 0%, rgba(192, 132, 252, 0.04) 100%)"
            },
            {
              title: "ATS Scorer & AI Resume Editor 🎯",
              description: "Score resume keywords and edit details via checkbox fixes or conversational chatbot.",
              path: "/ats-scorer",
              icon: "🎯",
              color: "linear-gradient(135deg, rgba(59, 130, 246, 0.04) 0%, rgba(99, 102, 241, 0.04) 100%)"
            },
            {
              title: "Applications & Profile 👤",
              description: "Track submitted applications, proctoring transcripts, and performance results.",
              path: "/profile",
              icon: "👤",
              color: "linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(5, 150, 105, 0.04) 100%)"
            },
            {
              title: "Jobs Explorer 🏢",
              description: "Browse vacancies, view proctor settings, and test job threshold eligibility.",
              path: "/jobs",
              icon: "🏢",
              color: "linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, rgba(217, 119, 6, 0.04) 100%)"
            }
          ]).map((feat, idx) => (
            <div 
              key={idx}
              className="glass-panel"
              onClick={() => navigate(feat.path)}
              style={{
                padding: '2rem 1.75rem',
                cursor: 'pointer',
                background: feat.color,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                justifyContent: 'space-between',
                height: '100%'
              }}
            >
              <div>
                <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.75rem' }}>{feat.icon}</span>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>
                  {feat.title}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
                  {feat.description}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', marginTop: '0.5rem' }}>
                Launch Feature <ArrowRight size={14} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="dashboard-header">
        <h2 className="dashboard-title">Open Opportunities</h2>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Showing <strong style={{ color: 'var(--text-main)' }}>{jobs.length}</strong> available jobs
        </span>
      </div>

      {jobs.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏢</div>
          <h3>No jobs posted yet</h3>
          <p style={{ color: 'var(--text-muted)' }}>Please check back later or contact your recruiter.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {jobs.map((job) => (
            <div key={job.id} className="glass-panel responsive-job-card" style={{ padding: '2rem' }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>{job.title}</h3>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.5rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                    💼 {job.experience}
                  </span>
                </div>
                
                <h4 style={{ fontSize: '1rem', color: 'var(--accent)', fontWeight: 600, margin: '0 0 1rem 0' }}>🏢 {job.company}</h4>
                
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  {job.description}
                </p>

                {/* Skills tags */}
                {job.required_skills && job.required_skills.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Required Skills:</span>
                    {job.required_skills.map((skill, idx) => (
                      <span key={idx} style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', backgroundColor: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.15)', color: 'var(--accent)', borderRadius: '4px', fontWeight: 500 }}>
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'stretch' }}>
                {/* ATS Match score threshold indicator */}
                <div style={{ padding: '0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', textAlign: 'center' }}>
                  🎯 ATS Threshold: <strong>{job.ats_threshold}%</strong>
                </div>
                
                <button className="btn btn-primary" onClick={() => navigate(`/apply/${job.id}`)}>
                  Apply Now <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Home;
