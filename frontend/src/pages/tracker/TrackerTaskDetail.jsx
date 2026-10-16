import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Calendar, Building2, Users, Clock, TrendingUp, AlertTriangle,
  CheckCircle2, ChevronRight, Edit3, RefreshCcw, ShieldAlert, Hash, Tag,
  Server, ClipboardCheck, Layers, Save, X, GitBranch, AlertOctagon, ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { api } from '../../services/api';
import { useTenant } from '../../context/TenantContext';
import { StatusBadge, SeverityBadge } from '../../components/tracker/TrackerBadges';
import { PRIORITY_LEVELS, REVIEW_OUTCOMES, BLOCKER_TYPES } from '../../services/trackerMockData';

// ─── Progress Ring ────────────────────────────────────────────
const ProgressRing = ({ percentage, size = 72, strokeWidth = 6, status }) => {
  const colorMap = {
    completed: '#10b981',
    overdue: '#f43f5e',
    escalated: '#ef4444',
    awaiting_validation: '#f59e0b',
    in_progress: '#3b82f6',
    open: '#64748b',
    blocked: '#a855f7',
  };
  const color = colorMap[status] || '#6366f1';
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(148,163,184,0.1)" strokeWidth={strokeWidth} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        stroke={color} strokeWidth={strokeWidth} fill="none"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
      />
    </svg>
  );
};

// ─── Info Row ─────────────────────────────────────────────────
const InfoRow = ({ icon: Icon, label, value, mono = false, accent }) => (
  <div className="flex items-start gap-3 py-2.5 border-b border-slate-800/50 last:border-0">
    <Icon className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider w-32 shrink-0">{label}</span>
    <span className={`text-sm flex-1 ${mono ? 'font-mono' : ''} ${accent || 'text-slate-200'}`}>{value}</span>
  </div>
);

// ─── Avatar ───────────────────────────────────────────────────
const Avatar = ({ initials, color = 'indigo' }) => {
  const colors = {
    indigo: 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400',
    sky: 'bg-sky-500/20 border-sky-500/30 text-sky-400',
    emerald: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
  };
  return (
    <div className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 font-bold text-xs ${colors[color] || colors.indigo}`}>
      {initials}
    </div>
  );
};

// ─── Priority badge ───────────────────────────────────────────
const PriorityBadge = ({ priority }) => {
  const meta = PRIORITY_LEVELS[priority] || PRIORITY_LEVELS.P4;
  return (
    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-extrabold uppercase border tracking-wider ${meta.color}`}>
      {meta.label}
    </span>
  );
};

// ─── Escalation status badge ──────────────────────────────────
const EscalationBadge = ({ status }) => {
  if (!status || status === 'none') return null;
  const styles = {
    eligible:  'bg-amber-500/15 text-amber-400 border-amber-500/20',
    escalated: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  };
  const labels = { eligible: '⚠ Escalation Eligible', escalated: '🔴 Escalated' };
  return (
    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-extrabold uppercase border tracking-wider ${styles[status] || ''}`}>
      {labels[status] || status}
    </span>
  );
};

// ─── Meeting history action label ─────────────────────────────
const historyActionStyle = {
  created:      'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  carry_forward:'text-orange-400 bg-orange-500/10 border-orange-500/20',
  reattached:   'text-sky-400 bg-sky-500/10 border-sky-500/20',
  completed:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
};

// ─── Status Change Select ─────────────────────────────────────
const STATUSES = [
  { value: 'open',                label: 'Open' },
  { value: 'in_progress',         label: 'In Progress' },
  { value: 'blocked',             label: 'Blocked' },
  { value: 'awaiting_validation', label: 'Awaiting Validation' },
  { value: 'completed',           label: 'Completed' },
  { value: 'carry_forward',       label: 'Carry Forward' },
  { value: 'escalated',           label: 'Escalated' },
  { value: 'overdue',             label: 'Overdue' },
];

// ─── Task Detail Page ─────────────────────────────────────────
export const TrackerTaskDetail = () => {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tenants, tenantId, selectTenant } = useTenant();
  const urlTenantApplied = useRef(false);

  const [task, setTask] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editProgress, setEditProgress] = useState(0);
  const [editStatus, setEditStatus] = useState('open');
  const [editNotes, setEditNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [completing, setCompleting] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completeError, setCompleteError] = useState('');
  const [syncingClickUp, setSyncingClickUp] = useState(false);
  const [clickUpSyncMsg, setClickUpSyncMsg] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Switch to the tenant specified in the email link ?tenantId= query param (one-time on load)
  const urlTenantId = searchParams.get('tenantId');
  useEffect(() => {
    if (!urlTenantId || urlTenantApplied.current || !tenants.length) return;
    const match = tenants.find((t) => t.id === urlTenantId);
    if (match) {
      selectTenant(match);
      urlTenantApplied.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTenantId, tenants]);

  // Weekly review outcome
  const [reviewOutcome, setReviewOutcome] = useState('on_track');
  const [savingReview, setSavingReview] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);

  // Escalation workflow
  const [escalationStep, setEscalationStep] = useState(1);
  const [escalationBlocker, setEscalationBlocker] = useState('');
  const [escalationReason, setEscalationReason] = useState('');
  const [escalationContact, setEscalationContact] = useState('');
  const [submittingEscalation, setSubmittingEscalation] = useState(false);
  const [escalationDone, setEscalationDone] = useState(false);

  useEffect(() => {
    const loadTask = async () => {
      try {
        const response = await api.tracker.taskById(taskId);
        setTask(response);
        setEditProgress(response?.progressPercentage || 0);
        setEditStatus(response?.status || 'open');
        setEditNotes(response?.notes || '');
        setReviewOutcome(response?.reviewOutcome || 'on_track');
      } catch (error) {
        console.error('Unable to load task detail', error);
        setTask(null);
      }
    };

    loadTask();
  }, [taskId]);

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500 animate-slide-up">
        <AlertTriangle className="w-10 h-10 mb-3 text-amber-500" />
        <p className="text-lg font-semibold text-slate-300">Task not found</p>
        <Link to="/tracker/tasks" className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back to Task List
        </Link>
      </div>
    );
  }

  const dueDate = new Date(task.dueDate);
  const isOverdue = dueDate < new Date() && task.status !== 'completed';
  const meetingDate = new Date(task.meetingDate);

  const handleSave = async () => {
    setSaveError('');
    try {
      await api.tracker.updateTask(taskId, {
        progressPercentage: editProgress,
        status: editStatus,
        notes: editNotes,
      });
      setTask((currentTask) => ({
        ...currentTask,
        progressPercentage: editProgress,
        status: editStatus,
        remediationStatus: editStatus,
        notes: editNotes,
        lastUpdatedDate: new Date().toISOString(),
      }));
      setEditing(false);
      setSaved(true);
      setTimeout(() => { if (mountedRef.current) setSaved(false); }, 3000);
    } catch (err) {
      setSaveError(err?.response?.data?.error || 'Save failed. Please try again.');
    }
  };

  const handleMarkComplete = async () => {
    if (!confirmComplete) {
      setConfirmComplete(true);
      return;
    }
    setCompleteError('');
    setCompleting(true);
    try {
      await api.tracker.updateTask(taskId, { progressPercentage: 100, status: 'completed' });
      if (!mountedRef.current) return;
      setTask((t) => ({ ...t, progressPercentage: 100, status: 'completed', remediationStatus: 'completed', lastUpdatedDate: new Date().toISOString() }));
      setEditProgress(100);
      setEditStatus('completed');
      setConfirmComplete(false);
      setSaved(true);
      setTimeout(() => { if (mountedRef.current) setSaved(false); }, 3000);
    } catch (err) {
      if (!mountedRef.current) return;
      setCompleteError(err?.response?.data?.error || 'Failed to mark complete. Please try again.');
      setConfirmComplete(false);
    } finally {
      if (mountedRef.current) setCompleting(false);
    }
  };

  // Pulls this task's live status from ClickUp right now, then reloads the
  // task so the page reflects whatever came back — instead of waiting up to
  // 30 minutes for the next scheduled sweep. Direct fix for "is this task
  // really missing from ClickUp, or just showing stale data?"
  const handleSyncClickUp = async () => {
    setSyncingClickUp(true);
    setClickUpSyncMsg('');
    try {
      await api.ai.syncClickUp(taskId);
      const refreshed = await api.tracker.taskById(taskId);
      if (mountedRef.current) {
        setTask(refreshed);
        setClickUpSyncMsg('Synced with ClickUp just now.');
        setTimeout(() => { if (mountedRef.current) setClickUpSyncMsg(''); }, 4000);
      }
    } catch (err) {
      if (mountedRef.current) {
        setClickUpSyncMsg(err?.response?.data?.error || 'Could not reach ClickUp — try again shortly.');
      }
    } finally {
      if (mountedRef.current) setSyncingClickUp(false);
    }
  };

  const handleSaveReview = async () => {
    if (!task) return;
    setSavingReview(true);
    try {
      const updated = await api.tracker.setReviewOutcome(
        taskId,
        reviewOutcome,
        task.primaryOwner?.name || 'Account Manager'
      );
      setTask((t) => ({ ...t, reviewOutcome: updated.reviewOutcome || reviewOutcome }));
      setReviewSaved(true);
      setTimeout(() => setReviewSaved(false), 2500);
    } catch (e) {
      console.error('Failed to save review', e);
    } finally {
      setSavingReview(false);
    }
  };

  const handleEscalate = async () => {
    if (!escalationBlocker || !escalationReason.trim()) return;
    setSubmittingEscalation(true);
    try {
      const updated = await api.tracker.triggerEscalation(taskId, {
        blockerType: escalationBlocker,
        escalationReason: escalationReason.trim(),
        notifyContact: escalationContact.trim(),
      });
      setTask((t) => ({
        ...t,
        escalationStatus: updated.escalationStatus || 'escalated',
        escalationCount: updated.escalationCount ?? (t.escalationCount || 0) + 1,
        reviewOutcome: 'escalation_required',
      }));
      setReviewOutcome('escalation_required');
      setEscalationDone(true);
    } catch (e) {
      console.error('Failed to submit escalation', e);
    } finally {
      setSubmittingEscalation(false);
    }
  };

  return (
    <div className="space-y-5 animate-slide-up max-w-6xl">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link to="/meetings" className="hover:text-slate-300 transition-colors">Meetings & Tracker</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-slate-400 font-mono truncate max-w-[200px]">{task.id}</span>
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4 flex-1">
          <button
            onClick={() => navigate('/meetings')}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all mt-0.5 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <SeverityBadge severity={task.severity} size="sm" />
              <StatusBadge status={task.status} size="sm" />
              {task.priority && <PriorityBadge priority={task.priority} />}
              {task.escalationStatus && task.escalationStatus !== 'none' && (
                <EscalationBadge status={task.escalationStatus} />
              )}
              <span className="text-xs font-mono text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50">
                {task.sourceFindingId}
              </span>
            </div>
            <h1 className="text-xl font-extrabold text-white tracking-tight leading-snug">{task.title}</h1>
            <p className="text-sm text-slate-400 mt-1">{task.customerName} · {task.meetingTimeline}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 ml-10 sm:ml-0">
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold animate-slide-up">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
            {editing && (
              <button
                onClick={() => { setEditing(false); setSaveError(''); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-all"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            )}
            {editing && (
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all"
              >
                <Save className="w-3.5 h-3.5" /> Save Changes
              </button>
            )}
            {!editing && task.status !== 'completed' && task.status !== 'blocked' && confirmComplete && (
              <span className="text-xs text-amber-400 font-semibold">Mark as complete?</span>
            )}
            {!editing && task.status !== 'completed' && task.status !== 'blocked' && confirmComplete && (
              <button
                onClick={() => setConfirmComplete(false)}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 transition-all"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            )}
            {!editing && task.status !== 'completed' && task.status !== 'blocked' && confirmComplete && (
              <button
                onClick={handleMarkComplete}
                disabled={completing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-lg shadow-emerald-600/20 transition-all"
              >
                {completing
                  ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                  : <CheckCircle2 className="w-3.5 h-3.5" />}
                Confirm
              </button>
            )}
            {!editing && task.status !== 'completed' && task.status !== 'blocked' && !confirmComplete && (
              <button
                onClick={handleMarkComplete}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark as Complete
              </button>
            )}
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit Task
              </button>
            )}
          </div>
          {completeError && (
            <p className="text-xs text-rose-400 font-medium text-right">{completeError}</p>
          )}
          {saveError && (
            <p className="text-xs text-rose-400 font-medium text-right">{saveError}</p>
          )}
        </div>
      </div>

      {/* ── Main Content Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── LEFT COLUMN (2/3) ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Description */}
          <div className="glass-panel p-5 space-y-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> Finding Description
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">{task.description}</p>
            <div className="flex items-center gap-2 pt-1">
              <Server className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs text-slate-500">Affected System:</span>
              <span className="text-xs font-semibold text-slate-300 font-mono">{task.systemAffected}</span>
            </div>
          </div>

          {/* Resolution Steps / Action Plan */}
          <div className="glass-panel p-5 space-y-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" /> Action Plan
            </h2>
            {Array.isArray(task.resolutionSteps) && task.resolutionSteps.length > 0 ? (
              <div className="space-y-3">
                {task.resolutionSteps.map((step, idx) => {
                  const totalSteps = task.resolutionSteps.length;
                  const doneCount = Math.ceil(task.progressPercentage / (100 / totalSteps));
                  const done = idx < doneCount;
                  return (
                    <div key={idx} className="flex items-start gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                        done
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}>
                        {done ? '✓' : idx + 1}
                      </div>
                      <p className={`text-sm leading-relaxed ${done ? 'text-slate-400 line-through decoration-slate-600' : 'text-slate-300'}`}>
                        {step}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                {task.actionPlan || <span className="text-slate-600 italic">No action plan recorded.</span>}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="glass-panel p-5 space-y-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5 text-indigo-400" /> Notes & Comments
            </h2>
            {editing ? (
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={4}
                placeholder="Add internal notes, blockers, or context..."
                className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 resize-none transition-all"
              />
            ) : (
              <p className="text-sm text-slate-300 leading-relaxed">
                {task.notes || <span className="text-slate-600 italic">No notes added.</span>}
              </p>
            )}
          </div>

          {/* Weekly Review Outcome */}
          <div className="glass-panel p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <ClipboardCheck className="w-3.5 h-3.5 text-sky-400" /> Weekly Review Outcome
              </h2>
              {reviewSaved && (
                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 animate-slide-up">
                  <CheckCircle2 className="w-3 h-3" /> Saved
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500">
              Record the weekly AM review outcome. Updates the Remediation Tracker and weekly reports.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(REVIEW_OUTCOMES).map((outcome) => (
                <button
                  key={outcome.key}
                  onClick={() => setReviewOutcome(outcome.key)}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all text-left ${
                    reviewOutcome === outcome.key
                      ? `${outcome.color} shadow-sm`
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                  }`}
                >
                  {outcome.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
              <span className="text-[10px] text-slate-500">
                {task.lastReviewedBy
                  ? <>Reviewed by <span className="text-slate-400 font-medium">{task.lastReviewedBy}</span>
                    {task.lastReviewedDate && ` · ${new Date(task.lastReviewedDate).toLocaleDateString()}`}</>
                  : 'Not yet reviewed'}
              </span>
              <button
                onClick={handleSaveReview}
                disabled={savingReview || reviewOutcome === (task.reviewOutcome || 'on_track')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white transition-all"
              >
                {savingReview ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save Review
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN (1/3) ── */}
        <div className="space-y-5">

          {/* Progress Card */}
          <div className="glass-panel p-5 space-y-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-blue-400" /> Execution Progress
            </h2>
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <ProgressRing
                  percentage={editing ? editProgress : task.progressPercentage}
                  size={80}
                  strokeWidth={7}
                  status={editing ? editStatus : task.status}
                />
                <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-white">
                  {editing ? editProgress : task.progressPercentage}%
                </span>
              </div>
              <div className="flex-1 space-y-3">
                {editing ? (
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Progress: {editProgress}%</label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={editProgress}
                      onChange={(e) => setEditProgress(Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                ) : null}
                <div className="text-xs text-slate-500 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Open Since Meeting</span>
                    <span className="font-semibold text-indigo-400 text-right max-w-[110px] truncate" title={task.openSinceMeeting}>
                      {task.openSinceMeeting || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Meetings Carried Fwd</span>
                    <span className={`font-semibold ${(task.carryForwardCount || 0) > 0 ? 'text-orange-400' : 'text-slate-400'}`}>
                      {task.carryForwardCount || 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Escalation Eligibility</span>
                    <span className={`font-semibold ${
                      task.escalationStatus === 'escalated' ? 'text-rose-400' :
                      task.escalationStatus === 'eligible' ? 'text-amber-400' : 'text-slate-500'
                    }`}>
                      {task.escalationStatus === 'escalated' ? 'Escalated' :
                       task.escalationStatus === 'eligible' ? 'Eligible' : 'Not Eligible'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Escalations Raised</span>
                    <span className="font-semibold text-red-400">{task.escalationCount || 0}</span>
                  </div>
                </div>
              </div>
            </div>

            {editing && (
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60"
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Escalation Workflow — shown when eligible or when already escalated */}
          {(task.escalationStatus === 'eligible' || task.escalationStatus === 'escalated') && (
            <div className={`glass-panel p-5 space-y-4 border ${
              task.escalationStatus === 'escalated' ? 'border-rose-500/20' : 'border-amber-500/20'
            }`}>
              <h2 className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-2 ${
                task.escalationStatus === 'escalated' ? 'text-rose-400' : 'text-amber-400'
              }`}>
                <AlertOctagon className="w-3.5 h-3.5" />
                {task.escalationStatus === 'escalated' ? 'Escalation Active' : 'Escalation Required'}
              </h2>

              {task.escalationStatus === 'escalated' ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    This task has been formally escalated. Customer IT Head has been notified.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="bg-slate-900/50 rounded-lg p-2.5">
                      <span className="text-slate-500 block mb-0.5">Escalations Raised</span>
                      <span className="text-rose-400 font-extrabold text-base">{task.escalationCount || 0}</span>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-2.5">
                      <span className="text-slate-500 block mb-0.5">Carry Forwards</span>
                      <span className="text-amber-400 font-extrabold text-base">{task.carryForwardCount || 0}</span>
                    </div>
                  </div>
                </div>
              ) : escalationDone ? (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-center space-y-1">
                  <AlertOctagon className="w-5 h-5 text-rose-400 mx-auto" />
                  <p className="text-xs font-semibold text-rose-300">Escalation Submitted</p>
                  <p className="text-[10px] text-rose-400/70">Customer IT Head has been notified.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[10px] text-amber-300/80 leading-relaxed">
                    This task has been carried forward {task.carryForwardCount}× and is escalation eligible.
                    AM must verify the blocker type before submitting escalation.
                  </p>

                  {escalationStep === 1 && (
                    <div className="space-y-3">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Step 1 — Verify Blocker Type
                      </label>
                      <div className="space-y-1.5">
                        {Object.values(BLOCKER_TYPES).map((bt) => (
                          <button
                            key={bt.key}
                            onClick={() => setEscalationBlocker(bt.key)}
                            className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-all ${
                              escalationBlocker === bt.key
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-800/60'
                            }`}
                          >
                            <span className="font-semibold block">{bt.label}</span>
                            <span className="text-[10px] opacity-70">{bt.description}</span>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => escalationBlocker && setEscalationStep(2)}
                        disabled={!escalationBlocker}
                        className="w-full py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-all"
                      >
                        Continue →
                      </button>
                    </div>
                  )}

                  {escalationStep === 2 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Step 2 — Escalation Details
                        </label>
                        <button onClick={() => setEscalationStep(1)} className="text-[10px] text-slate-500 hover:text-slate-300 ml-auto">← Back</button>
                      </div>
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1.5 text-[10px] text-amber-400">
                        Blocker: <span className="font-bold">{BLOCKER_TYPES[escalationBlocker]?.label}</span>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-slate-500">Escalation Reason *</label>
                        <textarea
                          rows={3}
                          value={escalationReason}
                          onChange={(e) => setEscalationReason(e.target.value)}
                          placeholder="Describe why escalation is required..."
                          className="w-full bg-slate-900 border border-slate-800 focus:border-rose-500/50 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none resize-none transition-colors"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold text-slate-500">Notify Customer IT Head (email)</label>
                        <input
                          type="email"
                          value={escalationContact}
                          onChange={(e) => setEscalationContact(e.target.value)}
                          placeholder="ithead@customer.com"
                          className="w-full bg-slate-900 border border-slate-800 focus:border-rose-500/50 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none transition-colors"
                        />
                      </div>
                      <button
                        onClick={handleEscalate}
                        disabled={submittingEscalation || !escalationReason.trim()}
                        className="w-full py-2.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-all flex items-center justify-center gap-2"
                      >
                        {submittingEscalation
                          ? <><RefreshCcw className="w-3.5 h-3.5 animate-spin" /> Submitting...</>
                          : <><AlertOctagon className="w-3.5 h-3.5" /> Submit Escalation</>
                        }
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Task Metadata */}
          <div className="glass-panel p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-slate-500" /> Task Information
            </h2>
            <div className="space-y-0">
              <InfoRow icon={Hash} label="Task ID" value={task.id} mono />
              <InfoRow icon={Tag} label="Finding ID" value={task.findingId} mono />
              <InfoRow icon={ShieldAlert} label="Category" value={task.category} />
              <InfoRow icon={RefreshCcw} label="Strategy" value={task.remediationStrategy} />
              <InfoRow
                icon={Calendar}
                label="Due Date"
                value={dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                accent={isOverdue ? 'text-rose-400 font-semibold' : 'text-slate-200'}
              />
              <InfoRow
                icon={Clock}
                label="Last Updated"
                value={new Date(task.lastUpdatedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              />
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800/50 flex items-center justify-between gap-2 flex-wrap">
              <button
                onClick={handleSyncClickUp}
                disabled={syncingClickUp}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-all"
              >
                {syncingClickUp
                  ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                  : <ExternalLink className="w-3.5 h-3.5" />}
                Refresh from ClickUp
              </button>
              {clickUpSyncMsg && (
                <span className={`text-xs font-medium ${clickUpSyncMsg.startsWith('Could not') ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {clickUpSyncMsg}
                </span>
              )}
            </div>
          </div>

          {/* Meeting Info */}
          <div className="glass-panel p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" /> Meeting Context
            </h2>
            <div className="space-y-0">
              <InfoRow icon={Hash}     label="Original MTG"  value={task.originalMeetingId || task.meetingId} mono />
              <InfoRow icon={Hash}     label="Current MTG"   value={task.currentMeetingId  || task.meetingId} mono />
              <InfoRow icon={Calendar} label="Meeting Date"  value={meetingDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />
              <InfoRow icon={Clock}    label="Timeline"      value={task.meetingTimeline} />
              <InfoRow icon={Building2}label="Customer"      value={task.customerName} />
              <InfoRow icon={Hash}     label="Tenant ID"     value={task.tenantId} mono />
            </div>
          </div>

          {/* Carry-Forward Chain / Meeting History */}
          {Array.isArray(task.meetingHistory) && task.meetingHistory.length > 0 && (
            <div className="glass-panel p-5">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <GitBranch className="w-3.5 h-3.5 text-orange-400" /> Carry-Forward History
              </h2>
              <div className="relative border-l-2 border-slate-800 ml-2 pl-4 space-y-4">
                {task.meetingHistory.map((entry, idx) => {
                  const isLast = idx === task.meetingHistory.length - 1;
                  const actionStyle = historyActionStyle[entry.action] || 'text-slate-400 bg-slate-800 border-slate-700';
                  return (
                    <div key={idx} className="relative">
                      <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 ${
                        isLast ? 'bg-indigo-500 border-indigo-400' : 'bg-slate-800 border-slate-600'
                      }`} />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase ${actionStyle}`}>
                            {entry.action.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]">{entry.meetingId}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 font-medium leading-snug">{entry.meetingTitle}</p>
                        <p className="text-[10px] text-slate-600">
                          {new Date(entry.carryForwardAt || entry.reattachedAt || entry.meetingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {entry.reason && ` — ${entry.reason}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {(task.carryForwardCount || 0) >= 2 && task.escalationStatus !== 'escalated' && (
                <div className="mt-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 flex items-start gap-2">
                  <AlertOctagon className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-300 leading-snug">
                    This task has been carried forward {task.carryForwardCount} times and is <strong>escalation eligible</strong>. Consider escalating to senior stakeholders.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Escalation History — always show if there are entries */}
          {Array.isArray(task.escalationHistory) && task.escalationHistory.length > 0 && (
            <div className="glass-panel p-5 border border-rose-500/10">
              <h2 className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <AlertOctagon className="w-3.5 h-3.5" /> Escalation History
              </h2>
              <div className="relative border-l-2 border-rose-900/40 ml-2 pl-4 space-y-5">
                {task.escalationHistory.map((esc, idx) => (
                  <div key={esc.id || idx} className="relative">
                    <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 bg-rose-900 border-rose-600" />
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] px-2 py-0.5 rounded border font-bold uppercase bg-rose-500/10 text-rose-400 border-rose-500/20">
                          Escalated
                        </span>
                        {esc.blockerType && (
                          <span className="text-[9px] px-2 py-0.5 rounded border font-bold uppercase bg-amber-500/10 text-amber-400 border-amber-500/20">
                            {BLOCKER_TYPES[esc.blockerType]?.label || esc.blockerType}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-300 leading-snug">{esc.escalationReason}</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-500">
                        <span>By: <span className="text-slate-400 font-medium">{esc.escalatedBy}</span></span>
                        <span>Date: <span className="text-slate-400">{new Date(esc.escalationDate).toLocaleDateString()}</span></span>
                        {esc.notifyContact && <span className="col-span-2">Notified: <span className="text-slate-400 font-mono">{esc.notifyContact}</span></span>}
                        <span>CF Count: <span className="text-amber-400 font-semibold">{esc.carryForwardCount}</span></span>
                      </div>
                      {esc.resolvedAt && (
                        <div className="mt-1.5 bg-emerald-500/5 border border-emerald-500/15 rounded px-2.5 py-1.5 text-[10px]">
                          <span className="text-emerald-400 font-semibold">Resolved</span>
                          <span className="text-slate-400"> by {esc.resolvedBy} · {new Date(esc.resolvedAt).toLocaleDateString()}</span>
                          {esc.resolution && <p className="text-slate-500 mt-0.5">{esc.resolution}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ownership */}
          {(task.primaryOwner || task.secondaryOwner || task.ownershipTeam) && (
          <div className="glass-panel p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-sky-400" /> Ownership
            </h2>
            <div className="space-y-3">
              {task.primaryOwner && (
              <div className="flex items-center gap-3">
                <Avatar initials={task.primaryOwner.avatar} color="indigo" />
                <div>
                  <p className="text-sm font-semibold text-slate-200">{task.primaryOwner.name}</p>
                  <p className="text-xs text-slate-500">{task.primaryOwner.role}</p>
                  <p className="text-xs text-indigo-400 font-mono">{task.primaryOwner.email}</p>
                </div>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 font-bold uppercase shrink-0">
                  Primary
                </span>
              </div>
              )}
              {task.secondaryOwner && (
              <div className="border-t border-slate-800/60 pt-3 flex items-center gap-3">
                <Avatar initials={task.secondaryOwner.avatar} color="sky" />
                <div>
                  <p className="text-sm font-semibold text-slate-200">{task.secondaryOwner.name}</p>
                  <p className="text-xs text-slate-500">{task.secondaryOwner.role}</p>
                  <p className="text-xs text-sky-400 font-mono">{task.secondaryOwner.email}</p>
                </div>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/20 font-bold uppercase shrink-0">
                  Secondary
                </span>
              </div>
              )}
              {task.ownershipTeam && (
              <div className="border-t border-slate-800/60 pt-3 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs text-slate-500">Team:</span>
                <span className="text-xs font-semibold text-slate-300">{task.ownershipTeam}</span>
              </div>
              )}
            </div>
          </div>
          )}

          {/* Quick Links */}
          <div className="flex flex-col gap-2">
            <Link
              to="/meetings"
              className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/50 hover:border-slate-600 transition-all group"
            >
              <span className="text-sm font-semibold text-slate-300 group-hover:text-white">Back to Meetings & Tracker</span>
              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackerTaskDetail;
