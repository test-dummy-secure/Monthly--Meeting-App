import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Monitor, CheckCircle2, AlertTriangle, RefreshCw, WifiOff, ExternalLink } from 'lucide-react';

/**
 * MicrosoftConnectButton
 *
 * Handles the full Microsoft 365 connection lifecycle:
 *   not_connected → OAuth redirect → connected
 *   connected     → verify / disconnect
 *   expired/error → reconnect
 *
 * Props:
 *   tenantId         string   — required, selected tenant
 *   onStatusChange   fn       — called with updated status object
 */
export default function MicrosoftConnectButton({ tenantId, onStatusChange }) {
  const [status,      setStatus]      = useState(null);   // null | 'not_connected' | 'connected' | 'expired' | 'error'
  const [connEmail,   setConnEmail]   = useState('');
  const [lastVerified, setLastVerified] = useState(null);
  const [lastError,   setLastError]   = useState('');
  const [loading,     setLoading]     = useState(false);
  const [verifying,   setVerifying]   = useState(false);
  const [msg,         setMsg]         = useState('');

  const loadStatus = async () => {
    if (!tenantId) return;
    try {
      const data = await api.microsoft.getStatus();
      setStatus(data.status || 'not_connected');
      setConnEmail(data.connectedEmail || '');
      setLastVerified(data.lastVerifiedAt || null);
      setLastError(data.lastError || '');
      onStatusChange?.(data);
    } catch {
      setStatus('not_connected');
    }
  };

  useEffect(() => {
    loadStatus();
    // Check if returning from OAuth redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('ms_connected') === '1') {
      setMsg('Microsoft 365 connected successfully!');
      window.history.replaceState({}, '', window.location.pathname);
      loadStatus();
    }
    if (params.get('ms_error')) {
      setMsg(`Connection failed: ${params.get('ms_error')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    if (!tenantId) return;
    setLoading(true);
    setMsg('');
    try {
      const { authUrl } = await api.microsoft.getAuthUrl();
      window.location.href = authUrl;
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Failed to start OAuth flow. Please try again.');
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setMsg('');
    try {
      const result = await api.microsoft.verify();
      if (result.verified) {
        setMsg(`Connection verified — ${result.email || connEmail}`);
        setStatus('connected');
        await loadStatus();
      }
    } catch (err) {
      const errData = err?.response?.data;
      if (errData?.status === 'expired') {
        setStatus('expired');
        setMsg('Your Microsoft session has expired. Please reconnect.');
      } else {
        setMsg(errData?.error || 'Verification failed.');
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Microsoft 365? The booking watcher will stop.')) return;
    setLoading(true);
    setMsg('');
    try {
      await api.microsoft.disconnect();
      setStatus('not_connected');
      setConnEmail('');
      setLastVerified(null);
      setMsg('Microsoft 365 disconnected.');
      onStatusChange?.({ status: 'not_connected' });
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Failed to disconnect.');
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  // ── Render states ──────────────────────────────────────────────────────────

  if (status === null) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading connection status...
      </div>
    );
  }

  const isConnected = status === 'connected';
  const needsReconnect = status === 'expired' || status === 'error';

  return (
    <div className="space-y-3">

      {/* Status pill + email */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-slate-200">Microsoft 365 / Teams</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${
          isConnected      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' :
          needsReconnect   ? 'bg-rose-500/15 text-rose-400 border-rose-500/25' :
                             'bg-slate-700/40 text-slate-500 border-slate-600/50'
        }`}>
          {isConnected ? 'Connected' : needsReconnect ? status === 'expired' ? 'Session Expired' : 'Error' : 'Not Connected'}
        </span>
      </div>

      {/* Connected details */}
      {isConnected && connEmail && (
        <div className="text-[11px] text-slate-400 space-y-0.5 pl-6">
          <p>Account: <span className="text-slate-300 font-medium">{connEmail}</span></p>
          {fmtDate(lastVerified) && (
            <p>Last verified: <span className="text-slate-300">{fmtDate(lastVerified)}</span></p>
          )}
        </div>
      )}

      {/* Error message for expired/error state */}
      {needsReconnect && lastError && (
        <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 text-rose-400 text-xs pl-6">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{lastError}</span>
        </div>
      )}

      {/* Feedback message */}
      {msg && (
        <p className={`text-xs pl-6 ${msg.includes('success') || msg.includes('verified') ? 'text-emerald-400' : 'text-rose-400'}`}>
          {msg}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pl-6">
        {!isConnected && !needsReconnect && (
          <button
            onClick={handleConnect}
            disabled={loading || !tenantId}
            className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
            Connect Microsoft 365
          </button>
        )}

        {needsReconnect && (
          <button
            onClick={handleConnect}
            disabled={loading || !tenantId}
            className="flex items-center gap-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Reconnect Microsoft 365
          </button>
        )}

        {isConnected && (
          <>
            <button
              onClick={handleVerify}
              disabled={verifying}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              {verifying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Verify
            </button>
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-rose-500 hover:text-rose-400 border border-rose-500/30 px-3 py-1.5 rounded-lg transition-colors"
            >
              <WifiOff className="w-3 h-3" />
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}
