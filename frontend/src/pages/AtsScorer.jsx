import React, { useState, useEffect } from 'react';
import { 
  Upload, FileText, Check, AlertTriangle, AlertCircle, Sparkles, 
  ChevronRight, History, Award, BookOpen, PenTool, Type, FileCheck, 
  Layers, RefreshCw, HelpCircle, ArrowRight, CornerDownRight, Send, MessageSquare
} from 'lucide-react';

function AtsScorer() {
  const [resume, setResume] = useState(null);
  const [targetRole, setTargetRole] = useState('');
  const [targetJd, setTargetJd] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixMessage, setFixMessage] = useState('');
  const [aligning, setAligning] = useState(false);
  const [alignMessage, setAlignMessage] = useState('');
  
  // Scanned analyses lists
  const [history, setHistory] = useState([]);
  const [activeAnalysis, setActiveAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState('formatting'); // 'formatting', 'font', 'content', 'grammar', 'word_choice'
  const [selectedIssues, setSelectedIssues] = useState({});
  const [chatInstruction, setChatInstruction] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState('');

  useEffect(() => {
    if (activeAnalysis && activeAnalysis.feedback_details) {
      const initialSelected = {};
      const categories = ['formatting', 'font', 'content', 'grammar', 'word_choice'];
      categories.forEach(cat => {
        const issues = activeAnalysis.feedback_details[cat] || [];
        issues.forEach((_, idx) => {
          initialSelected[`${cat}-${idx}`] = true;
        });
      });
      setSelectedIssues(initialSelected);
    } else {
      setSelectedIssues({});
    }
  }, [activeAnalysis]);

  const handleToggleAllInTab = (approve) => {
    if (!activeAnalysis || !activeAnalysis.feedback_details) return;
    const issues = activeAnalysis.feedback_details[activeTab] || [];
    setSelectedIssues(prev => {
      const next = { ...prev };
      issues.forEach((_, idx) => {
        next[`${activeTab}-${idx}`] = approve;
      });
      return next;
    });
  };

  const handleChatFix = (e) => {
    e.preventDefault();
    if (!chatInstruction.trim() || !activeAnalysis) return;

    const userPrompt = chatInstruction.trim();
    setChatInstruction('');
    setChatLoading(true);
    setError('');

    // Add user message to history
    setChatMessages(prev => [...prev, { sender: 'user', text: userPrompt }]);

    const stages = [
      "Reading current resume JSON...",
      "Applying your custom instructions...",
      "Re-organizing resume structure...",
      "Selecting matching typography...",
      "Drawing updated PDF pages...",
      "Compiling and storing corrected PDF resume..."
    ];
    let stageIdx = 0;
    setChatStatus(stages[0]);
    const timer = setInterval(() => {
      if (stageIdx < stages.length - 1) {
        stageIdx++;
        setChatStatus(stages[stageIdx]);
      }
    }, 2000);

    if (!activeAnalysis || !activeAnalysis.id) {
      setChatLoading(false);
      setChatMessages(prev => [...prev, { 
        sender: 'bot', 
        text: "❌ Please analyze or select a resume first before requesting resume edits.", 
        isError: true 
      }]);
      return;
    }

    fetch(`/api/ats/analysis/${activeAnalysis.id}/chat-fix/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_instruction: userPrompt })
    })
      .then(async res => {
        clearInterval(timer);
        const contentType = res.headers.get("content-type");
        const isJson = contentType && contentType.includes("application/json");
        if (!res.ok) {
          if (isJson) {
            const data = await res.json();
            throw new Error(data.error || data.detail || "Failed to edit resume");
          } else {
            throw new Error(`Server error (${res.status}).`);
          }
        }
        if (isJson) return res.json();
        throw new Error("Received non-JSON response.");
      })
      .then(data => {
        setChatLoading(false);
        setActiveAnalysis(data);
        fetchHistory(); // refresh list
        setChatMessages(prev => [...prev, { 
          sender: 'bot', 
          text: `✨ Successfully updated your resume based on: "${userPrompt}". Your new PDF is ready to download!`
        }]);
      })
      .catch(err => {
        clearInterval(timer);
        setChatLoading(false);
        setError(err.message || "An error occurred during conversational resume correction.");
        setChatMessages(prev => [...prev, { 
          sender: 'bot', 
          text: `❌ Error: ${err.message || "Failed to apply edits."}`, 
          isError: true 
        }]);
      });
  };

  // Fetch history on load
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = () => {
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
        setHistory(data);
        if (Array.isArray(data) && data.length > 0 && !activeAnalysis) {
          setActiveAnalysis(data[0]);
        }
      })
      .catch(err => console.error("Error fetching history:", err));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError("Only PDF resumes are supported.");
      return;
    }
    setResume(file);
    setError('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!resume) {
      setError("Please select a PDF resume to analyze.");
      return;
    }

    setLoading(true);
    setError('');
    
    // Animate scanner stage descriptions
    const stages = [
      "Uploading PDF document data...",
      "Extracting text spans and hierarchy...",
      "Running PyMuPDF visual inspection (fonts, sizes, colors)...",
      "Analyzing layout spacing, margins and page length...",
      "Checking typography consistency...",
      "Evaluating action verbs and content metrics...",
      "Scanning spelling and grammatical accuracy...",
      "Auditing buzzwords, tone and vocabulary choice...",
      "Generating detailed score parameters...",
      "Saving audit report parameters..."
    ];
    let stageIdx = 0;
    setStatusMessage(stages[0]);
    const timer = setInterval(() => {
      if (stageIdx < stages.length - 1) {
        stageIdx++;
        setStatusMessage(stages[stageIdx]);
      }
    }, 1500);

    const formData = new FormData();
    formData.append("resume", resume);
    if (targetRole) formData.append("target_role", targetRole);
    if (targetJd) formData.append("target_jd", targetJd);

    fetch('/api/ats/analyze/', {
      method: 'POST',
      body: formData
    })
      .then(res => {
        clearInterval(timer);
        if (!res.ok) {
          return res.json().then(data => { throw new Error(data.error || "Analysis failed") });
        }
        return res.json();
      })
      .then(data => {
        setLoading(false);
        setActiveAnalysis(data);
        setResume(null);
        setTargetRole('');
        setTargetJd('');
        fetchHistory(); // refresh list
      })
      .catch(err => {
        clearInterval(timer);
        setLoading(false);
        setError(err.message || "An error occurred during analysis.");
      });
  };

  const handleFixResume = (analysisId) => {
    if (!activeAnalysis) return;
    
    setFixing(true);
    setError('');
    
    const stages = [
      "Reading original resume audit findings...",
      "Correcting spelling mistakes and grammatical syntax...",
      "Refining word choices and converting passive phrases...",
      "Structuring resume content sections...",
      "Selecting matching font styles...",
      "Formatting margins and layout dimensions...",
      "Drawing professional PDF document flowables...",
      "Compiling and storing corrected PDF resume..."
    ];
    let stageIdx = 0;
    setFixMessage(stages[0]);
    const timer = setInterval(() => {
      if (stageIdx < stages.length - 1) {
        stageIdx++;
        setFixMessage(stages[stageIdx]);
      }
    }, 2000);

    // Build the approved_issues object
    const approved_issues = {};
    const categories = ['formatting', 'font', 'content', 'grammar', 'word_choice'];
    categories.forEach(cat => {
      const issues = activeAnalysis.feedback_details[cat] || [];
      approved_issues[cat] = issues.filter((_, idx) => selectedIssues[`${cat}-${idx}`] !== false);
    });

    fetch(`/api/ats/analysis/${analysisId}/fix/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ approved_issues })
    })
      .then(res => {
        clearInterval(timer);
        if (!res.ok) {
          return res.json().then(data => { throw new Error(data.error || "Failed to fix resume") });
        }
        return res.json();
      })
      .then(data => {
        setFixing(false);
        setActiveAnalysis(data);
        fetchHistory(); // refresh list
      })
      .catch(err => {
        clearInterval(timer);
        setFixing(false);
        setError(err.message || "An error occurred during resume auto-correction.");
      });
  };

  const handleAutoAlignResume = () => {
    if (!activeAnalysis) return;
    setAligning(true);
    setAlignMessage("Analyzing Job Description keywords...");

    const stages = [
      "Analyzing Job Description keywords...",
      "Re-ordering technology stack to match...",
      "Improving action verbs in experience details...",
      "Removing clichés and buzzwords...",
      "Drawing updated PDF pages...",
      "Compiling aligned PDF resume..."
    ];
    let stageIdx = 0;
    const timer = setInterval(() => {
      if (stageIdx < stages.length - 1) {
        stageIdx++;
        setAlignMessage(stages[stageIdx]);
      }
    }, 2000);

    fetch('/api/ats/auto-align/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resume_text: activeAnalysis.resume_text,
        target_jd: activeAnalysis.target_jd || "General professional standards"
      })
    })
      .then(res => {
        clearInterval(timer);
        if (!res.ok) {
          throw new Error("Failed to auto-align resume");
        }
        return res.blob();
      })
      .then(blob => {
        setAligning(false);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Aligned_Resume_${activeAnalysis.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(err => {
        clearInterval(timer);
        setAligning(false);
        setError(err.message || "An error occurred during resume alignment.");
      });
  };

  const loadPastAnalysis = (id) => {
    fetch(`/api/ats/analysis/${id}/`)
      .then(res => {
        if (!res.ok) throw new Error("Could not load details");
        return res.json();
      })
      .then(data => {
        setActiveAnalysis(data);
      })
      .catch(err => setError(err.message));
  };

  const getScoreColor = (score) => {
    if (score >= 80) return 'var(--success)';
    if (score >= 50) return 'var(--warning)';
    return 'var(--danger)';
  };

  const getScoreRating = (score) => {
    if (score >= 80) return 'Optimal';
    if (score >= 60) return 'Average';
    return 'Action Needed';
  };

  const getSeverityStyle = (severity) => {
    switch (severity.toLowerCase()) {
      case 'high':
        return { color: 'var(--danger)', bg: 'var(--danger-glow)', border: 'rgba(239, 68, 68, 0.2)' };
      case 'medium':
        return { color: 'var(--warning)', bg: 'var(--warning-glow)', border: 'rgba(245, 158, 11, 0.2)' };
      default:
        return { color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.1)', border: 'rgba(96, 165, 250, 0.2)' };
    }
  };

  const startNewScan = () => {
    setActiveAnalysis(null);
    setResume(null);
    setError('');
  };

  // Extract variables safely
  const details = activeAnalysis?.feedback_details || {};
  const formattingIssues = details.formatting || [];
  const fontIssues = details.font || [];
  const contentIssues = details.content || [];
  const grammarIssues = details.grammar || [];
  const wordChoiceIssues = details.word_choice || [];
  const strengths = details.strengths || [];
  const summary = details.summary || '';

  const activeIssues = (() => {
    switch (activeTab) {
      case 'formatting': return formattingIssues;
      case 'font': return fontIssues;
      case 'content': return contentIssues;
      case 'grammar': return grammarIssues;
      case 'word_choice': return wordChoiceIssues;
      default: return [];
    }
  })();

  const tabLabels = [
    { id: 'formatting', label: 'Formatting & Layout', count: formattingIssues.length, icon: Layers },
    { id: 'font', label: 'Font & Typography', count: fontIssues.length, icon: Type },
    { id: 'content', label: 'Content & Impact', count: contentIssues.length, icon: BookOpen },
    { id: 'grammar', label: 'Grammar & Style', count: grammarIssues.length, icon: PenTool },
    { id: 'word_choice', label: 'Word Choice', count: wordChoiceIssues.length, icon: FileCheck },
  ];

  if (loading) {
    return (
      <div className="container" style={{ minHeight: 'calc(100vh - 70px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="glass-panel scan-loader" style={{ maxWidth: '500px', width: '100%', padding: '3rem 2rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          {/* Animated scanner laser bar */}
          <div className="scanner-line"></div>
          
          <div className="pulse-spinner" style={{ margin: '0 auto 1.5rem auto' }}>
            <Sparkles size={32} style={{ color: 'var(--accent)', animation: 'spin 4s linear infinite' }} />
          </div>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.5rem 0' }}>AI ATS Audit In Progress</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '2rem' }}>
            Our auditor is scanning your resume structure, checking fonts, inspecting spelling mistakes, and auditing vocabulary parameters.
          </p>
          <div style={{ padding: '0.8rem 1.2rem', backgroundColor: 'rgba(139, 92, 246, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(139, 92, 246, 0.15)', fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>
            {statusMessage}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container animate-fade-in" style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Title Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="ats-title" style={{ fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
            ATS Resume Auditor 🎯
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0 0', fontSize: '0.95rem' }}>
            Upload your resume, find formatting or font mistakes, check grammar and word choices, and improve your score.
          </p>
        </div>
        {activeAnalysis && (
          <button className="btn btn-primary" onClick={startNewScan}>
            <RefreshCw size={16} /> Audit New Resume
          </button>
        )}
      </div>

      <div className="ats-layout">
        
        {/* SIDEBAR: History (Only visible if history exists) */}
        {history.length > 0 && (
          <div className="glass-panel ats-sidebar">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)' }}>
              <History size={16} style={{ color: 'var(--accent)' }} /> Audit History
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: '550px', paddingRight: '4px' }}>
              {history.map((item) => {
                const isActive = activeAnalysis?.id === item.id;
                const scoreColor = getScoreColor(item.overall_score);
                const formattedDate = new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                return (
                  <div 
                    key={item.id} 
                    onClick={() => loadPastAnalysis(item.id)}
                    className="glass-panel"
                    style={{ 
                      padding: '0.9rem', 
                      cursor: 'pointer', 
                      borderColor: isActive ? 'var(--primary)' : 'var(--panel-border)',
                      backgroundColor: isActive ? 'rgba(139, 92, 246, 0.05)' : 'rgba(255, 255, 255, 0.01)',
                      transition: 'all 0.2s ease',
                      transform: isActive ? 'scale(1.02)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', display: 'block', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.target_role || 'General Audit'}
                      </span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, color: scoreColor }}>
                        {Math.round(item.overall_score)}%
                      </span>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      📅 {formattedDate}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MAIN PANEL */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* STATE 1: Audit Form (Upload Resume) */}
          {!activeAnalysis && (
            <div className="glass-panel animate-fade-in ats-form-panel" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Upload & Analyze Resume</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0 0' }}>
                  Analyze typography spacing, font style consistency, metric indicators, grammar rules and buzzwords.
                </p>
              </div>

              {error && (
                <div style={{ padding: '0.8rem 1rem', backgroundColor: 'var(--danger-glow)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={16} /> {error}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* PDF Dropzone */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Select Resume (PDF format only) *</label>
                  <label className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem', cursor: 'pointer', borderStyle: 'dashed', borderColor: resume ? 'var(--success)' : 'var(--panel-border)', backgroundColor: 'rgba(255,255,255,0.01)', transition: 'all 0.3s ease' }}>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                      required
                    />
                    <Upload size={36} style={{ color: resume ? 'var(--success)' : 'var(--text-muted)', marginBottom: '0.75rem' }} />
                    <span style={{ fontSize: '1rem', fontWeight: 600, color: resume ? 'var(--success)' : 'var(--text-main)' }}>
                      {resume ? resume.name : "Select PDF Document"}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                      Drag & drop your file or click to browse
                    </span>
                  </label>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="role">Target Job Title / Role (Optional)</label>
                    <input
                      type="text"
                      id="role"
                      className="form-input"
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      placeholder="e.g. Frontend Engineer, Product Analyst"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="jd">Target Job Description (Optional but recommended)</label>
                    <textarea
                      id="jd"
                      className="form-input"
                      rows={4}
                      value={targetJd}
                      onChange={(e) => setTargetJd(e.target.value)}
                      placeholder="Paste the recruiter's Job Description requirements to test your resume alignment details..."
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '1rem', fontSize: '1rem', marginTop: '1rem' }}
                >
                  Start Professional ATS Audit <ArrowRight size={18} />
                </button>
              </form>
            </div>
          )}

          {/* STATE 2: Display Active Audit Results */}
          {activeAnalysis && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* HERO METRICS SCORE ROW */}
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                
                {/* Circle Meter Gauge Card */}
                <div className="glass-panel ats-metrics-card">
                  <div style={{ position: 'relative', width: '130px', height: '130px' }}>
                    <svg style={{ transform: 'rotate(-90deg)', width: '130px', height: '130px' }}>
                      <circle
                        cx="65"
                        cy="65"
                        r="54"
                        fill="transparent"
                        stroke="rgba(255, 255, 255, 0.05)"
                        strokeWidth="10"
                      />
                      <circle
                        cx="65"
                        cy="65"
                        r="54"
                        fill="transparent"
                        stroke={getScoreColor(activeAnalysis.overall_score)}
                        strokeWidth="10"
                        strokeDasharray={339.3}
                        strokeDashoffset={339.3 - (339.3 * activeAnalysis.overall_score) / 100}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
                      />
                    </svg>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                      <span style={{ fontSize: '2.1rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1 }}>
                        {Math.round(activeAnalysis.overall_score)}%
                      </span>
                      <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: '0.2rem', fontWeight: 600 }}>
                        ATS Ready
                      </span>
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '1px', fontWeight: 700 }}>
                      Audited Score Rating
                    </span>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0.1rem 0', color: getScoreColor(activeAnalysis.overall_score) }}>
                      {getScoreRating(activeAnalysis.overall_score)}
                    </h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Target: {activeAnalysis.target_role || 'General standards'}
                    </span>
                  </div>
                </div>

                {/* Sub-Scores mini-bars panel */}
                <div className="glass-panel ats-subscores-card">
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                    Core Category Breakdowns
                  </h4>
                  
                  {/* Formatting score */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                      <span>Structure & Formatting</span>
                      <span style={{ color: getScoreColor(activeAnalysis.formatting_score) }}>{Math.round(activeAnalysis.formatting_score)}%</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${activeAnalysis.formatting_score}%`, height: '100%', backgroundColor: getScoreColor(activeAnalysis.formatting_score), transition: 'width 1s ease' }}></div>
                    </div>
                  </div>

                  {/* Font score */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                      <span>Font & Typography</span>
                      <span style={{ color: getScoreColor(activeAnalysis.font_score) }}>{Math.round(activeAnalysis.font_score)}%</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${activeAnalysis.font_score}%`, height: '100%', backgroundColor: getScoreColor(activeAnalysis.font_score), transition: 'width 1s ease' }}></div>
                    </div>
                  </div>

                  {/* Content score */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                      <span>Content & Achievements</span>
                      <span style={{ color: getScoreColor(activeAnalysis.content_score) }}>{Math.round(activeAnalysis.content_score)}%</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${activeAnalysis.content_score}%`, height: '100%', backgroundColor: getScoreColor(activeAnalysis.content_score), transition: 'width 1s ease' }}></div>
                    </div>
                  </div>

                  {/* Grammar score */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                      <span>Grammar & Spelling</span>
                      <span style={{ color: getScoreColor(activeAnalysis.grammar_score) }}>{Math.round(activeAnalysis.grammar_score)}%</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${activeAnalysis.grammar_score}%`, height: '100%', backgroundColor: getScoreColor(activeAnalysis.grammar_score), transition: 'width 1s ease' }}></div>
                    </div>
                  </div>

                  {/* Word Choice score */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.2rem' }}>
                      <span>Word Choice & Buzzwords</span>
                      <span style={{ color: getScoreColor(activeAnalysis.word_choice_score) }}>{Math.round(activeAnalysis.word_choice_score)}%</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${activeAnalysis.word_choice_score}%`, height: '100%', backgroundColor: getScoreColor(activeAnalysis.word_choice_score), transition: 'width 1s ease' }}></div>
                    </div>
                  </div>

                </div>
              </div>

              {/* OVERALL STRENGTHS & SUMMARY PANEL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* Summary Card */}
                <div className="glass-panel ats-info-card">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)' }}>
                    <Sparkles size={18} style={{ color: 'var(--accent)' }} /> Audit Executive Summary
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
                    {summary}
                  </p>
                </div>

                {/* Strengths Card */}
                <div className="glass-panel ats-info-card">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)' }}>
                    <Award size={18} style={{ color: 'var(--success)' }} /> Key Resume Strengths
                  </h3>
                  <ul style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {strengths.map((str, idx) => (
                      <li key={idx} style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.4 }}>
                        {str}
                      </li>
                    ))}
                    {strengths.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No specific strengths highlighted.</p>
                    )}
                  </ul>
                </div>

                {/* AI Auto-Fixer Card */}
                <div className="glass-panel ats-info-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)' }}>
                    <Sparkles size={18} style={{ color: 'var(--accent)' }} /> AI Resume Auto-Fixer 🪄
                  </h3>
                  
                  {fixing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem 0', gap: '1rem' }}>
                      <RefreshCw size={24} style={{ color: 'var(--accent)', animation: 'spin 2s linear infinite' }} />
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 600, textAlign: 'center' }}>
                        {fixMessage}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        This will take about 15-20 seconds. Please wait...
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {activeAnalysis.fixed_resume_file_url ? (
                        <div>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 1rem 0' }}>
                            ✨ Success! We have corrected all spelling mistakes, grammar errors, weak phrasing, and buzzwords. The visual layout and original font style have been preserved in your new PDF resume.
                          </p>
                          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                            <a 
                              href={activeAnalysis.fixed_resume_file_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="btn btn-primary"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
                            >
                              <FileText size={16} /> Download Corrected Resume (PDF)
                            </a>
                            <button 
                              onClick={() => handleFixResume(activeAnalysis.id)}
                              className="btn"
                              style={{ borderColor: 'var(--panel-border)', backgroundColor: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                            >
                              <RefreshCw size={14} /> Re-Generate Resume
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 1rem 0' }}>
                            Want to fix all formatting, typography, grammar, and word choice issues instantly? Our AI will rewrite the resume text, optimize it for ATS, and compile a fresh PDF using your original layout fonts.
                          </p>
                          <button 
                            onClick={() => handleFixResume(activeAnalysis.id)}
                            className="btn btn-primary"
                            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}
                          >
                            <Sparkles size={16} /> Auto-Fix & Generate PDF Resume
                          </button>
                        </div>
                      )}

                      <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1.5rem', marginTop: '0.5rem' }}>
                        <h4 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>
                          One-Click Auto-Align to Job Description 🎯
                        </h4>
                        
                        {aligning ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem 0', gap: '0.75rem' }}>
                            <RefreshCw size={20} style={{ color: 'var(--accent)', animation: 'spin 2s linear infinite' }} />
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 600 }}>
                              {alignMessage}
                            </span>
                          </div>
                        ) : (
                          <div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.5, margin: '0 0 1rem 0' }}>
                              Tailor your resume content to specifically match the target job description. Our AI will align your tech stack order, optimize experience action verbs, and compile a tailored PDF.
                            </p>
                            <button 
                              onClick={handleAutoAlignResume}
                              className="btn btn-primary"
                              style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)', border: 'none' }}
                            >
                              <Sparkles size={16} /> Auto-Align & Download Aligned PDF
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Conversational Editor Card */}
                <div className="glass-panel ats-info-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)' }}>
                    <MessageSquare size={18} style={{ color: 'var(--accent)' }} /> Conversational AI Editor 💬
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.4, margin: 0 }}>
                    Type specific requests to modify your resume (e.g. <em>"Add Python to Skills"</em>, <em>"Change summary to focus more on machine learning"</em>, or <em>"Remove intermediate education"</em>).
                  </p>

                  {/* Chat messages log */}
                  <div style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid var(--panel-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.75rem',
                    backgroundColor: 'rgba(0,0,0,0.15)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.65rem'
                  }}>
                    {chatMessages.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center', padding: '1rem 0' }}>
                        No custom edits requested yet. Send a message below to modify your resume!
                      </div>
                    ) : (
                      chatMessages.map((msg, idx) => (
                        <div key={idx} style={{
                          alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                          backgroundColor: msg.sender === 'user' ? 'var(--primary)' : (msg.isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)'),
                          color: msg.isError ? 'var(--danger)' : 'var(--text-main)',
                          border: msg.isError ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid var(--panel-border)',
                          borderRadius: '8px',
                          padding: '0.5rem 0.75rem',
                          maxWidth: '85%',
                          fontSize: '0.82rem',
                          lineHeight: 1.4,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                        }}>
                          {msg.text}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Text Input area */}
                  {chatLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem 0', gap: '0.75rem' }}>
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
                        placeholder={activeAnalysis ? "Type custom changes here..." : "Please run initial analysis first"}
                        disabled={!activeAnalysis}
                        style={{
                          flexGrow: 1,
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--panel-border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.6rem 0.85rem',
                          color: 'var(--text-main)',
                          fontSize: '0.85rem',
                          outline: 'none',
                          transition: 'border-color 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
                      />
                      <button 
                        type="submit" 
                        disabled={!activeAnalysis || !chatInstruction.trim()}
                        className="btn btn-primary"
                        style={{ 
                          padding: '0 0.85rem', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          borderRadius: 'var(--radius-sm)',
                          opacity: (!activeAnalysis || !chatInstruction.trim()) ? 0.5 : 1,
                          cursor: (!activeAnalysis || !chatInstruction.trim()) ? 'default' : 'pointer'
                        }}
                      >
                        <Send size={15} />
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* MISTAKES & IMPROVEMENT INSPECTOR (TABBED LIST) */}
              <div className="glass-panel ats-inspector-card">
                <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: '0 0 1.25rem 0', color: 'var(--text-main)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.75rem' }}>
                  Resume Audit & Mistakes Inspector
                </h3>

                {/* Horizontal Navigation Tabs */}
                <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.85rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)' }} className="ats-tabs">
                  {tabLabels.map((tab) => {
                    const isSel = activeTab === tab.id;
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.65rem 1.1rem',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid',
                          borderColor: isSel ? 'var(--primary)' : 'transparent',
                          backgroundColor: isSel ? 'rgba(139, 92, 246, 0.08)' : 'transparent',
                          color: isSel ? 'var(--text-main)' : 'var(--text-muted)',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <TabIcon size={14} style={{ color: isSel ? 'var(--accent)' : 'inherit' }} />
                        {tab.label}
                        <span 
                          style={{ 
                            fontSize: '0.75rem', 
                            padding: '0.1rem 0.4rem', 
                            borderRadius: '10px', 
                            backgroundColor: tab.count > 0 ? (isSel ? 'var(--primary)' : 'rgba(255,255,255,0.06)') : 'rgba(255,255,255,0.02)',
                            color: tab.count > 0 ? '#fff' : 'var(--text-muted)'
                          }}
                        >
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Select/Deselect all controls for the active tab */}
                {activeIssues.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', padding: '0 0.25rem' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Select which issues you want the AI to fix in the next PDF generation.
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button 
                        onClick={() => handleToggleAllInTab(true)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                      >
                        ✓ Select All
                      </button>
                      <span style={{ color: 'var(--panel-border)', fontSize: '0.8rem' }}>|</span>
                      <button 
                        onClick={() => handleToggleAllInTab(false)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                      >
                        ✗ Deselect All
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Tab Mistakes Render list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  
                  {activeIssues.map((issue, idx) => {
                    const style = getSeverityStyle(issue.severity);
                    const isSelected = selectedIssues[`${activeTab}-${idx}`] ?? true;
                    return (
                      <div 
                        key={idx} 
                        className={`glass-panel ats-issue-item ${isSelected ? 'selected' : ''}`}
                        style={{ 
                          borderLeft: `4px solid ${style.color}`,
                          backgroundColor: 'rgba(255, 255, 255, 0.005)',
                          opacity: isSelected ? 1 : 0.6,
                          transition: 'opacity 0.2s, border-color 0.2s'
                        }}
                      >
                        {/* Checkbox toggle on the left */}
                        <div style={{ paddingTop: '0.15rem', flexShrink: 0 }}>
                          <button
                            onClick={() => {
                              const key = `${activeTab}-${idx}`;
                              setSelectedIssues(prev => ({
                                ...prev,
                                [key]: !isSelected
                              }));
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                              transition: 'color 0.2s'
                            }}
                            title={isSelected ? "Approved - Click to Deny/Ignore" : "Denied/Ignored - Click to Approve/Fix"}
                          >
                            {isSelected ? (
                              <div style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '4px',
                                border: '2px solid var(--accent)',
                                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}>
                                <Check size={14} style={{ strokeWidth: 3 }} />
                              </div>
                            ) : (
                              <div style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '4px',
                                border: '2px solid var(--text-muted)',
                                backgroundColor: 'transparent'
                              }} />
                            )}
                          </button>
                        </div>

                        {/* Content on the right */}
                        <div style={{ flexGrow: 1, minWidth: 0 }}>
                          {/* Issue Title, Severity Badge, and Location */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
                            <h4 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: isSelected ? 'var(--text-main)' : 'var(--text-muted)', transition: 'color 0.2s' }}>
                              {issue.issue}
                            </h4>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '10px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
                                {issue.severity} priority
                              </span>
                              {issue.location && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', backgroundColor: 'rgba(255,255,255,0.03)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)' }}>
                                  📍 {issue.location}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Resume Context Context Snippet */}
                          {issue.context && (
                            <div style={{ margin: '0.75rem 0', padding: '0.6rem 0.9rem', backgroundColor: 'rgba(0, 0, 0, 0.2)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', gap: '0.5rem', alignItems: 'flex-start', wordBreak: 'break-word' }}>
                              <CornerDownRight size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                              <div>
                                <span style={{ color: 'var(--text-main)', display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', fontFamily: 'var(--font-sans)', fontStyle: 'normal', fontWeight: 600, marginBottom: '2px' }}>Resume Text Context:</span>
                                "{issue.context}"
                              </div>
                            </div>
                          )}

                          {/* Recommendation Suggestion Fix */}
                          <div className="ats-suggestion-box">
                            <Sparkles size={16} style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
                            <div style={{ fontSize: '0.85rem', lineHeight: 1.5, color: isSelected ? 'var(--text-main)' : 'var(--text-muted)', wordBreak: 'break-word' }}>
                              <strong style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)' }}>Suggestion:</strong> {issue.suggestion}
                            </div>
                          </div>
                        </div>

                      </div>
                    );
                  })}

                  {activeIssues.length === 0 && (
                    <div style={{ padding: '3rem 1.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--success-glow)', border: '1px solid rgba(16, 185, 129, 0.2)', color: 'var(--success)' }}>
                        <Check size={24} />
                      </div>
                      <h4 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                        All Clean!
                      </h4>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '300px', margin: 0, lineHeight: 1.4 }}>
                        We didn't detect any formatting, font, spelling, grammar, or word choice issues in this section. Outstanding work!
                      </p>
                    </div>
                  )}

                </div>
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}

export default AtsScorer;
