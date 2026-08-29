import React, { useContext, useState, useEffect } from 'react';
import { useNavigate, NavLink, useLocation } from 'react-router-dom';
import { Sun, Moon, Briefcase, Zap, Target, User, LayoutDashboard, LogOut } from 'lucide-react';
import { AuthContext } from '../App';

function Navbar() {
  const { user, logoutUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleSectionScroll = (id) => {
    if (location.pathname !== '/') {
      navigate('/', { state: { scrollTo: id } });
    } else {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <nav className="navbar">
      <div className="nav-brand" onClick={() => navigate('/')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.6rem' }}>🎯</span> 
        <div>
          <span style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '1.35rem', letterSpacing: '-0.02em' }}>HireAI</span>
          <span style={{ fontSize: '0.68rem', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '10px', marginLeft: '0.4rem', fontWeight: 700 }}>
            ☕ 100% Human Friendly
          </span>
        </div>
      </div>

      <div className="nav-links">
        <NavLink to="/" className="nav-link" end>
          Home
        </NavLink>

        {user ? (
          user.is_recruiter ? (
            /* RECRUITER NAVIGATION LINKS */
            <>
              <NavLink to="/hr" className="nav-link">
                <LayoutDashboard size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> HR Dashboard
              </NavLink>
              <NavLink to="/jobs" className="nav-link">
                <Briefcase size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> Open Vacancies
              </NavLink>
              <NavLink to="/profile" className="nav-link">
                <User size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> Recruiter Profile
              </NavLink>
            </>
          ) : (
            /* STUDENT / CANDIDATE NAVIGATION LINKS */
            <>
              <NavLink to="/jobs" className="nav-link">
                <Briefcase size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> Jobs Explorer
              </NavLink>
              <NavLink to="/practice" className="nav-link">
                <Zap size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> Practice Room ⚡
              </NavLink>
              <NavLink to="/ats-scorer" className="nav-link">
                <Target size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> ATS Scorer 🎯
              </NavLink>
              <NavLink to="/profile" className="nav-link">
                <User size={16} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} /> My Profile
              </NavLink>
            </>
          )
        ) : (
          /* GUEST / LANDING PAGE NAVIGATION LINKS */
          <>
            <button className="nav-link-btn" onClick={() => handleSectionScroll('student-features')}>
              For Candidates
            </button>
            <button className="nav-link-btn" onClick={() => handleSectionScroll('recruiter-features')}>
              For Recruiters
            </button>
            <button className="nav-link-btn" onClick={() => handleSectionScroll('investor-highlights')}>
              Platform Tech
            </button>
          </>
        )}
      </div>

      <div className="nav-user" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
        <button 
          onClick={toggleTheme}
          className="theme-toggle-btn"
          title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
            <div 
              onClick={() => navigate('/profile')}
              style={{ textAlign: 'right', lineHeight: '1.2', cursor: 'pointer' }}
              title="Click to view & edit Profile"
            >
              <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'flex-end' }}>
                <User size={14} style={{ color: 'var(--primary)' }} /> {user.username}
              </div>
              <span className={`role-pill ${user.is_recruiter ? 'role-recruiter' : 'role-candidate'}`}>
                {user.is_recruiter ? '👔 Recruiter' : '🎓 Candidate'}
              </span>
            </div>
            <button 
              className="btn btn-secondary" 
              onClick={() => { logoutUser(); navigate('/'); }} 
              style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}
              title="Logout"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/login')} style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
              Sign In
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/register')} style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
              Join Now
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

export default Navbar;

