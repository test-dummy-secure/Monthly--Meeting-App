import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NxgLogo } from '../components/NxgLogo';
import { RefreshCw, KeyRound, Mail, CheckCircle } from 'lucide-react';


export const Login = () => {
  const { login }    = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const navigate  = useNavigate();
  const location  = useLocation();

  const notice = location.state?.notice || null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await login(email, password);
      if (user?.mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        navigate(location.state?.from || '/', { replace: true });
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#EDE8DC] p-4 font-sans text-xs">
      <div className="glass-panel p-8 max-w-md w-full space-y-6">

        {/* Brand */}
        <div className="text-center space-y-2">
          <NxgLogo />
          <p className="text-xs text-[#6B6358] font-medium mt-2">Security Management Platform</p>
        </div>

        {notice && (
          <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-lg text-xs font-semibold leading-relaxed">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
            {notice}
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-xs font-semibold leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">Corporate Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-4 h-4 text-[#A89E90]" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. manager@company.com"
                className="w-full bg-[#F5F1E8] border border-[#D8D2C4] focus:border-[#B8872A] rounded-lg pl-10 pr-3 py-2.5 text-xs text-[#1A1814] placeholder-[#A89E90] outline-none transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">Password</label>
              <Link to="/forgot-password" className="text-[10px] text-[#8A7F73] hover:text-[#B8872A] transition-colors">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <KeyRound className="absolute left-3 top-3 w-4 h-4 text-[#A89E90]" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#F5F1E8] border border-[#D8D2C4] focus:border-[#B8872A] rounded-lg pl-10 pr-3 py-2.5 text-xs text-[#1A1814] placeholder-[#A89E90] outline-none transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#B8872A] hover:bg-[#9E7123] disabled:opacity-50 font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center gap-2"
            style={{ color: '#FDFAF5' }}
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
            <span>Sign In</span>
          </button>
        </form>

      </div>
    </div>
  );
};
