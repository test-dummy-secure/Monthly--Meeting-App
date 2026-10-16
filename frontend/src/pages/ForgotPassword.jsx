import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { Mail, ArrowLeft, RefreshCw, CheckCircle } from 'lucide-react';
import { NxgLogo } from '../components/NxgLogo';


export const ForgotPassword = () => {
  const [email, setEmail]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]         = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.auth.forgotPassword(email.trim());
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
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
          <p className="text-xs text-[#6B6358] font-medium mt-2">Password Recovery</p>
        </div>

        {submitted ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="w-12 h-12 text-emerald-500" />
              <h2 className="text-base font-bold text-[#1A1814] text-center">Check your email</h2>
              <p className="text-xs text-[#6B6358] text-center leading-relaxed">
                If <span className="text-[#1A1814] font-semibold">{email}</span> is registered,
                you'll receive a reset link within a few minutes.
                Check your spam folder if it doesn't arrive.
              </p>
            </div>
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 w-full bg-[#F5F1E8] hover:bg-[#EDE8DC] border border-[#D8D2C4] text-[#4A4239] font-semibold py-2.5 px-4 rounded-lg transition-all text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Login
            </Link>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-bold text-[#1A1814] mb-1">Forgot your password?</h2>
              <p className="text-xs text-[#6B6358] leading-relaxed">
                Enter your corporate email and we'll send you a link to reset it.
              </p>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-xs font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">
                  Corporate Email
                </label>
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

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#B8872A] hover:bg-[#9E7123] disabled:opacity-50 font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2"
                style={{ color: '#FDFAF5' }}
              >
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                Send Reset Link
              </button>
            </form>

            <div className="flex items-center justify-center pt-1 border-t border-[#E4DFCF]">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-xs text-[#8A7F73] hover:text-[#B8872A] transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to Login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
