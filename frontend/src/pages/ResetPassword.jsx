import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { KeyRound, Eye, EyeOff, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { NxgLogo } from '../components/NxgLogo';


export const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const token          = searchParams.get('token') || '';

  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew]                 = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [success, setSuccess]                 = useState(false);
  const [error, setError]                     = useState('');

  const validate = () => {
    if (newPassword.length < 8)          return 'Password must be at least 8 characters';
    if (newPassword !== confirmPassword) return 'Passwords do not match';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }

    setLoading(true);
    setError('');
    try {
      await api.auth.resetPassword(token, newPassword);
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Reset link is invalid or has expired. Please request a new one.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#EDE8DC] p-4 font-sans text-xs">
        <div className="glass-panel p-8 max-w-md w-full text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-base font-bold text-[#1A1814]">Invalid Reset Link</h2>
          <p className="text-xs text-[#6B6358]">
            This link is missing a reset token. Please request a new password reset.
          </p>
          <Link to="/forgot-password" className="inline-block text-xs text-[#B8872A] hover:text-[#9E7123] transition-colors font-semibold">
            Request a new link →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#EDE8DC] p-4 font-sans text-xs">
      <div className="glass-panel p-8 max-w-md w-full space-y-6">

        {/* Brand */}
        <div className="text-center space-y-2">
          <NxgLogo />
          <p className="text-xs text-[#6B6358] font-medium mt-2">Set New Password</p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle className="w-12 h-12 text-emerald-500" />
            <h2 className="text-base font-bold text-[#1A1814]">Password Updated</h2>
            <p className="text-xs text-[#6B6358] text-center leading-relaxed">
              Your password has been changed successfully. Redirecting you to login…
            </p>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-bold text-[#1A1814] mb-1">Choose a new password</h2>
              <p className="text-xs text-[#6B6358]">Must be at least 8 characters.</p>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-xs font-semibold leading-relaxed">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">New Password</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 w-4 h-4 text-[#A89E90]" />
                  <input
                    type={showNew ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full bg-[#F5F1E8] border border-[#D8D2C4] focus:border-[#B8872A] rounded-lg pl-10 pr-10 py-2.5 text-xs text-[#1A1814] placeholder-[#A89E90] outline-none transition-colors"
                  />
                  <button type="button" onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-3 text-[#A89E90] hover:text-[#6B6358] transition-colors">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">Confirm Password</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 w-4 h-4 text-[#A89E90]" />
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full bg-[#F5F1E8] border border-[#D8D2C4] focus:border-[#B8872A] rounded-lg pl-10 pr-10 py-2.5 text-xs text-[#1A1814] placeholder-[#A89E90] outline-none transition-colors"
                  />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-3 text-[#A89E90] hover:text-[#6B6358] transition-colors">
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#B8872A] hover:bg-[#9E7123] disabled:opacity-50 font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2"
                style={{ color: '#FDFAF5' }}
              >
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                Update Password
              </button>
            </form>

            <div className="flex items-center justify-center pt-1 border-t border-[#E4DFCF]">
              <Link to="/forgot-password" className="text-xs text-[#8A7F73] hover:text-[#B8872A] transition-colors">
                Request a new link
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
