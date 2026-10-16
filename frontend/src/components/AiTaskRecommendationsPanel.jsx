import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import {
  Sparkles, ThumbsUp, ThumbsDown, CheckCircle2, XCircle,
  RefreshCw, AlertTriangle, ChevronDown, ChevronUp, RotateCcw, Pencil, Upload,
} from 'lucide-react';

const POLL_MS = 3000;

// Normalise a title for duplicate comparison: lowercase, strip punctuation, collapse spaces.
const normalizeTitle = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

// Deduplicate recs by normalised title.
// Priority: approved > rejected > pending; within same status keep newest.
const STATUS_ORDER = { approved: 0, rejected: 1, pending: 2 };
function deduplicateRecs(recs) {
  const sorted = [...recs].sort((a, b) => {
    const pa = STATUS_ORDER[a.approvalStatus] ?? 3;
    const pb = STATUS_ORDER[b.approvalStatus] ?? 3;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const seen = new Set();
  return sorted.filter((r) => {
    const key = normalizeTitle(r.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SEV_COLOR = {
  critical: 'text-rose-400   border-rose-500/30   bg-rose-500/5',
  high:     'text-amber-400  border-amber-500/30  bg-amber-500/5',
  medium:   'text-indigo-400 border-indigo-500/30 bg-indigo-500/5',
  low:      'text-slate-400  border-slate-600      bg-slate-800/40',
};

const SEVERITIES   = ['critical', 'high', 'medium', 'low'];
const STRATEGIES   = ['immediate_fix', 'workaround', 'long_term_fix', 'escalation'];
const OWNER_TYPES  = ['CUSTOMER', 'ACCOUNT_MANAGER', 'SHARED'];
const CATEGORIES   = ['Vulnerability Management', 'Access Control', 'Configuration', 'Patching', 'MFA', 'EDR Coverage', 'Other'];

function Field({ label, children }) {
  return (
    <div className="space-y-0.5">
      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function RecommendationCard({ rec, tenantId, onUpdate }) {
  const [loading,      setLoading]      = useState(false);
  const [editMode,     setEditMode]     = useState(false);
  const [rejectMode,   setRejectMode]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [expanded,     setExpanded]     = useState(false);
  const [actionError,  setActionError]  = useState('');
  const [pushed,       setPushed]       = useState(!!rec.clickupTaskId);

  // Edit form state — initialised from rec on open
  const [draft, setDraft] = useState({});

  const isPending  = rec.approvalStatus === 'pending';
  const isApproved = rec.approvalStatus === 'approved';
  const isRejected = rec.approvalStatus === 'rejected';
  const sevColor   = SEV_COLOR[rec.severity] || SEV_COLOR.low;

  const openEdit = () => {
    setDraft({
      title:                rec.title               || '',
      severity:             rec.severity            || 'medium',
      actionPlan:           rec.actionPlan          || '',
      businessImpact:       rec.businessImpact      || '',
      category:             rec.category            || '',
      remediationStrategy:  rec.remediationStrategy || 'long_term_fix',
      recommendedOwner:     rec.recommendedOwner    || '',
      recommendedOwnerType: rec.recommendedOwnerType|| 'ACCOUNT_MANAGER',
      dueDateSuggestion:    rec.dueDateSuggestion ? rec.dueDateSuggestion.slice(0, 10) : '',
    });
    setActionError('');
    setEditMode(true);
    setExpanded(false);
  };

  const handleSave = async () => {
    setLoading(true);
    setActionError('');
    try {
      await api.ai.update(rec.id, { tenantId, ...draft });
      setEditMode(false);
      onUpdate();
    } catch (err) {
      setActionError(err?.response?.data?.error || 'Save failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setLoading(true);
    setActionError('');
    try {
      await api.ai.approve(rec.id, { tenantId });
      onUpdate();
    } catch (err) {
      setActionError(err?.response?.data?.error || 'Approval failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setActionError('');
    try {
      await api.ai.reject(rec.id, { tenantId, reason: rejectReason.trim() || 'Rejected by AM' });
      setRejectMode(false);
      setRejectReason('');
      onUpdate();
    } catch (err) {
      setActionError(err?.response?.data?.error || 'Rejection failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePushClickUp = async () => {
    if (!rec.taskId) return;
    setLoading(true);
    setActionError('');
    try {
      await api.ai.pushClickUp(rec.taskId);
      setPushed(true);
    } catch (err) {
      setActionError(err?.response?.data?.error || 'ClickUp push failed.');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none transition-colors';
  const selectCls = inputCls + ' cursor-pointer';

  return (
    <div className={`rounded-xl border p-3 space-y-2 transition-all ${
      isApproved ? 'border-emerald-500/30 bg-emerald-500/5 opacity-80' :
      isRejected ? 'border-slate-700/50 bg-slate-900/40 opacity-50'   :
      editMode   ? 'border-indigo-500/40 bg-indigo-500/5'              :
      'border-slate-800/60 bg-slate-900/30'
    }`}>

      {/* ── Header row ── */}
      <div className="flex items-start gap-2">
        <p className={`flex-1 text-xs font-semibold leading-tight min-w-0 ${isRejected ? 'line-through text-slate-500' : 'text-slate-200'}`}>
          {rec.title}
        </p>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${sevColor}`}>
            {rec.severity}
          </span>
          {rec.analysisType === 'post_meeting' && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-teal-500/30 bg-teal-500/10 text-teal-400 font-bold">
              Post-Meeting
            </span>
          )}
          {isApproved && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold flex items-center gap-0.5">
              <CheckCircle2 className="w-2.5 h-2.5" /> Approved
            </span>
          )}
          {isApproved && rec.taskId && (
            pushed ? (
              rec.clickupUrl ? (
                <a
                  href={rec.clickupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-400 font-bold flex items-center gap-0.5"
                >
                  <CheckCircle2 className="w-2.5 h-2.5" /> In ClickUp ↗
                </a>
              ) : (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-400 font-bold flex items-center gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" /> In ClickUp
                </span>
              )
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={handlePushClickUp}
                className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 font-bold flex items-center gap-0.5 transition-colors disabled:opacity-50"
              >
                {loading ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Upload className="w-2.5 h-2.5" />}
                Push to ClickUp
              </button>
            )
          )}
          {isRejected && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-slate-600 bg-slate-800 text-slate-500 font-bold flex items-center gap-0.5">
              <XCircle className="w-2.5 h-2.5" /> Rejected
            </span>
          )}
          {!editMode && !isApproved && !isRejected && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-slate-600 hover:text-slate-400 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Read-only expanded detail ── */}
      {expanded && !editMode && (
        <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
          {rec.businessImpact && (
            <p className="text-[11px] text-slate-400"><span className="font-semibold text-slate-300">Impact:</span> {rec.businessImpact}</p>
          )}
          {rec.actionPlan && (
            <p className="text-[11px] text-slate-400 whitespace-pre-line"><span className="font-semibold text-slate-300">Plan:</span> {rec.actionPlan}</p>
          )}
          {rec.recommendedOwner && (
            <p className="text-[11px] text-slate-500"><span className="font-semibold text-slate-400">Owner:</span> {rec.recommendedOwner} <span className="text-slate-600">({rec.recommendedOwnerType})</span></p>
          )}
          {rec.remediationStrategy && (
            <p className="text-[11px] text-slate-500"><span className="font-semibold text-slate-400">Strategy:</span> {rec.remediationStrategy.replace(/_/g, ' ')}</p>
          )}
          {rec.dueDateSuggestion && (
            <p className="text-[11px] text-slate-500"><span className="font-semibold text-slate-400">Due:</span> {rec.dueDateSuggestion.slice(0, 10)}</p>
          )}
        </div>
      )}

      {/* ── Inline edit form ── */}
      {editMode && (
        <div className="space-y-3 pt-2 border-t border-indigo-500/20">
          <Field label="Title">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              maxLength={255}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Severity">
              <select value={draft.severity} onChange={(e) => setDraft((d) => ({ ...d, severity: e.target.value }))} className={selectCls}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Strategy">
              <select value={draft.remediationStrategy} onChange={(e) => setDraft((d) => ({ ...d, remediationStrategy: e.target.value }))} className={selectCls}>
                {STRATEGIES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Action Plan">
            <textarea
              value={draft.actionPlan}
              onChange={(e) => setDraft((d) => ({ ...d, actionPlan: e.target.value }))}
              rows={3}
              className={inputCls + ' resize-none leading-relaxed'}
            />
          </Field>

          <Field label="Business Impact">
            <textarea
              value={draft.businessImpact}
              onChange={(e) => setDraft((d) => ({ ...d, businessImpact: e.target.value }))}
              rows={2}
              className={inputCls + ' resize-none leading-relaxed'}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} className={selectCls}>
                <option value="">— none —</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Owner Type">
              <select value={draft.recommendedOwnerType} onChange={(e) => setDraft((d) => ({ ...d, recommendedOwnerType: e.target.value }))} className={selectCls}>
                {OWNER_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Recommended Owner">
              <input
                type="text"
                value={draft.recommendedOwner}
                onChange={(e) => setDraft((d) => ({ ...d, recommendedOwner: e.target.value }))}
                placeholder="Role or name"
                className={inputCls}
              />
            </Field>
            <Field label="Due Date">
              <input
                type="date"
                value={draft.dueDateSuggestion}
                onChange={(e) => setDraft((d) => ({ ...d, dueDateSuggestion: e.target.value }))}
                className={inputCls}
              />
            </Field>
          </div>

          {actionError && (
            <p className="text-[11px] text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> {actionError}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={loading || !draft.title.trim()}
              onClick={handleSave}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-300 hover:text-indigo-200 border border-indigo-500/40 hover:border-indigo-400/60 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
            >
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Save Changes
            </button>
            <button
              type="button"
              onClick={() => { setEditMode(false); setActionError(''); }}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Action error (outside edit mode) ── */}
      {!editMode && actionError && (
        <p className="text-[11px] text-rose-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {actionError}
        </p>
      )}

      {/* ── Pending action buttons ── */}
      {isPending && !editMode && !rejectMode && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button
            type="button"
            disabled={loading}
            onClick={handleApprove}
            className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-400/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
            Approve &amp; Create Task
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={openEdit}
            className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-400/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setRejectMode(true)}
            className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            <ThumbsDown className="w-3 h-3" /> Reject
          </button>
        </div>
      )}

      {/* ── Reject reason input ── */}
      {isPending && rejectMode && (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 focus:border-rose-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none transition-colors"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={handleReject}
              className="flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 border border-rose-500/30 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
              Confirm Reject
            </button>
            <button
              type="button"
              onClick={() => { setRejectMode(false); setRejectReason(''); }}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact AI recommendations panel for the Logs page.
 * Shows all recommendations for a meeting with inline approve/reject.
 * Supports re-running the post-meeting AI analysis to generate more tasks.
 */
export default function AiTaskRecommendationsPanel({ meetingId, tenantId, refreshTrigger }) {
  const [recs,       setRecs]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [rerunning,  setRerunning]  = useState(false);
  const [aiStatus,   setAiStatus]   = useState(null);
  const [error,      setError]      = useState('');
  const [open,       setOpen]       = useState(true);

  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const load = useCallback(async () => {
    if (!meetingId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.ai.listRecommendations({ tenantId, meetingId });
      setRecs(deduplicateRecs(data?.recommendations || []));
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load recommendations.');
    } finally {
      setLoading(false);
    }
  }, [meetingId, tenantId]);

  // Poll ai_status while reanalysis is running
  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const note   = await api.meetingLogs.getById(meetingId);
        const status = note?.aiStatus ?? note?.ai_status ?? null;
        setAiStatus(status);
        if (status === 'completed' || status === 'failed') {
          stopPolling();
          setRerunning(false);
          if (status === 'completed') load();
        }
      } catch { /* transient — keep polling */ }
    }, POLL_MS);
  }, [meetingId, load, stopPolling]);

  useEffect(() => { load(); }, [load, refreshTrigger]);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleRerun = async () => {
    setError('');
    setRerunning(true);
    setAiStatus('pending');
    try {
      await api.meetingLogs.reanalyze(meetingId);
      startPolling();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to start re-analysis.');
      setRerunning(false);
      setAiStatus(null);
    }
  };

  const pendingCount = recs.filter((r) => r.approvalStatus === 'pending').length;
  const postCount    = recs.filter((r) => r.analysisType === 'post_meeting').length;

  return (
    <div className="glass-panel p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">AI Generated Tasks</h3>
          {postCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-teal-500/30 bg-teal-500/10 text-teal-400 font-bold">
              {postCount} post-meeting
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/20 text-violet-300 font-bold">
              {pendingCount} pending
            </span>
          )}
          {rerunning && (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-400 font-bold">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              {aiStatus === 'processing' ? 'AI Analysing…' : 'Processing…'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunning}
            title="Re-run AI analysis to generate more tasks"
            className="flex items-center gap-1 text-[10px] font-bold text-violet-400 hover:text-violet-300 border border-violet-500/30 hover:border-violet-400/50 px-2 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3 h-3" />
            Re-run AI
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-1.5 text-slate-600 hover:text-slate-300 transition-colors rounded"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {recs.length > 0 && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-slate-500 hover:text-slate-300 transition-colors">
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {rerunning && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5">
          <p className="text-xs text-violet-300 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 animate-pulse shrink-0" />
            AI is generating additional task recommendations from the meeting notes…
          </p>
        </div>
      )}

      {aiStatus === 'failed' && !rerunning && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
          <p className="text-xs text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Last re-run failed — click Re-run AI to try again.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}

      {/* Empty state */}
      {!loading && !error && recs.length === 0 && (
        <p className="text-xs text-slate-600 italic">
          No AI recommendations yet. Submit meeting notes above to generate post-meeting tasks.
        </p>
      )}

      {/* Loading skeleton */}
      {loading && recs.length === 0 && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 rounded-xl bg-slate-800/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Recommendation cards */}
      {open && recs.length > 0 && (
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
          {recs.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              tenantId={tenantId}
              onUpdate={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
