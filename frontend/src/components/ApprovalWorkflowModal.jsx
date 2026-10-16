import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/api';
import { PRIORITY_LEVELS } from '../services/trackerMockData';
import { NXG360_CATEGORIES } from '../services/nxg360Service';
import {
  Check, ArrowRight, CornerDownRight, X, AlertOctagon, HelpCircle, Save, RefreshCw,
} from 'lucide-react';

// ─── Priority badge ──────────────────────────────────────────────────────────
const PriorityBadge = ({ priority }) => {
  const meta = PRIORITY_LEVELS[priority] || PRIORITY_LEVELS.P4;
  return (
    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-extrabold uppercase border tracking-wider ${meta.color}`}>
      {meta.label} — {meta.description}
    </span>
  );
};

// ─── NXG360 category badge ───────────────────────────────────────────────────
const CategoryBadge = ({ category }) => {
  const meta = Object.values(NXG360_CATEGORIES).find((c) => c.key === category);
  if (!meta) return null;
  return (
    <span className="text-[9px] px-2 py-0.5 rounded border font-bold bg-sky-500/10 text-sky-400 border-sky-500/20 uppercase tracking-wider">
      {meta.label}
    </span>
  );
};

// ─── Severity badge ──────────────────────────────────────────────────────────
const SeverityBadge = ({ severity }) => {
  const colors = {
    critical: 'bg-rose-500/20 text-rose-400 border-rose-500/20',
    high:     'bg-amber-500/20 text-amber-400 border-amber-500/20',
    medium:   'bg-indigo-500/20 text-indigo-400 border-indigo-500/20',
    low:      'bg-slate-500/20 text-slate-400 border-slate-700/50',
  };
  return (
    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-extrabold uppercase border tracking-wider ${colors[severity] || colors.low}`}>
      {severity}
    </span>
  );
};

export const ApprovalWorkflowModal = ({ isOpen, onClose, meeting, onWorkflowSaved }) => {
  const [findings, setFindings]           = useState([]);
  const [tasks, setTasks]                 = useState([]);
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [notes, setNotes]                 = useState('');
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);

  useEffect(() => {
    if (!isOpen || !meeting) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [f, t] = await Promise.all([
          api.findings.listForMeeting(meeting.id),
          api.tasks.listForMeeting(meeting.id),
        ]);
        setFindings(f);
        setTasks(t);
        setActiveTaskIndex(0);
        if (t.length > 0) setNotes(t[0].notes || '');
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [isOpen, meeting]);

  if (!isOpen || !meeting) return null;

  const activeTask    = tasks[activeTaskIndex];
  const activeFinding = findings.find((f) => f.id === activeTask?.findingId);
  const nxg360Category = activeFinding?.nxg360Category
    || activeFinding?.category?.toLowerCase().replace(/[^a-z_]/g, '_');

  const handleStatusChange = (status) => {
    setTasks((prev) =>
      prev.map((t, i) => i === activeTaskIndex ? { ...t, approvalStatus: status, notes } : t)
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const t of tasks) {
        await api.tasks.updateStatus(t.id, t.approvalStatus, t.notes);
      }
      onWorkflowSaved();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const resolved = tasks.filter((t) => t.approvalStatus !== 'pending').length;

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#1A1814]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60 flex flex-col max-h-[90vh]">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
              <Save className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-100">Remediation Approvals</h3>
                <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded font-semibold truncate max-w-[200px]">
                  {meeting.title}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Review AI-generated tasks from NXG360 findings — approve before publishing to tracker.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-800 shrink-0 ml-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-7 h-7 text-indigo-400 animate-spin" />
              <p className="text-xs text-slate-500">Loading tasks…</p>
            </div>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
            <HelpCircle className="w-9 h-9 text-slate-700" />
            <p className="text-sm font-semibold text-slate-400">No remediation tasks for this meeting.</p>
            <p className="text-xs text-slate-600">Trigger the NXG360 workflow scan first to generate findings and tasks.</p>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden min-h-0">

            {/* ── Sidebar — task list ─────────────────────────────────── */}
            <div className="w-64 border-r border-slate-800/80 flex flex-col shrink-0 overflow-hidden">
              <div className="px-3 pt-3 pb-1 shrink-0">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {tasks.length} Task{tasks.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
                {tasks.map((task, index) => {
                  const finding  = findings.find((f) => f.id === task.findingId);
                  const isActive = index === activeTaskIndex;
                  const statusDot = {
                    approved:        'bg-emerald-500',
                    rejected:        'bg-rose-500',
                    carried_forward: 'bg-amber-500',
                  }[task.approvalStatus] || 'bg-slate-600';

                  return (
                    <button
                      key={task.id}
                      onClick={() => { setActiveTaskIndex(index); setNotes(task.notes || ''); }}
                      className={`w-full text-left p-3 rounded-xl border text-xs transition-all ${
                        isActive
                          ? 'bg-indigo-500/10 border-indigo-500/40 text-white'
                          : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/40 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="font-mono text-[9px] font-bold text-indigo-400">
                          {finding?.sourceFindingId || task.sourceFindingId}
                        </span>
                        <SeverityBadge severity={finding?.severity || task.severity} />
                      </div>
                      <p className="font-semibold text-[11px] text-slate-200 leading-snug line-clamp-2 mb-1.5">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
                        <span className="text-[9px] capitalize font-semibold text-slate-500">
                          {task.approvalStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Progress bar */}
              <div className="px-3 py-2.5 border-t border-slate-800/80 shrink-0">
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
                  <span>Progress</span>
                  <span className="font-bold text-slate-400">{resolved}/{tasks.length}</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1">
                  <div
                    className="bg-indigo-500 h-1 rounded-full transition-all duration-300"
                    style={{ width: `${tasks.length > 0 ? (resolved / tasks.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* ── Right panel — task detail ───────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

                {/* Finding card */}
                <div className="bg-rose-500/5 border border-rose-500/15 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertOctagon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span className="text-xs font-bold text-rose-400">NXG360 Security Finding</span>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <SeverityBadge severity={activeFinding?.severity || activeTask?.severity} />
                    {nxg360Category && <CategoryBadge category={nxg360Category} />}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 leading-snug">
                      {activeFinding?.title || activeTask?.title}
                    </h4>
                    {activeFinding?.description && (
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        {activeFinding.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-500 border-t border-slate-800/60 pt-2.5">
                    <span>System: <span className="text-slate-300 font-mono">{activeFinding?.systemAffected || '—'}</span></span>
                    <span>Category: <span className="text-slate-300">{activeFinding?.category || '—'}</span></span>
                    {activeFinding?.affectedCount > 0 && (
                      <span>Affected: <span className="text-amber-400 font-semibold">{activeFinding.affectedCount}</span></span>
                    )}
                  </div>
                </div>

                {/* Arrow connector */}
                <div className="flex justify-center text-slate-700">
                  <CornerDownRight className="w-4 h-4" />
                </div>

                {/* AI recommendation card */}
                <div className="bg-indigo-500/5 border border-indigo-500/15 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-bold text-indigo-400">AI Remediation Strategy</span>
                    <div className="flex items-center gap-3">
                      {activeTask?.priority && <PriorityBadge priority={activeTask.priority} />}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 leading-snug">{activeTask?.title}</h4>
                    {activeTask?.remediationStrategy && (
                      <span className="text-[10px] text-sky-400 font-bold mt-0.5 block">
                        {activeTask.remediationStrategy.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <pre className="text-[11px] text-slate-300 font-sans whitespace-pre-line bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2.5 leading-relaxed">
                    {activeTask?.actionPlan}
                  </pre>
                </div>

                {/* Decision buttons */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    AM Decision
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { status: 'approved',        label: 'Approve',       icon: <Check className="w-3.5 h-3.5" />,      active: 'bg-emerald-600 border-emerald-500 text-white' },
                      { status: 'carried_forward', label: 'Carry Forward', icon: <ArrowRight className="w-3.5 h-3.5" />, active: 'bg-amber-600 border-amber-500 text-white' },
                      { status: 'rejected',        label: 'Reject',        icon: <X className="w-3.5 h-3.5" />,         active: 'bg-rose-600 border-rose-500 text-white' },
                    ].map(({ status, label, icon, active }) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handleStatusChange(status)}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-bold transition-all ${
                          activeTask?.approvalStatus === status
                            ? active
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                        }`}
                      >
                        {icon} {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auditor notes */}
                <div className="space-y-1.5 pb-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Auditor Comments <span className="text-slate-700 normal-case font-normal">(optional)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setTasks((prev) =>
                        prev.map((t, i) => i === activeTaskIndex ? { ...t, notes: e.target.value } : t)
                      );
                    }}
                    placeholder="Add review notes, exclusions, or scope adjustments…"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 placeholder-slate-600 outline-none transition-colors resize-none leading-relaxed"
                  />
                </div>
              </div>

              {/* ── Footer — save bar ─────────────────────────────────── */}
              <div className="px-5 py-3.5 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between gap-4 shrink-0">
                <span className="text-[10px] text-slate-500 leading-relaxed">
                  <span className="text-indigo-400 font-semibold">Approved</span> tasks publish to the Remediation Tracker.
                </span>
                <button
                  onClick={handleSave}
                  disabled={saving || resolved === 0}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shrink-0"
                >
                  {saving
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    : <><Check className="w-3.5 h-3.5" /> Submit Approvals</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
