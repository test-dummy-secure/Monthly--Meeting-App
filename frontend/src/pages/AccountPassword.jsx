import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { KeyRound, Eye, EyeOff, RefreshCw, CheckCircle, ArrowLeft } from 'lucide-react';

export const AccountPassword = () => {
  const { logout } = useAuth();
  const navigate   = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent,     setShowCurrent]     = useState(false);
  const [showNew,         setShowNew]         = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [success,         setSuccess]         = useState(false);
  const [error,           setError]           = useState('');

  const validate = () => {
    if (!currentPassword)                return 'Current password is required';
    if (newPassword.length < 8)          return 'New password must be at least 8 characters';
    if (newPassword === currentPassword) return 'New password must be different from the current password';
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
      setSuccess(true);
      setTimeout(async () => {
        await logout();
        navigate('/login', {
          replace: true,
          state: { notice: 'Password changed successfully. Please log in with your new password.' },
        });
      }, 2500);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to change password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto pt-8 px-4">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-xs text-[#6B6358] hover:text-[#1A1814] mb-6 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <div className="glass-panel p-8 space-y-6" style={{ background: '#FDFAF5', border: '1px solid #D8D2C4' }}>

        <div className="space-y-1">
          <h1 className="text-lg font-bold text-[#1A1814] tracking-tight">Change Password</h1>
          <p className="text-xs text-[#6B6358]">Enter your current password and choose a new one.</p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle className="w-12 h-12 text-emerald-500" />
            <p className="text-sm font-bold text-[#1A1814]">Password changed</p>
            <p className="text-xs text-[#6B6358] text-center leading-relaxed">
              Redirecting you to login with your new password…
            </p>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-xs font-semibold leading-relaxed">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Current password */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">
                  Current Password
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 w-4 h-4 text-[#A89E90]" />
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full bg-[#F5F1E8] border border-[#D8D2C4] focus:border-[#B8872A] rounded-lg pl-10 pr-10 py-2.5 text-xs text-[#1A1814] placeholder-[#A89E90] outline-none transition-colors"
                  />
                  <button type="button" onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-3 top-3 text-[#A89E90] hover:text-[#6B6358] transition-colors">
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New password */}
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
                  <button type="button" onClick={() => setShowNew(v => !v)}
                    className="absolute right-3 top-3 text-[#A89E90] hover:text-[#6B6358] transition-colors">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm new password */}
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
                  <button type="button" onClick={() => setShowConfirm(v => !v)}
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
                {loading ? 'Changing…' : 'Change Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default AccountPassword;
