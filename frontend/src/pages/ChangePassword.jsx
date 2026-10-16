import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { KeyRound, Eye, EyeOff, RefreshCw, Lock } from 'lucide-react';
import { NxgLogo } from '../components/NxgLogo';


export const ChangePassword = () => {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent]         = useState(false);
  const [showNew, setShowNew]                 = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState('');

  const validate = () => {
    if (!currentPassword)                return 'Current (temporary) password is required';
    if (newPassword.length < 8)          return 'New password must be at least 8 characters';
    if (newPassword === currentPassword) return 'New password must be different from the temporary password';
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
      await api.auth.changePassword(currentPassword, newPassword);
      await logout();
      navigate('/login', {
        replace: true,
        state: { notice: 'Password changed successfully. Please log in with your new password.' },
      });
    } catch (err) {
      const msg = err?.response?.data?.error || 'Failed to change password. Please try again.';
      setError(msg);
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
          <p className="text-xs text-[#B8872A] font-semibold uppercase tracking-wide mt-2">Action Required</p>
        </div>

        {/* Notice banner */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3.5">
          <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-800 mb-0.5">Password reset by administrator</p>
            <p className="text-[11px] text-amber-700/90 leading-relaxed">
              Your password was reset by an admin. You must set a new password before you can access
              {user?.first_name ? ` the platform, ${user.first_name}.` : ' the platform.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-xs font-semibold leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">
              Temporary Password
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-3 w-4 h-4 text-[#A89E90]" />
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter the password from the email"
                className="w-full bg-[#F5F1E8] border border-[#D8D2C4] focus:border-[#B8872A] rounded-lg pl-10 pr-10 py-2.5 text-xs text-[#1A1814] placeholder-[#A89E90] outline-none transition-colors"
              />
              <button type="button" onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-3 text-[#A89E90] hover:text-[#6B6358] transition-colors">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">
              New Password
            </label>
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
            <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">
              Confirm New Password
            </label>
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
            Set New Password
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePassword;
