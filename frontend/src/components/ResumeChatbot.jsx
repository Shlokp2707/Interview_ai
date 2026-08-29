import React, { useState, useEffect, useContext } from 'react';
import { 
  Bot, X, Send, RefreshCw, FileText, Sparkles, Zap, MessageSquare, CheckCircle2 
} from 'lucide-react';
import { AuthContext } from '../App';

function ResumeChatbot() {
  const { user } = useContext(AuthContext);
  const isRecruiter = user?.is_recruiter;

  const [isOpen, setIsOpen] = useState(false);
  const [activeAnalysis, setActiveAnalysis] = useState(null);
  const [chatInstruction, setChatInstruction] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState('');

  const parseJsonResponse = async (res, defaultErrorMsg) => {
    const contentType = res.headers.get("content-type");
    const isJson = contentType && contentType.includes("application/json");

    if (!res.ok) {
      if (isJson) {
        const data = await res.json();
        throw new Error(data.error || data.detail || defaultErrorMsg);
      } else {
        const text = await res.text();
        console.error(`HTTP ${res.status} non-JSON error:`, text);
        if (res.status === 404) {
          throw new Error("Service endpoint not found (404). Please refresh and try again.");
        } else if (res.status === 401) {
          throw new Error("Session expired or authentication required. Please log in.");
        } else if (res.status === 403) {
          throw new Error("Access denied (403).");
        } else {
          throw new Error(`Server error (${res.status}). Please try again later.`);
        }
      }
    }

    if (isJson) {
      return await res.json();
    }
    throw new Error("Invalid response format received from server.");
  };

  const fetchLatestAnalysis = () => {
    if (isRecruiter) return;
    fetch('/api/ats/history/')
      .then(res => {
        if (!res.ok) throw new Error("Could not load history");
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return res.json();
        }
        return [];
      })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setActiveAnalysis(data[0]);
        } else {
          setActiveAnalysis(null);
        }
      })
      .catch(err => console.error("Error fetching analysis history:", err));
  };

  useEffect(() => {
    fetchLatestAnalysis();
  }, [isRecruiter]);

  const handleApplyRecruiterData = (details) => {
    window.dispatchEvent(new CustomEvent('apply-recruiter-assistant-data', {
      detail: {
        description: details.description,
        skills: details.skills,
        customQuestions: details.customQuestions
      }
    }));
    
    // Add confirmation message to chat
    setChatMessages(prev => [...prev, {
      sender: 'bot',
      text: "✓ Subh AI applied your job details and custom questions directly to the HR form!"
    }]);
  };

  const handleQuickChip = (promptText) => {
    setChatInstruction(promptText);
  };

  const handleChatFix = (e, customText = null) => {
    if (e) e.preventDefault();
    const userPrompt = (customText || chatInstruction).trim();
    if (!userPrompt) return;

    setChatInstruction('');
    setChatLoading(true);

    // Add user message to history
    setChatMessages(prev => [...prev, { sender: 'user', text: userPrompt }]);

    const lowerPrompt = userPrompt.toLowerCase();
    const hasAnalysis = Boolean(activeAnalysis && activeAnalysis.id);

    // Only route to resume PDF editor if activeAnalysis.id exists AND user explicitly asks to edit resume
    const isExplicitResumeEdit = hasAnalysis && (
      lowerPrompt.includes('resume') || 
      lowerPrompt.includes('bullet') || 
      lowerPrompt.includes('ats') || 
      lowerPrompt.includes('score') || 
      lowerPrompt.includes('pdf') ||
      lowerPrompt.includes('edit resume') ||
      lowerPrompt.includes('fix resume') ||
      lowerPrompt.includes('rephrase')
    );

    if (isRecruiter) {
      // Recruiter helper chat flow
      const stages = [
        "Subh AI is analyzing prompt...",
        "Drafting recruitment specs...",
        "Formulating targeted questions...",
        "Finalizing payload parameters..."
      ];
      let stageIdx = 0;
      setChatStatus(stages[0]);
      const timer = setInterval(() => {
        if (stageIdx < stages.length - 1) {
          stageIdx++;
          setChatStatus(stages[stageIdx]);
        }
      }, 1200);

      const jdElem = document.getElementById('role-desc');
      const skillsElem = document.getElementById('req-skills');
      
      const current_jd = jdElem ? jdElem.value : '';
      const current_skills = skillsElem ? skillsElem.value : '';
      const qElems = document.querySelectorAll('input[placeholder*="Can you explain"]');
      const current_questions = Array.from(qElems).map(el => el.value).filter(val => val.trim() !== '');

      fetch('/api/recruiter/helper-chat/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_instruction: userPrompt,
          current_jd,
          current_skills,
          current_questions
        })
      })
        .then(res => {
          clearInterval(timer);
          return parseJsonResponse(res, "Failed to process recruiter request");
        })
        .then(data => {
          setChatLoading(false);
          setChatMessages(prev => [...prev, { 
            sender: 'bot', 
            text: data.message,
            details: {
              description: data.job_description,
              skills: data.required_skills,
              customQuestions: data.custom_questions
            }
          }]);
        })
        .catch(err => {
          clearInterval(timer);
          setChatLoading(false);
          setChatMessages(prev => [...prev, { 
            sender: 'bot', 
            text: `❌ Error: ${err.message || "Subh AI encountered an issue processing your request."}`, 
            isError: true 
          }]);
        });

    } else if (isExplicitResumeEdit && hasAnalysis) {
      // Candidate resume editing flow (only when valid activeAnalysis.id exists)
      const stages = [
        "Subh AI reading resume schema...",
        "Applying bullet fixes & skill keywords...",
        "Re-indexing formatting metrics...",
        "Generating updated resume PDF..."
      ];
      let stageIdx = 0;
      setChatStatus(stages[0]);
      const timer = setInterval(() => {
        if (stageIdx < stages.length - 1) {
          stageIdx++;
          setChatStatus(stages[stageIdx]);
        }
      }, 1500);

      fetch(`/api/ats/analysis/${activeAnalysis.id}/chat-fix/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_instruction: userPrompt })
      })
        .then(res => {
          clearInterval(timer);
          return parseJsonResponse(res, "Failed to edit resume");
        })
        .then(data => {
          setChatLoading(false);
          setActiveAnalysis(data);
          setChatMessages(prev => [...prev, { 
            sender: 'bot', 
            text: `✨ Subh AI successfully updated your resume! "${userPrompt}". Download your updated PDF below!`
          }]);
        })
        .catch(err => {
          clearInterval(timer);
          setChatLoading(false);
          setChatMessages(prev => [...prev, { 
            sender: 'bot', 
            text: `❌ Error: ${err.message || "Failed to apply edits."}`, 
            isError: true 
          }]);
        });

    } else {
      // Profile updates, career questions & general bot assistant flow
      const stages = [
        "Subh AI reading profile context...",
        "Applying profile fields & skills...",
        "Syncing updates with database..."
      ];
      let stageIdx = 0;
      setChatStatus(stages[0]);
      const timer = setInterval(() => {
        if (stageIdx < stages.length - 1) {
          stageIdx++;
          setChatStatus(stages[stageIdx]);
        }
      }, 1000);

      fetch('/api/auth/profile-chat/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_instruction: userPrompt })
      })
        .then(res => {
          clearInterval(timer);
          return parseJsonResponse(res, "Failed to update profile");
        })
        .then(data => {
          setChatLoading(false);
          setChatMessages(prev => [...prev, { 
            sender: 'bot', 
            text: `✨ ${data.message || "Profile updated successfully!"}`,
            showProfileBtn: true
          }]);
        })
        .catch(err => {
          clearInterval(timer);
          setChatLoading(false);
          setChatMessages(prev => [...prev, { 
            sender: 'bot', 
            text: `❌ Error: ${err.message || "Failed to execute profile command."}`, 
            isError: true 
          }]);
        });
    }
  };

  return (
    <>
      {/* Floating Vibrant Launcher Button - Bottom Right */}
      <button
        className="subh-fab"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchLatestAnalysis();
        }}
        title="Subh AI - Career & Profile Assistant"
      >
        <span className="subh-pulse-badge"></span>
        {isOpen ? <X size={26} /> : <Bot size={30} />}
      </button>

      {/* Floating Subh AI Window */}
      {isOpen && (
        <div
          className="glass-panel"
          style={{
            position: 'fixed',
            bottom: '6.5rem',
            right: '2rem',
            zIndex: 99999,
            width: '390px',
            maxWidth: 'calc(100vw - 2.5rem)',
            maxHeight: '580px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '1.25rem',
            boxShadow: '0 20px 50px rgba(79, 70, 229, 0.25), 0 0 20px rgba(168, 85, 247, 0.15)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: 'var(--radius-lg)',
            animation: 'fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            background: 'var(--panel-bg)',
            backdropFilter: 'blur(20px)'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f46e5, #9333ea, #ec4899)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(147, 51, 234, 0.3)'
              }}>
                <Zap size={18} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <strong style={{ fontSize: '1.05rem', background: 'linear-gradient(135deg, var(--primary), var(--accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800 }}>
                    Subh AI ⚡
                  </strong>
                  <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 700 }}>
                    ONLINE
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {isRecruiter ? "Talent & Job Creation Assistant" : "AI Career & Profile Assistant"}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {!isRecruiter && (
                <button 
                  onClick={fetchLatestAnalysis}
                  style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '0.35rem', borderRadius: '50%' }}
                  title="Sync Latest Resume & Profile"
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <button 
                onClick={() => setIsOpen(false)}
                style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '0.35rem', borderRadius: '50%' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Quick Action Suggestion Chips */}
          <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.2rem', scrollbarWidth: 'none' }}>
            {isRecruiter ? (
              <>
                <button className="subh-chip" onClick={() => handleQuickChip("Draft a job description for Senior Backend Engineer")}>
                  💼 Draft Backend JD
                </button>
                <button className="subh-chip" onClick={() => handleQuickChip("Suggest 3 React state management interview questions")}>
                  ⚡ 3 React Questions
                </button>
                <button className="subh-chip" onClick={() => handleQuickChip("Define key required skills for AI Engineer")}>
                  🎯 AI Engineer Skills
                </button>
              </>
            ) : (
              <>
                <button className="subh-chip" onClick={() => handleQuickChip("Add Python, React, and PostgreSQL to my profile skills")}>
                  ⚡ Add Tech Skills
                </button>
                <button className="subh-chip" onClick={() => handleQuickChip("Sync my profile details with my latest resume")}>
                  🔄 Sync Profile
                </button>
                <button className="subh-chip" onClick={() => handleQuickChip("Update my phone number to +1 (555) 019-2834")}>
                  📱 Update Phone
                </button>
              </>
            )}
          </div>

          {/* Body Content */}
          {isRecruiter ? (
            <>
              {/* Recruiter helper context banner */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', backgroundColor: 'rgba(79, 70, 229, 0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(79, 70, 229, 0.15)' }}>
                <Sparkles size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-main)', lineHeight: 1.35 }}>
                  Ask <strong>Subh AI</strong> to craft JDs or custom questions, then click <strong>Apply to Job Form</strong>!
                </div>
              </div>

              {/* Chat message logs */}
              <div style={{
                flexGrow: 1,
                minHeight: '220px',
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid var(--panel-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.85rem',
                backgroundColor: 'rgba(0,0,0,0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}>
                {chatMessages.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', textAlign: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '45px', height: '45px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary), var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                      <Zap size={22} />
                    </div>
                    <div style={{ color: 'var(--text-main)', fontSize: '0.88rem', fontWeight: 700 }}>
                      Hello Recruiter! I'm Subh AI ⚡
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.45 }}>
                      Ask me to write high-converting job descriptions or custom AI interview questions for your postings.
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div key={idx} style={{
                      alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                      display: 'flex',
                      gap: '0.5rem',
                      maxWidth: '88%'
                    }}>
                      {msg.sender === 'bot' && (
                        <div style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #4f46e5, #9333ea)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)'
                        }}>
                          <Zap size={14} />
                        </div>
                      )}
                      <div style={{
                        backgroundColor: msg.sender === 'user' ? 'var(--primary)' : 'var(--panel-bg)',
                        color: msg.sender === 'user' ? '#fff' : 'var(--text-main)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.65rem 0.85rem',
                        fontSize: '0.82rem',
                        lineHeight: 1.45,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '0.35rem'
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                        {msg.details && (msg.details.description || msg.details.skills || (msg.details.customQuestions && msg.details.customQuestions.length > 0)) && (
                          <button
                            onClick={() => handleApplyRecruiterData(msg.details)}
                            className="btn btn-primary"
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.4rem 0.75rem',
                              marginTop: '0.35rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              borderRadius: 'var(--radius-sm)'
                            }}
                          >
                            <Sparkles size={13} /> Apply to Job Form
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Submit instruction input */}
              {chatLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem 0', gap: '0.5rem' }}>
                  <RefreshCw size={20} style={{ color: 'var(--accent)', animation: 'spin 2s linear infinite' }} />
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 600 }}>
                    {chatStatus}
                  </span>
                </div>
              ) : (
                <form onSubmit={handleChatFix} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    value={chatInstruction}
                    onChange={(e) => setChatInstruction(e.target.value)}
                    placeholder="Ask Subh AI..."
                    style={{
                      flexGrow: 1,
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.65rem 0.85rem',
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                      outline: 'none'
                    }}
                  />
                  <button 
                    type="submit" 
                    disabled={!chatInstruction.trim()}
                    className="btn btn-primary"
                    style={{ 
                      padding: '0 0.9rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      borderRadius: 'var(--radius-sm)',
                      opacity: !chatInstruction.trim() ? 0.5 : 1,
                      cursor: !chatInstruction.trim() ? 'default' : 'pointer'
                    }}
                  >
                    <Send size={15} />
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              {/* Active candidate profile & resume context banner */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', backgroundColor: 'rgba(139, 92, 246, 0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                <div style={{ minWidth: 0, flexGrow: 1 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Candidate Profile</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.username || "Candidate Profile"}
                  </div>
                </div>
                <a 
                  href="/profile" 
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', textDecoration: 'none' }}
                  onClick={() => setIsOpen(false)}
                >
                  👤 Profile Page
                </a>
              </div>

              {/* Chat message logs */}
              <div style={{
                flexGrow: 1,
                minHeight: '220px',
                maxHeight: '300px',
                overflowY: 'auto',
                border: '1px solid var(--panel-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.85rem',
                backgroundColor: 'rgba(0,0,0,0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}>
                {chatMessages.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', textAlign: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '45px', height: '45px', borderRadius: '50%', background: 'linear-gradient(135deg, #4f46e5, #9333ea, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                      <Zap size={22} />
                    </div>
                    <div style={{ color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 700 }}>
                      Hi {user?.username || 'candidate'}! I'm Subh AI ⚡
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.45 }}>
                      Tell me what you'd like to update (e.g. <em>"Add Python and React to my skills"</em>, <em>"Update my phone number"</em>, or <em>"Sync profile with my resume"</em>).
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div key={idx} style={{
                      alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                      display: 'flex',
                      gap: '0.5rem',
                      maxWidth: '88%'
                    }}>
                      {msg.sender === 'bot' && (
                        <div style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #4f46e5, #9333ea)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)'
                        }}>
                          <Zap size={14} />
                        </div>
                      )}
                      <div style={{
                        backgroundColor: msg.sender === 'user' ? 'var(--primary)' : 'var(--panel-bg)',
                        color: msg.sender === 'user' ? '#fff' : 'var(--text-main)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.65rem 0.85rem',
                        fontSize: '0.82rem',
                        lineHeight: 1.45,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '0.35rem'
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                        {msg.showProfileBtn && (
                          <a
                            href="/profile"
                            onClick={() => setIsOpen(false)}
                            className="btn btn-secondary btn-sm"
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.35rem 0.65rem',
                              marginTop: '0.25rem',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            👤 View My Profile
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Submit instruction input */}
              {chatLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem 0', gap: '0.5rem' }}>
                  <RefreshCw size={20} style={{ color: 'var(--accent)', animation: 'spin 2s linear infinite' }} />
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 600 }}>
                    {chatStatus}
                  </span>
                </div>
              ) : (
                <form onSubmit={handleChatFix} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    value={chatInstruction}
                    onChange={(e) => setChatInstruction(e.target.value)}
                    placeholder="Ask Subh AI to update profile or edit resume..."
                    style={{
                      flexGrow: 1,
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.65rem 0.85rem',
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                      outline: 'none'
                    }}
                  />
                  <button 
                    type="submit" 
                    disabled={!chatInstruction.trim()}
                    className="btn btn-primary"
                    style={{ 
                      padding: '0 0.9rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      borderRadius: 'var(--radius-sm)',
                      opacity: !chatInstruction.trim() ? 0.5 : 1,
                      cursor: !chatInstruction.trim() ? 'default' : 'pointer'
                    }}
                  >
                    <Send size={15} />
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

export default ResumeChatbot;
