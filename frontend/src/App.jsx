import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ResumeChatbot from './components/ResumeChatbot';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import Home from './pages/Home';
import Apply from './pages/Apply';
import ApplicationResult from './pages/ApplicationResult';
import Interview from './pages/Interview';
import HrDashboard from './pages/HrDashboard';
import PracticeSetup from './pages/PracticeSetup';
import AtsScorer from './pages/AtsScorer';
import './App.css';

export const AuthContext = React.createContext(null);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check auth state on load
  useEffect(() => {
    fetch('/api/auth/me/')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Trigger Phone verification ONLY ONCE when user is logged in
  useEffect(() => {
    if (!user) return;

    const userIdentifier = user.id || user.username || user.email || 'user';
    const storageKey = `phone_verified_${userIdentifier}`;
    const alreadyVerified = localStorage.getItem(storageKey);

    if (!alreadyVerified) {
      const triggerVerification = () => {
        const configuration = {
          widgetId: "366875674c66353235363935",
          tokenAuth: "562858T5CD7AdrN6a8800cdP1",
          identifier: user.email || user.username || "",
          exposeMethods: true,
          success: (data) => {
            console.log('Mobile verification success:', data);
            localStorage.setItem(storageKey, 'true');
          },
          failure: (error) => {
            console.log('Mobile verification failure/closed:', error);
            localStorage.setItem(storageKey, 'attempted');
          }
        };

        if (typeof window.initSendOTP === 'function') {
          window.initSendOTP(configuration);
        }
      };

      if (window.initSendOTP) {
        triggerVerification();
      } else {
        const script = document.createElement('script');
        script.src = 'https://verify.msg91.com/otp-provider.js';
        script.async = true;
        script.onload = () => triggerVerification();
        script.onerror = () => {
          const fallbackScript = document.createElement('script');
          fallbackScript.src = 'https://verify.phone91.com/otp-provider.js';
          fallbackScript.async = true;
          fallbackScript.onload = () => triggerVerification();
          document.head.appendChild(fallbackScript);
        };
        document.head.appendChild(script);
      }
    }
  }, [user]);

  const loginUser = (userData) => {
    setUser(userData);
  };

  const logoutUser = () => {
    fetch('/api/auth/logout/', { method: 'POST' })
      .then(() => setUser(null))
      .catch(err => console.error("Logout failed:", err));
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', color: '#0f172a' }}>
        <div className="pulse-spinner">AI</div>
      </div>
    );
  }

  // Protected Route wrappers
  const ProtectedRoute = ({ children }) => {
    if (!user) return <Navigate to="/login" replace />;
    return children;
  };

  const RecruiterRoute = ({ children }) => {
    if (!user) return <Navigate to="/login" replace />;
    if (!user.is_recruiter) return <Navigate to="/" replace />;
    return children;
  };

  return (
    <AuthContext.Provider value={{ user, loginUser, logoutUser }}>
      <Router>
        <Routes>
          {/* Main layout routes with navbar */}
          <Route path="/" element={<><Navbar /><LandingPage /></>} />
          <Route path="/login" element={<><Navbar /><Login /></>} />
          <Route path="/register" element={<><Navbar /><Register /></>} />
          
          <Route path="/profile" element={
            <ProtectedRoute>
              <><Navbar /><Profile /></>
            </ProtectedRoute>
          } />
          <Route path="/jobs" element={
            <ProtectedRoute>
              <><Navbar /><Home /></>
            </ProtectedRoute>
          } />
          <Route path="/practice" element={
            <ProtectedRoute>
              <><Navbar /><PracticeSetup /></>
            </ProtectedRoute>
          } />
          <Route path="/ats-scorer" element={
            <ProtectedRoute>
              <><Navbar /><AtsScorer /></>
            </ProtectedRoute>
          } />
          <Route path="/apply/:jobId" element={
            <ProtectedRoute>
              <><Navbar /><Apply /></>
            </ProtectedRoute>
          } />
          <Route path="/result/:applicationId" element={
            <ProtectedRoute>
              <><Navbar /><ApplicationResult /></>
            </ProtectedRoute>
          } />
          
          <Route path="/hr" element={
            <RecruiterRoute>
              <><Navbar /><HrDashboard /></>
            </RecruiterRoute>
          } />

          {/* Immersive interview layout - NO global navbar to prevent navigation alerts */}
          <Route path="/interview/:applicationId" element={
            <ProtectedRoute>
              <Interview />
            </ProtectedRoute>
          } />
          
          {/* Fallback route */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {user && <ResumeChatbot />}
      </Router>
    </AuthContext.Provider>
  );
}

export default App;
