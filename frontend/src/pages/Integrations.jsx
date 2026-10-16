import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useTenant } from '../context/TenantContext';
import { useAuth } from '../context/AuthContext';
import MicrosoftConnectButton from '../components/MicrosoftConnectButton';
import {
  Link2, Sparkles, Building2, HelpCircle,
  CheckCircle2, AlertTriangle, RefreshCw, X, Plug, Trash2, WifiOff,
  Settings, ExternalLink, Eye, EyeOff, FlaskConical, Zap,
} from 'lucide-react';

// ─── Provider type display metadata ──────────────────────────────────────────
const PROVIDER_DISPLAY = {
  MANUAL:          { label: 'Manual Entry',    icon: '✍️', color: 'text-slate-400',   border: 'border-slate-700' },
  UPLOAD:          { label: 'Manual Upload',   icon: '📎', color: 'text-slate-400',   border: 'border-slate-700' },
  MICROSOFT_TEAMS: { label: 'Microsoft Teams', icon: '💼', color: 'text-indigo-400',  border: 'border-indigo-500/25' },
};

const STATUS_PILL = {
  connected:      'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  disconnected:   'bg-slate-700/40 text-slate-500 border-slate-600/50',
  pending:        'bg-amber-500/15 text-amber-400 border-amber-500/25',
  error:          'bg-rose-500/15 text-rose-400 border-rose-500/25',
  built_in:       'bg-slate-800/60 text-slate-500 border-slate-700',
  not_configured: 'bg-slate-800/60 text-slate-500 border-slate-700',
};

const SYNC_STATUS_PILL = {
  running:   'bg-sky-500/15 text-sky-400 border-sky-500/25',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  failed:    'bg-rose-500/15 text-rose-400 border-rose-500/25',
  pending:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
};

const fmtDt = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ─── Provider Card ────────────────────────────────────────────────────────────
const ProviderCard = ({ provider, onConnect, onDisable, onRemove, actionLoading }) => {
  const [showForm, setShowForm]       = useState(false);
  const [email,    setEmail]          = useState(provider.connection?.oauthAccountEmail || '');
  const [wsId,     setWsId]           = useState(provider.connection?.providerWorkspaceId || '');

  const meta       = PROVIDER_DISPLAY[provider.providerType] || PROVIDER_DISPLAY.MANUAL;
  const isBuiltin  = provider.connectionStatus === 'built_in';
  const conn       = provider.connection;
  const loading    = actionLoading === provider.providerType;

  const handleSubmit = (e) => {
    e.preventDefault();
    onConnect(provider.providerType, email, wsId);
    setShowForm(false);
  };

  return (
    <div className={`glass-panel p-5 space-y-4 border ${meta.border}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">{meta.icon}</span>
          <div>
            <h4 className={`text-sm font-bold ${meta.color}`}>{meta.label}</h4>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{provider.description}</p>
            {provider.comingSoon && (
              <span className="inline-flex items-center mt-1.5 text-[9px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/25 font-bold uppercase tracking-wide">
                Sync · Coming Soon
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${STATUS_PILL[provider.connectionStatus] || STATUS_PILL.not_configured}`}>
          {isBuiltin ? 'Built-in' : (provider.connectionStatus?.replace(/_/g, ' ') || 'Not Configured')}
        </span>
      </div>

      {/* Connection details */}
      {conn && !isBuiltin && (
        <div className="border-t border-slate-800/50 pt-3 space-y-1 text-[10px] text-slate-500">
          {conn.oauthAccountEmail && (
            <p>Account: <span className="text-slate-300 font-medium">{conn.oauthAccountEmail}</span></p>
          )}
          {conn.providerWorkspaceId && (
            <p>Workspace ID: <span className="text-slate-300 font-mono">{conn.providerWorkspaceId}</span></p>
          )}
          {conn.lastSyncAt && (
            <p>Last sync: <span className="text-slate-300">{fmtDt(conn.lastSyncAt)}</span></p>
          )}
        </div>
      )}

      {/* Inline connect form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="border-t border-slate-800/50 pt-3 space-y-2">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Account Email <span className="font-normal text-slate-600">(optional)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@workspace.com"
              className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Workspace / Org ID <span className="font-normal text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              value={wsId}
              onChange={(e) => setWsId(e.target.value)}
              placeholder="workspace-id or org-slug"
              className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
            >
              <Plug className="w-3 h-3" />
              {loading ? 'Saving…' : (conn ? 'Update' : 'Connect')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg border border-slate-800 transition-colors"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </form>
      )}

      {/* Action buttons */}
      {!isBuiltin && !showForm && (
        <div className="flex items-center gap-2 flex-wrap border-t border-slate-800/50 pt-3">
          {(!conn || conn.connectionStatus === 'disconnected') && (
            <button
              onClick={() => setShowForm(true)}
              disabled={loading}
              className="flex items-center gap-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plug className="w-3 h-3" />
              {conn ? 'Reconnect' : 'Configure'}
            </button>
          )}
          {conn && conn.connectionStatus === 'connected' && (
            <>
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 text-slate-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => onDisable(conn.id)}
                disabled={loading}
                className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <WifiOff className="w-3 h-3" />
                {loading ? '…' : 'Disable'}
              </button>
              <button
                onClick={() => onRemove(conn.id)}
                disabled={loading}
                className="flex items-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {loading ? '…' : 'Remove'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Fireflies AI Connection Card ────────────────────────────────────────────
const FirefliesConnectionCard = ({ connection, onSave, onTest, onDisconnect, loading, error, warning, testResult }) => {
  const [apiKey,   setApiKey]   = useState('');
  const [showKey,  setShowKey]  = useState(false);
  const [showForm, setShowForm] = useState(false);

  const isConnected = connection?.connected && connection?.status === 'connected';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    onSave(apiKey.trim());
    setApiKey('');
    setShowForm(false);
  };

  return (
    <div className="glass-panel p-5 space-y-4 border border-violet-500/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🔥</span>
          <div>
            <h3 className="text-sm font-bold text-violet-400">Fireflies AI</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed max-w-sm">
              Auto-transcription supporting Hindi + English. Fred bot joins via the calendar invite and transcripts are imported automatically after each conducted meeting.
            </p>
          </div>
        </div>
        <span className={`shrink-0 text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${
          isConnected ? STATUS_PILL.connected : STATUS_PILL.disconnected
        }`}>
          {isConnected ? 'Connected' : 'Not Connected'}
        </span>
      </div>

      {/* Connected details */}
      {isConnected && !showForm && (
        <div className="border-t border-slate-800/50 pt-3 space-y-1 text-[10px] text-slate-500">
          {connection.keyHint && (
            <p>API Key: <span className="text-slate-300 font-mono">••••••••{connection.keyHint}</span></p>
          )}
          {connection.lastSyncedAt && (
            <p>Last used: <span className="text-slate-300">{new Date(connection.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></p>
          )}
          <p className="text-violet-400/70 mt-2">
            <span className="font-mono text-violet-300 text-[10px]">fred@fireflies.ai</span> is auto-added to every new Teams meeting invite.
          </p>
        </div>
      )}

      {/* Test result feedback */}
      {testResult && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold border ${
          testResult.success
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
        }`}>
          {testResult.success
            ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
          {testResult.success
            ? 'Connection test passed — Fireflies API is reachable.'
            : `Test failed: ${testResult.error}`}
        </div>
      )}

      {/* Warning (e.g. rate-limited but key saved) */}
      {warning && !error && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-amber-400 text-xs font-semibold">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {warning}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 text-rose-400 text-xs font-semibold">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* API key form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="border-t border-slate-800/50 pt-3 space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Fireflies API Key
              <span className="ml-1 font-normal text-slate-600 normal-case">
                — from app.fireflies.ai → Settings → Integrations → API
              </span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Fireflies API key"
                required
                className="w-full bg-slate-900 border border-slate-800 focus:border-violet-500 rounded-lg px-3 py-2 pr-9 text-xs text-slate-200 outline-none transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed">
              The key is validated against the Fireflies API before saving and stored encrypted. It is never shown again after saving.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading || !apiKey.trim()}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
            >
              <Plug className="w-3 h-3" />
              {loading ? 'Validating…' : (isConnected ? 'Update Key' : 'Connect')}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setApiKey(''); }}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg border border-slate-800 transition-colors"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </form>
      )}

      {/* Action buttons */}
      {!showForm && (
        <div className="flex items-center gap-2 flex-wrap border-t border-slate-800/50 pt-3">
          {!isConnected && (
            <button
              onClick={() => setShowForm(true)}
              disabled={loading}
              className="flex items-center gap-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plug className="w-3 h-3" />
              Connect Fireflies
            </button>
          )}
          {isConnected && (
            <>
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 text-slate-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                Update Key
              </button>
              <button
                onClick={onTest}
                disabled={loading}
                className="flex items-center gap-1.5 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <FlaskConical className="w-3 h-3" />
                {loading ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                onClick={onDisconnect}
                disabled={loading}
                className="flex items-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {loading ? '…' : 'Disconnect'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── ClickUp Connection Card (Super Admin — global workspace) ────────────────
const ClickUpConnectionCard = ({ connection, onSave, onDisconnect, loading, error }) => {
  const [showWizard,     setShowWizard]     = useState(false);
  const [phase,          setPhase]          = useState(0); // 0=key, 1=picker
  const [apiKey,         setApiKey]         = useState('');
  const [showKey,        setShowKey]        = useState(false);
  const [workspaces,     setWorkspaces]     = useState([]);
  const [wsId,           setWsId]           = useState('');
  const [wsName,         setWsName]         = useState('');
  const [spaces,         setSpaces]         = useState([]);
  const [spaceId,        setSpaceId]        = useState('');
  const [spaceName,      setSpaceName]      = useState('');
  const [validating,     setValidating]     = useState(false);
  const [fetchingSpaces, setFetchingSpaces] = useState(false);
  const [localError,     setLocalError]     = useState('');

  const isConnected = connection?.connected && connection?.status === 'connected';

  const resetWizard = () => {
    setShowWizard(false);
    setPhase(0);
    setApiKey('');
    setShowKey(false);
    setWorkspaces([]);
    setWsId('');
    setWsName('');
    setSpaces([]);
    setSpaceId('');
    setSpaceName('');
    setLocalError('');
  };

  const handleValidate = async () => {
    if (!apiKey.trim()) return;
    setValidating(true);
    setLocalError('');
    try {
      const data = await api.clickup.validate(apiKey.trim());
      const ws = data.workspaces || [];
      setWorkspaces(ws);
      if (ws.length === 1) { setWsId(ws[0].id); setWsName(ws[0].name); }
      setPhase(1);
    } catch (err) {
      setLocalError(err?.response?.data?.error || 'Invalid API key — verify it in ClickUp → Settings → Apps.');
    } finally {
      setValidating(false);
    }
  };

  const handleWorkspaceChange = async (id) => {
    const ws = workspaces.find((w) => w.id === id);
    setWsId(id);
    setWsName(ws?.name || '');
    setSpaceId('');
    setSpaceName('');
    setSpaces([]);
    if (!id) return;
    setFetchingSpaces(true);
    setLocalError('');
    try {
      const data = await api.clickup.getSpaces(id, apiKey.trim());
      const sp = data.spaces || [];
      setSpaces(sp);
      if (sp.length === 1) { setSpaceId(sp[0].id); setSpaceName(sp[0].name); }
    } catch (err) {
      setLocalError(err?.response?.data?.error || 'Failed to load spaces for this workspace.');
    } finally {
      setFetchingSpaces(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim() || !wsId || !spaceId) return;
    await onSave({ apiKey: apiKey.trim(), workspaceId: wsId, workspaceName: wsName, spaceId, spaceName });
    resetWizard();
  };

  return (
    <div className="glass-panel p-5 space-y-4 border border-emerald-500/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Zap className="w-6 h-6 text-emerald-400 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-emerald-400">ClickUp Workspace</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed max-w-sm">
              Global integration — approved tasks push to ClickUp automatically and status syncs back every 6 hours.
            </p>
          </div>
        </div>
        <span className={`shrink-0 text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${
          isConnected ? STATUS_PILL.connected : STATUS_PILL.disconnected
        }`}>
          {isConnected ? 'Connected' : 'Not Connected'}
        </span>
      </div>

      {/* Connected details */}
      {isConnected && !showWizard && (
        <div className="border-t border-slate-800/50 pt-3 space-y-1 text-[10px] text-slate-500">
          <p>Workspace: <span className="text-slate-300 font-medium">{connection.workspaceName || connection.workspaceId}</span></p>
          <p>Space: <span className="text-slate-300 font-medium">{connection.spaceName || connection.spaceId}</span></p>
          {connection.keyHint && (
            <p>API Key: <span className="text-slate-300 font-mono">••••••••{connection.keyHint}</span></p>
          )}
          {connection.connectedAt && (
            <p>Connected: <span className="text-slate-300">{fmtDt(connection.connectedAt)}</span></p>
          )}
          <p className="text-emerald-400/70 mt-2 text-[10px]">
            Each new tenant automatically gets a folder <span className="font-mono text-emerald-300">{'<TenantName> - Monthly Meeting'}</span> → <span className="font-mono text-emerald-300">Action Items</span> list.
          </p>
        </div>
      )}

      {/* Error banner */}
      {(error || localError) && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 text-rose-400 text-xs font-semibold">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error || localError}
        </div>
      )}

      {/* ── Wizard ── */}
      {showWizard && (
        <div className="border-t border-slate-800/50 pt-4 space-y-4">

          {/* Phase 0: API key input */}
          {phase === 0 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  ClickUp API Token
                  <span className="ml-1 font-normal text-slate-600 normal-case">
                    — ClickUp → Settings → Apps → API Token
                  </span>
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
                    placeholder="pk_••••••••••••••••••••••••••••"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 pr-9 text-xs text-slate-200 outline-none transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-600">Validated against ClickUp API, then stored encrypted. Never shown again.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={validating || !apiKey.trim()}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {validating ? 'Validating…' : 'Validate Key'}
                </button>
                <button type="button" onClick={resetWizard}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg border border-slate-800 transition-colors">
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          )}

          {/* Phase 1: pick workspace + space */}
          {phase === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[10px] text-emerald-400 font-semibold">
                  API token validated — {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''} found
                </span>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Workspace</label>
                <select
                  value={wsId}
                  onChange={(e) => handleWorkspaceChange(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors"
                >
                  <option value="">— Select workspace —</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              {wsId && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    Space
                    {fetchingSpaces && <RefreshCw className="w-3 h-3 animate-spin text-slate-500" />}
                  </label>
                  {!fetchingSpaces && spaces.length === 0 ? (
                    <p className="text-[10px] text-slate-600 italic">No spaces found in this workspace.</p>
                  ) : (
                    <select
                      value={spaceId}
                      onChange={(e) => {
                        const sp = spaces.find((s) => s.id === e.target.value);
                        setSpaceId(e.target.value);
                        setSpaceName(sp?.name || '');
                      }}
                      disabled={fetchingSpaces}
                      className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors disabled:opacity-50"
                    >
                      <option value="">— Select space —</option>
                      {spaces.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                  {spaceId && (
                    <p className="text-[10px] text-slate-600">
                      New tenant folders will be created inside <span className="text-slate-400 font-mono">{wsName} → {spaceName}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading || !wsId || !spaceId}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
                >
                  <Plug className="w-3 h-3" />
                  {loading ? 'Connecting…' : 'Save & Connect'}
                </button>
                <button
                  type="button"
                  onClick={() => { setPhase(0); setLocalError(''); }}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg border border-slate-800 transition-colors"
                >
                  Back
                </button>
                <button type="button" onClick={resetWizard}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-3 py-2 rounded-lg border border-slate-800 transition-colors">
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!showWizard && (
        <div className="flex items-center gap-2 flex-wrap border-t border-slate-800/50 pt-3">
          {!isConnected && (
            <button
              onClick={() => { setShowWizard(true); setPhase(0); }}
              disabled={loading}
              className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plug className="w-3 h-3" />
              Connect ClickUp
            </button>
          )}
          {isConnected && (
            <>
              <button
                onClick={() => { setShowWizard(true); setPhase(0); }}
                className="flex items-center gap-1.5 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 text-slate-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                Update
              </button>
              <button
                onClick={onDisconnect}
                disabled={loading}
                className="flex items-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {loading ? '…' : 'Disconnect'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main Integrations Page ───────────────────────────────────────────────────
export const Integrations = () => {
  // ── Notes provider state ──────────────────────────────────────────────────
  const { selectedTenant, tenantId } = useTenant();
  const { isSuperAdmin } = useAuth();
  const [providerStatus,  setProviderStatus]  = useState([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [actionLoading,   setActionLoading]   = useState(null); // providerType string
  const [providerError,   setProviderError]   = useState('');

  // ── Fireflies AI connection state ────────────────────────────────────────
  const [ffConn,          setFfConn]          = useState(null);
  const [ffLoading,       setFfLoading]       = useState(false);
  const [ffError,         setFfError]         = useState('');
  const [ffWarning,       setFfWarning]       = useState('');
  const [ffTestResult,    setFfTestResult]    = useState(null);

  // ── Microsoft 365 connection state ───────────────────────────────────────
  const [msStatus,            setMsStatus]            = useState(null);
  const [calendlyUrl,         setCalendlyUrl]          = useState('');
  const [calendlyInput,       setCalendlyInput]        = useState('');
  const [calendlySaving,      setCalendlySaving]       = useState(false);
  const [calendlyMsg,         setCalendlyMsg]          = useState('');
  const [calendlyToken,       setCalendlyToken]        = useState('');
  const [calendlyTokenStored, setCalendlyTokenStored]  = useState(false);
  const [tokenSaving,         setTokenSaving]          = useState(false);
  const [tokenMsg,            setTokenMsg]             = useState('');

  // ── ClickUp integration state ─────────────────────────────────────────────
  const [cuConn,          setCuConn]          = useState(null);
  const [cuLoading,       setCuLoading]       = useState(false);
  const [cuActionLoading, setCuActionLoading] = useState(false);
  const [cuError,         setCuError]         = useState('');

  // ── Notes provider logic ──────────────────────────────────────────────────
  const loadProviders = useCallback(async () => {
    if (!tenantId) return;
    setProviderLoading(true);
    setProviderError('');
    try {
      const status = await api.providers.getStatus();
      setProviderStatus(status);
    } catch (err) {
      setProviderError('Failed to load provider data.');
      console.error(err);
    } finally {
      setProviderLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleProviderConnect = async (providerType, oauthAccountEmail, providerWorkspaceId) => {
    setActionLoading(providerType);
    setProviderError('');
    try {
      await api.providers.connect({ providerType, oauthAccountEmail, providerWorkspaceId });
      await loadProviders();
    } catch (err) {
      setProviderError(err?.response?.data?.error || 'Failed to connect provider.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleProviderDisable = async (id) => {
    setActionLoading(id);
    setProviderError('');
    try {
      await api.providers.disable(id);
      await loadProviders();
    } catch (err) {
      setProviderError(err?.response?.data?.error || 'Failed to disable provider.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleProviderRemove = async (id) => {
    setActionLoading(id);
    setProviderError('');
    try {
      await api.providers.remove(id);
      await loadProviders();
    } catch (err) {
      setProviderError(err?.response?.data?.error || 'Failed to remove provider.');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Fireflies AI logic ────────────────────────────────────────────────────
  const loadFireflies = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await api.fireflies.getConnection(tenantId);
      setFfConn(data);
    } catch {
      setFfConn({ connected: false, status: 'disconnected' });
    }
  }, [tenantId]);

  useEffect(() => { loadFireflies(); }, [loadFireflies]);

  const handleFirefliesSave = async (apiKey) => {
    setFfLoading(true);
    setFfError('');
    setFfWarning('');
    setFfTestResult(null);
    try {
      const data = await api.fireflies.saveConnection(tenantId, apiKey);
      setFfConn(data);
      if (data.warning) setFfWarning(data.warning);
    } catch (err) {
      setFfError(err?.response?.data?.error || 'Failed to save Fireflies connection.');
    } finally {
      setFfLoading(false);
    }
  };

  const handleFirefliesTest = async () => {
    setFfLoading(true);
    setFfError('');
    setFfWarning('');
    setFfTestResult(null);
    try {
      const result = await api.fireflies.testConnection(tenantId);
      setFfTestResult(result);
    } catch (err) {
      setFfTestResult({ success: false, error: err?.response?.data?.error || err.message });
    } finally {
      setFfLoading(false);
    }
  };

  const handleFirefliesDisconnect = async () => {
    if (!window.confirm('Disconnect Fireflies AI? The fred@fireflies.ai bot will no longer be added to new meeting invites.')) return;
    setFfLoading(true);
    setFfError('');
    setFfWarning('');
    setFfTestResult(null);
    try {
      await api.fireflies.disconnect(tenantId);
      setFfConn({ connected: false, status: 'disconnected' });
    } catch (err) {
      setFfError(err?.response?.data?.error || 'Failed to disconnect Fireflies.');
    } finally {
      setFfLoading(false);
    }
  };

  // ── Microsoft 365 status load ────────────────────────────────────────────
  const loadMsStatus = useCallback(async () => {
    try {
      const msData = await api.microsoft.getStatus().catch(() => ({ status: 'not_connected' }));
      setMsStatus(msData);
      if (msData?.calendlyUrl) {
        setCalendlyUrl(msData.calendlyUrl);
        setCalendlyInput(msData.calendlyUrl);
      }
      if (msData?.calendlyTokenStored) {
        setCalendlyTokenStored(true);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleSaveCalendlyUrl = async (e) => {
    e.preventDefault();
    if (!calendlyInput.trim()) return;
    setCalendlySaving(true);
    setCalendlyMsg('');
    try {
      await api.microsoft.saveCalendlyUrl(calendlyInput.trim());
      setCalendlyUrl(calendlyInput.trim());
      setCalendlyMsg('Calendly URL saved.');
    } catch (err) {
      setCalendlyMsg(err?.response?.data?.error || 'Failed to save Calendly URL.');
    } finally {
      setCalendlySaving(false);
    }
  };

  const handleSaveCalendlyToken = async (e) => {
    e.preventDefault();
    if (!calendlyToken.trim()) return;
    setTokenSaving(true);
    setTokenMsg('');
    try {
      await api.microsoft.saveCalendlyToken(calendlyToken.trim());
      setCalendlyTokenStored(true);
      setCalendlyToken('');
      setTokenMsg('Token saved and encrypted. Auto-sync is now active — bookings will appear automatically every 6 hours.');
    } catch (err) {
      setTokenMsg(err?.response?.data?.error || 'Failed to save token.');
    } finally {
      setTokenSaving(false);
    }
  };

  const handleClearCalendlyToken = async () => {
    try {
      await api.microsoft.clearCalendlyToken();
      setCalendlyTokenStored(false);
      setTokenMsg('Token removed. Auto-sync is paused until a new token is entered.');
    } catch (err) {
      setTokenMsg(err?.response?.data?.error || 'Failed to remove token.');
    }
  };

  useEffect(() => { loadMsStatus(); }, [loadMsStatus]);

  // ── ClickUp logic ────────────────────────────────────────────────────────
  const loadClickUp = useCallback(async () => {
    if (!isSuperAdmin()) return;
    setCuLoading(true);
    try {
      const data = await api.clickup.getConnection();
      setCuConn(data);
    } catch {
      setCuConn({ connected: false, status: 'disconnected' });
    } finally {
      setCuLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => { loadClickUp(); }, [loadClickUp]);

  const handleClickUpSave = async ({ apiKey, workspaceId, workspaceName, spaceId, spaceName }) => {
    setCuActionLoading(true);
    setCuError('');
    try {
      const data = await api.clickup.saveConnection({ apiKey, workspaceId, workspaceName, spaceId, spaceName });
      setCuConn({ ...data, connected: true });
    } catch (err) {
      setCuError(err?.response?.data?.error || 'Failed to save ClickUp connection.');
    } finally {
      setCuActionLoading(false);
    }
  };

  const handleClickUpDisconnect = async () => {
    if (!window.confirm('Disconnect ClickUp? Approved tasks will no longer be pushed and status sync will stop.')) return;
    setCuActionLoading(true);
    setCuError('');
    try {
      await api.clickup.disconnect();
      setCuConn({ connected: false, status: 'disconnected' });
    } catch (err) {
      setCuError(err?.response?.data?.error || 'Failed to disconnect ClickUp.');
    } finally {
      setCuActionLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-10">

      {/* ══════════ SECTION 1: Meeting Notes Providers ══════════ */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-2xl font-extrabold text-white font-sans tracking-tight">Meeting Notes Providers</h2>
            <p className="text-xs text-slate-400">
              Configure external providers to import transcripts and notes into meeting logs
            </p>
            {selectedTenant && (
              <p className="text-[10px] text-indigo-400 mt-1 font-medium">
                Managing providers for: <span className="font-bold">{selectedTenant.name}</span>
              </p>
            )}
          </div>
          <button
            onClick={loadProviders}
            disabled={providerLoading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 px-3 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${providerLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {!tenantId ? (
          <div className="glass-panel p-8 text-center">
            <HelpCircle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-500">No tenant selected</p>
            <p className="text-xs text-slate-600 mt-1">Select a tenant from the sidebar to manage meeting notes providers.</p>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Error message */}
            {providerError && (
              <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-3 text-rose-400 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {providerError}
                <button onClick={() => setProviderError('')} className="ml-auto text-rose-500 hover:text-rose-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {providerLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
              </div>
            ) : (
              <>
                {/* Built-in providers — informational only */}
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                    Built-in Providers
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {providerStatus
                      .filter(p => p.connectionStatus === 'built_in')
                      .map(p => (
                        <ProviderCard
                          key={p.providerType}
                          provider={p}
                          onConnect={handleProviderConnect}
                          onDisable={handleProviderDisable}
                          onRemove={handleProviderRemove}
                          actionLoading={actionLoading}
                        />
                      ))}
                  </div>
                </div>

              </>
            )}
          </div>
        )}
      </div>

      {/* ══════════ SECTION 2: Fireflies AI Transcription ══════════ */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-2xl font-extrabold text-white font-sans tracking-tight">AI Transcription</h2>
            <p className="text-xs text-slate-400">
              Connect Fireflies AI to enable automatic Hindi + English transcription for conducted meetings
            </p>
            {selectedTenant && (
              <p className="text-[10px] text-indigo-400 mt-1 font-medium">
                Managing for: <span className="font-bold">{selectedTenant.name}</span>
              </p>
            )}
          </div>
          <button
            onClick={loadFireflies}
            disabled={ffLoading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 px-3 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${ffLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {!tenantId ? (
          <div className="glass-panel p-8 text-center">
            <HelpCircle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-500">No tenant selected</p>
            <p className="text-xs text-slate-600 mt-1">Select a tenant from the sidebar to manage Fireflies AI.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <FirefliesConnectionCard
              connection={ffConn}
              onSave={handleFirefliesSave}
              onTest={handleFirefliesTest}
              onDisconnect={handleFirefliesDisconnect}
              loading={ffLoading}
              error={ffError}
              warning={ffWarning}
              testResult={ffTestResult}
            />

            {/* How it works */}
            <div className="glass-panel p-4 bg-slate-900/40 flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <h4 className="font-bold text-slate-200">How Fireflies AI works in NxgSecure</h4>
                <ol className="text-slate-400 leading-relaxed space-y-0.5 list-decimal list-inside">
                  <li>Schedule a meeting in NxgSecure — <span className="text-violet-300 font-mono">fred@fireflies.ai</span> is auto-added to the Teams invite.</li>
                  <li>Fireflies bot joins the meeting and records both Hindi and English.</li>
                  <li>Click <span className="text-slate-200 font-semibold">Mark Conducted</span> — NxgSecure starts polling Fireflies for the transcript (every 15 min, up to 2 hrs).</li>
                  <li>Transcript is imported, processed by Ollama, and AI task recommendations appear for AM review.</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* ══════════ SECTION 3: Microsoft 365 ══════════ */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-2xl font-extrabold text-white font-sans tracking-tight">Microsoft 365</h2>
            <p className="text-xs text-slate-400">
              Connect Microsoft 365 to create Teams meetings — Calendly sync optional for booking management
            </p>
          </div>
          <button
            onClick={loadMsStatus}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 px-3 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {!tenantId ? (
          <div className="glass-panel p-8 text-center">
            <HelpCircle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-500">No tenant selected</p>
            <p className="text-xs text-slate-600 mt-1">Select a tenant to manage Microsoft 365.</p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Microsoft OAuth connect card */}
            <div className="glass-panel p-5 border border-indigo-500/25">
              <MicrosoftConnectButton tenantId={tenantId} onStatusChange={setMsStatus} />
            </div>

            {/* Calendly booking URL */}
            <div className="glass-panel p-5 space-y-4 border border-slate-700/50">
              <div>
                <h4 className="text-sm font-bold text-slate-200">Calendly Booking Link</h4>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  Your Calendly scheduling URL — sent to clients when booking security review sessions.
                </p>
              </div>

              {calendlyUrl && (
                <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/50 rounded-lg px-3 py-2">
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="font-mono text-slate-300 truncate">{calendlyUrl}</span>
                </div>
              )}

              <form onSubmit={handleSaveCalendlyUrl} className="flex gap-2">
                <input
                  type="url"
                  value={calendlyInput}
                  onChange={(e) => setCalendlyInput(e.target.value)}
                  placeholder="https://calendly.com/your-link"
                  className="flex-1 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={calendlySaving || !calendlyInput.trim()}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0"
                >
                  {calendlySaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                  {calendlySaving ? 'Saving…' : 'Save URL'}
                </button>
              </form>
              {calendlyMsg && (
                <p className={`text-xs ${calendlyMsg.toLowerCase().includes('saved') ? 'text-emerald-400' : 'text-rose-400'}`}>{calendlyMsg}</p>
              )}

              {/* Calendly API token for auto-sync */}
              <div className="border-t border-slate-800/50 pt-4 space-y-3">
                <div>
                  <h5 className="text-xs font-bold text-slate-300">
                    Calendly API Token <span className="font-normal text-slate-500">(optional — auto-sync)</span>
                  </h5>
                  <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                    Enables the booking watcher to import Calendly bookings automatically every 6 hours.
                  </p>
                </div>

                {calendlyTokenStored ? (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Token saved — auto-sync active
                    </div>
                    <button
                      onClick={handleClearCalendlyToken}
                      className="text-[10px] text-rose-400 hover:text-rose-300 border border-rose-500/30 px-2 py-1 rounded-lg transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveCalendlyToken} className="flex gap-2">
                    <input
                      type="password"
                      value={calendlyToken}
                      onChange={(e) => setCalendlyToken(e.target.value)}
                      placeholder="Paste your Calendly API token…"
                      className="flex-1 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors font-mono"
                    />
                    <button
                      type="submit"
                      disabled={tokenSaving || !calendlyToken.trim()}
                      className="flex items-center gap-1.5 bg-indigo-600/70 hover:bg-indigo-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0"
                    >
                      {tokenSaving && <RefreshCw className="w-3 h-3 animate-spin" />}
                      {tokenSaving ? 'Saving…' : 'Save Token'}
                    </button>
                  </form>
                )}
                {tokenMsg && (
                  <p className={`text-xs ${tokenMsg.includes('active') || tokenMsg.includes('saved') ? 'text-emerald-400' : 'text-slate-400'}`}>{tokenMsg}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════ SECTION 4: ClickUp Integration ══════════ */}
      {isSuperAdmin() && (
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div>
              <h2 className="text-2xl font-extrabold text-white font-sans tracking-tight">ClickUp Integration</h2>
              <p className="text-xs text-slate-400">
                Connect your ClickUp workspace — approved tasks push automatically and status syncs every 6 hours
              </p>
              <p className="text-[10px] text-amber-400/80 mt-1 font-medium">
                Super Admin — applies globally to all tenants
              </p>
            </div>
            <button
              onClick={loadClickUp}
              disabled={cuLoading}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 px-3 py-2 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cuLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {cuLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <ClickUpConnectionCard
                connection={cuConn}
                onSave={handleClickUpSave}
                onDisconnect={handleClickUpDisconnect}
                loading={cuActionLoading}
                error={cuError}
              />

              {/* How it works */}
              <div className="glass-panel p-4 bg-slate-900/40 flex items-start gap-3">
                <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h4 className="font-bold text-slate-200">How ClickUp sync works</h4>
                  <ol className="text-slate-400 leading-relaxed space-y-0.5 list-decimal list-inside">
                    <li>AM approves a task recommendation — it's pushed to ClickUp within seconds via BullMQ.</li>
                    <li>Task lands in <span className="text-emerald-300 font-mono">{'<TenantName> - Monthly Meeting'}</span> → <span className="text-emerald-300 font-mono">Action Items</span> list.</li>
                    <li>Team updates the task in ClickUp — NxgSecure polls every 6 hours and reflects the latest status.</li>
                    <li>When ClickUp marks a task complete, it's auto-completed in NxgSecure too.</li>
                    <li>New tenants get their folder created automatically on account creation.</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
