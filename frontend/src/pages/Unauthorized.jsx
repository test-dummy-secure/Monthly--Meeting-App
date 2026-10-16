import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export default function Unauthorized() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cyber-darker text-slate-100 p-6">
      <div className="glass-panel p-8 max-w-md w-full border-red-500/30 text-center">
        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2 font-sans">Access Denied</h2>
        <p className="text-xs text-slate-400 leading-relaxed mb-6">
          Your account does not possess the permissions required to view this segment. Please contact a system administrator.
        </p>
        <Link
          to="/"
          className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-5 rounded-lg text-xs transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
