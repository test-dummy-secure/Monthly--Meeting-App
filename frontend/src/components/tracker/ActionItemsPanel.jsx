import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../services/api';
import {
  ClipboardList, Plus, RefreshCw, ChevronDown, ChevronUp,
  Clock, ArrowUpRight,
  User, BarChart2, X, Loader2, Ban,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'all',          label: 'All' },
  { key: 'active',       label: 'Open' },
  { key: 'CUSTOMER',     label: 'Customer',  ownerFilter: true },
  { key: 'ACCOUNT_MANAGER', label: 'AM',     ownerFilter: true },
  { key: 'carry_forward', label: 'Carry Fwd' },
  { key: 'escalated',    label: 'Escalated' },
  { key: 'weekly',       label: 'Weekly' },
];

const STATUS_STYLE = {
  open:                'bg-slate-700/50 text-slate-400 border-slate-600',
  in_progress:         'bg-blue-500/15 text-blue-400 border-blue-500/25',
  awaiting_validation: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  blocked:             'bg-orange-500/15 text-orange-400 border-orange-500/25',
  carry_forward:       'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  escalated:           'bg-rose-500/15 text-rose-400 border-rose-500/25',
  overdue:             'bg-red-500/20 text-red-400 border-red-500/30',
  completed:           'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  closed:              'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  cancelled:           'bg-slate-700/40 text-slate-500 border-slate-700',
};

const OWNER_STYLE = {
  CUSTOMER:        'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  ACCOUNT_MANAGER: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  SHARED:          'bg-teal-500/15 text-teal-400 border-teal-500/25',
};

const PRIORITY_STYLE = {
  critical: 'bg-rose-400',
  high:     'bg-amber-400',
  medium:   'bg-sky-400',
  low:      'bg-slate-500',
};

const PRIORITY_OPTS = ['critical', 'high', 'medium', 'low'];
const OWNER_OPTS    = ['ACCOUNT_MANAGER', 'CUSTOMER', 'SHARED'];


const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};

const isOverdue = (dueDate, status) =>
  dueDate &&
  new Date(dueDate) < new Date() &&
  !['completed', 'closed', 'cancelled'].includes(status);

// ─── Component ───────────────────────────────────────────────────────────────

const ActionItemsPanel = ({ tenantId, activeMeetingId, meetings = [], refreshKey = 0 }) => {
  const [activeTab,      setActiveTab]      = useState('all');
  const [items,          setItems]          = useState([]);
  const [stats,          setStats]          = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [expandedId,     setExpandedId]     = useState(null);
  const [actionLoading,  setActionLoading]  = useState({});

  // Create form state
  const [showCreate,     setShowCreate]     = useState(false);
  const [createForm,     setCreateForm]     = useState({
    meetingId: activeMeetingId || '', title: '', priority: 'medium',
    ownerType: 'ACCOUNT_MANAGER', ownerName: '', dueDate: '', description: '',
  });
  const [creating,       setCreating]       = useState(false);
  const [createError,    setCreateError]    = useState('');

  // Escalate inline form
  const [escalateFor,    setEscalateFor]    = useState(null); // taskId
  const [escalateForm,   setEscalateForm]   = useState({ reason: '', blockerType: '', escalatedTo: '' });
  const [escalating,     setEscalating]     = useState(false);

  // Weekly report
  const [weeklyData,     setWeeklyData]     = useState(null);
  const [weeklyLoading,  setWeeklyLoading]  = useState(false);
  const [weeklyError,    setWeeklyError]    = useState('');

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    if (!tenantId) return;
    try {
      const s = await api.actionItems.stats();
      setStats(s);
    } catch { /* non-fatal */ }
  }, [tenantId]);

  const loadItems = useCallback(async (tab) => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const filters = { pageSize: 100 };
      if (tab === 'CUSTOMER' || tab === 'ACCOUNT_MANAGER') {
        filters.ownerType = tab;
      } else if (tab !== 'all') {
        filters.status = tab;
      }
      const result = await api.actionItems.list(filters);
      setItems(result.items || []);
    } catch (err) {
      console.error('ActionItemsPanel load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (activeTab !== 'weekly') {
      loadItems(activeTab);
    }
    loadStats();
  }, [activeTab, loadItems, loadStats]);

  useEffect(() => {
    if (refreshKey > 0) {
      loadItems(activeTab);
      loadStats();
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeMeetingId) {
      setCreateForm((prev) => ({ ...prev, meetingId: activeMeetingId }));
    }
  }, [activeMeetingId]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.meetingId || !createForm.title) {
      setCreateError('Meeting and title are required.');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      await api.actionItems.create({ ...createForm, tenantId });
      setShowCreate(false);
      setCreateForm({
        meetingId: activeMeetingId || '', title: '', priority: 'medium',
        ownerType: 'ACCOUNT_MANAGER', ownerName: '', dueDate: '', description: '',
      });
      await Promise.all([loadItems(activeTab), loadStats()]);
    } catch (err) {
      setCreateError(err?.response?.data?.error || 'Failed to create action item.');
    } finally {
      setCreating(false);
    }
  };

  const handleQuickStatus = useCallback(async (taskId, status) => {
    setActionLoading((p) => ({ ...p, [taskId]: 'qs' }));
    try {
      await api.actionItems.update(taskId, { remediationStatus: status });
      await Promise.all([loadItems(activeTab), loadStats()]);
    } catch (err) {
      console.error('Quick status update failed:', err);
    } finally {
      setActionLoading((p) => { const n = { ...p }; delete n[taskId]; return n; });
    }
  }, [activeTab, loadItems, loadStats]);

  const handleEscalate = async (e) => {
    e.preventDefault();
    if (!escalateForm.reason) return;
    setEscalating(true);
    try {
      await api.actionItems.escalate(escalateFor, escalateForm);
      setEscalateFor(null);
      setEscalateForm({ reason: '', blockerType: '', escalatedTo: '' });
      await Promise.all([loadItems(activeTab), loadStats()]);
    } catch (err) {
      console.error(err);
    } finally {
      setEscalating(false);
    }
  };

  const handleLoadWeekly = async () => {
    setWeeklyLoading(true);
    setWeeklyError('');
    try {
      const result = await api.actionItems.weeklyReport(activeMeetingId || undefined);
      setWeeklyData(result);
    } catch (err) {
      setWeeklyError(err?.response?.data?.error || 'Failed to generate weekly report.');
    } finally {
      setWeeklyLoading(false);
    }
  };

  // ── Tab badge counts ──────────────────────────────────────────────────────

  const tabBadge = (key) => {
    if (!stats) return null;
    const map = {
      active:          stats.open + stats.inProgress + stats.blocked + stats.overdue,
      CUSTOMER:        stats.byOwnerType?.CUSTOMER,
      ACCOUNT_MANAGER: stats.byOwnerType?.ACCOUNT_MANAGER,
      carry_forward:   stats.carryForward,
      escalated:       stats.escalated,
    };
    const val = map[key];
    if (!val) return null;
    return (
      <span className="ml-1 text-[8px] font-bold px-1 py-0.5 rounded-full bg-slate-700 text-slate-400">
        {val}
      </span>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Stats row */}
      {stats && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Items:</span>
          {[
            { label: 'Total',    val: stats.total,       color: 'text-slate-300' },
            { label: 'Open',     val: stats.open + stats.inProgress + stats.blocked, color: 'text-sky-400' },
            { label: 'CF',       val: stats.carryForward, color: 'text-yellow-400' },
            { label: 'Esc',      val: stats.escalated,   color: 'text-rose-400' },
            { label: 'Done',     val: stats.completed,   color: 'text-emerald-400' },
          ].map(({ label, val, color }) => (
            <span key={label} className="text-[10px]">
              <span className="text-slate-600">{label} </span>
              <span className={`font-bold ${color}`}>{val}</span>
            </span>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 mb-3 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setExpandedId(null); }}
            className={`shrink-0 flex items-center text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-sky-600/30 text-sky-300 border border-sky-500/40'
                : 'text-slate-500 hover:text-slate-300 border border-transparent hover:border-slate-700'
            }`}
          >
            {tab.label}
            {tabBadge(tab.key)}
          </button>
        ))}
        <button
          onClick={() => { loadItems(activeTab); loadStats(); }}
          className="ml-auto shrink-0 p-1.5 text-slate-600 hover:text-slate-400 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
        {activeTab !== 'weekly' && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="shrink-0 flex items-center gap-1 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-400 text-[10px] font-bold px-2 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && activeTab !== 'weekly' && (
        <div className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">New Action Item</span>
            <button onClick={() => setShowCreate(false)} className="text-slate-600 hover:text-slate-400"><X className="w-3.5 h-3.5" /></button>
          </div>
          <form onSubmit={handleCreate} className="space-y-2">
            <select
              value={createForm.meetingId}
              onChange={(e) => setCreateForm((p) => ({ ...p, meetingId: e.target.value }))}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 outline-none focus:border-sky-500 transition-colors"
              required
            >
              <option value="">Select meeting…</option>
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>{m.title || m.id}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Title (required)"
              value={createForm.title}
              onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 outline-none focus:border-sky-500 transition-colors"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={createForm.priority}
                onChange={(e) => setCreateForm((p) => ({ ...p, priority: e.target.value }))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:border-sky-500 transition-colors"
              >
                {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select
                value={createForm.ownerType}
                onChange={(e) => setCreateForm((p) => ({ ...p, ownerType: e.target.value }))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:border-sky-500 transition-colors"
              >
                {OWNER_OPTS.map((o) => <option key={o} value={o}>{o === 'ACCOUNT_MANAGER' ? 'AM' : o}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Owner name"
                value={createForm.ownerName}
                onChange={(e) => setCreateForm((p) => ({ ...p, ownerName: e.target.value }))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 outline-none focus:border-sky-500 transition-colors"
              />
              <input
                type="date"
                value={createForm.dueDate}
                onChange={(e) => setCreateForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none focus:border-sky-500 transition-colors"
              />
            </div>
            <textarea
              placeholder="Description (optional)"
              value={createForm.description}
              onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
              rows={2}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 outline-none focus:border-sky-500 transition-colors resize-none"
            />
            {createError && (
              <p className="text-[10px] text-rose-400">{createError}</p>
            )}
            <div className="flex justify-end gap-2 pt-0.5">
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-slate-300 text-[10px] font-semibold px-2 py-1">Cancel</button>
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors"
              >
                {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Weekly tab ── */}
      {activeTab === 'weekly' && (
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadWeekly}
              disabled={weeklyLoading}
              className="flex items-center gap-1.5 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-400 text-[10px] font-bold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {weeklyLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Generating…</span></>
                : <><BarChart2 className="w-3.5 h-3.5" /><span>Generate Weekly Report</span></>
              }
            </button>
          </div>
          {weeklyError && (
            <p className="text-[10px] text-rose-400">{weeklyError}</p>
          )}
          {weeklyData && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Total Items',   val: weeklyData.summary?.total       || 0, color: 'text-slate-300' },
                  { label: 'Open',          val: weeklyData.summary?.open        || 0, color: 'text-sky-400' },
                  { label: 'Carry Forward', val: weeklyData.summary?.carryForwardTotal || 0, color: 'text-yellow-400' },
                  { label: 'Escalated',     val: weeklyData.summary?.escalatedTotal   || 0, color: 'text-rose-400' },
                  { label: 'Overdue',       val: weeklyData.summary?.overdueTotal     || 0, color: 'text-amber-400' },
                  { label: 'Completed',     val: weeklyData.summary?.completed   || 0, color: 'text-emerald-400' },
                ].map(({ label, val, color }) => (
                  <div key={label} className="glass-panel p-2.5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
                    <p className={`text-lg font-extrabold mt-0.5 ${color}`}>{val}</p>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-slate-600">
                Week {weeklyData.summary?.weekStart} → {weeklyData.summary?.weekEnd} · saved to weekly_reports
              </p>

              {/* Owner type breakdown */}
              <div className="glass-panel p-3 space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">By Ownership</p>
                {[
                  { label: 'Customer',        val: weeklyData.summary?.byOwnerType?.CUSTOMER || 0,        style: OWNER_STYLE.CUSTOMER },
                  { label: 'Account Manager', val: weeklyData.summary?.byOwnerType?.ACCOUNT_MANAGER || 0, style: OWNER_STYLE.ACCOUNT_MANAGER },
                  { label: 'Shared',          val: weeklyData.summary?.byOwnerType?.SHARED || 0,          style: OWNER_STYLE.SHARED },
                ].map(({ label, val, style }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${style}`}>{label}</span>
                    <span className="text-[11px] font-bold text-slate-300">{val}</span>
                  </div>
                ))}
              </div>

              {weeklyData.carryForwardItems?.length > 0 && (
                <ItemSubList title="Carry Forward" items={weeklyData.carryForwardItems} color="text-yellow-400" />
              )}
              {weeklyData.escalatedItems?.length > 0 && (
                <ItemSubList title="Escalated" items={weeklyData.escalatedItems} color="text-rose-400" />
              )}
              {weeklyData.overdueItems?.length > 0 && (
                <ItemSubList title="Overdue" items={weeklyData.overdueItems} color="text-amber-400" />
              )}
            </>
          )}
          {!weeklyData && !weeklyLoading && (
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Click <span className="text-sky-400 font-semibold">Generate Weekly Report</span> to create a snapshot of all action items for the current week. The report is saved to the database for audit history.
            </p>
          )}
        </div>
      )}

      {/* ── Task list tabs ── */}
      {activeTab !== 'weekly' && (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <ClipboardList className="w-8 h-8 text-slate-700 mb-2" />
              <p className="text-[11px] text-slate-600">No action items in this view.</p>
            </div>
          )}
          {!loading && items.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              actionLoading={actionLoading}
              onQuickStatus={handleQuickStatus}
              escalateFor={escalateFor}
              setEscalateFor={setEscalateFor}
              escalateForm={escalateForm}
              setEscalateForm={setEscalateForm}
              onEscalate={handleEscalate}
              escalating={escalating}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Progress Range Bar ──────────────────────────────────────────────────────

const MILESTONES = [0, 25, 50, 75, 100];

const pctFillColor = (pct) => {
  if (pct >= 100) return 'bg-emerald-500';
  if (pct >= 75)  return 'bg-indigo-500';
  if (pct >= 50)  return 'bg-sky-500';
  if (pct >= 25)  return 'bg-amber-500';
  if (pct >  0)   return 'bg-rose-500';
  return 'bg-slate-800';
};

const pctLabelColor = (pct) => {
  if (pct >= 100) return 'text-emerald-400';
  if (pct >= 75)  return 'text-indigo-400';
  if (pct >= 50)  return 'text-sky-400';
  if (pct >= 25)  return 'text-amber-400';
  if (pct >  0)   return 'text-rose-400';
  return 'text-slate-500';
};

const ProgressRangeBar = ({ value, onChange, readOnly = false, saving = false }) => {
  const pct      = Math.min(100, Math.max(0, Number(value) || 0));
  const trackRef = useRef(null);

  const applyValue = (rawPct) => {
    const nearest = MILESTONES.reduce((best, m) =>
      Math.abs(m - rawPct) < Math.abs(best - rawPct) ? m : best
    , MILESTONES[0]);
    const final = Math.abs(nearest - rawPct) <= 8 ? nearest : rawPct;
    onChange(Math.min(100, Math.max(0, Math.round(final))));
  };

  const handleTrackClick = (e) => {
    if (readOnly || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    applyValue(((e.clientX - rect.left) / rect.width) * 100);
  };

  return (
    <div className="px-3 pb-2.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      {/* Track + percentage label */}
      <div className="flex items-center gap-2">
        <div
          ref={trackRef}
          onClick={handleTrackClick}
          title={readOnly ? undefined : 'Click to set progress, or use milestone buttons below'}
          className={`relative flex-1 h-1.5 rounded-full bg-slate-800/80 ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${pctFillColor(pct)}`}
            style={{ width: `${pct}%` }}
          />
          {/* Tick marks at 25, 50, 75 */}
          {[25, 50, 75].map((m) => (
            <div
              key={m}
              className="absolute top-0 bottom-0 w-px bg-slate-700"
              style={{ left: `${m}%` }}
            />
          ))}
        </div>
        <div className={`text-[9px] font-extrabold w-7 text-right shrink-0 tabular-nums leading-none ${pctLabelColor(pct)}`}>
          {saving ? <span className="text-slate-600 animate-pulse">…</span> : `${pct}%`}
        </div>
      </div>

      {/* Milestone snap buttons */}
      <div className="flex items-center justify-between">
        {MILESTONES.map((m) => {
          const active = pct >= m && (m === 100 ? pct === 100 : pct < MILESTONES[MILESTONES.indexOf(m) + 1]);
          return (
            <button
              key={m}
              type="button"
              disabled={readOnly}
              onClick={() => !readOnly && onChange(m)}
              className={`text-[8px] font-bold px-1 py-0.5 rounded transition-colors ${
                pct === m
                  ? `${pctLabelColor(m)}`
                  : active
                    ? 'text-slate-400'
                    : 'text-slate-700 hover:text-slate-500'
              } disabled:cursor-default disabled:opacity-40`}
            >
              {m}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─── Task Row ────────────────────────────────────────────────────────────────

const TaskRow = ({
  item, expanded, onToggle,
  actionLoading, onQuickStatus,
  escalateFor, setEscalateFor, escalateForm, setEscalateForm,
  onEscalate, escalating,
}) => {
  const overdue   = isOverdue(item.dueDate, item.remediationStatus);
  const cfCount   = item.carryForwardCount || 0;
  const isTerminal = ['completed', 'closed', 'cancelled'].includes(item.remediationStatus);
  const pctLocked  = isTerminal || item.remediationStatus === 'open';

  const [localPct,  setLocalPct]  = useState(Math.min(100, Math.max(0, Number(item.progressPercentage) || 0)));
  const [pctSaving, setPctSaving] = useState(false);
  const [pctError,  setPctError]  = useState('');
  const saveTimer = useRef(null);

  // Sync when the item prop refreshes from outside
  useEffect(() => {
    setLocalPct(Math.min(100, Math.max(0, Number(item.progressPercentage) || 0)));
  }, [item.progressPercentage]);

  // Cancel pending save on unmount
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const handlePctChange = useCallback((val) => {
    const clamped = Math.min(100, Math.max(0, val));
    setLocalPct(clamped);
    setPctError('');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setPctSaving(true);
      try {
        await api.actionItems.update(item.id, { progressPercentage: clamped });
      } catch {
        setPctError('save failed');
        setLocalPct(Math.min(100, Math.max(0, Number(item.progressPercentage) || 0)));
      } finally {
        setPctSaving(false);
      }
    }, 500);
  }, [item.id, item.progressPercentage]);

  return (
    <div className={`rounded-xl border transition-all ${
      item.remediationStatus === 'escalated'
        ? 'border-rose-500/25 bg-rose-500/5'
        : item.remediationStatus === 'completed' || item.remediationStatus === 'closed'
        ? 'border-slate-700/40 bg-slate-900/20 opacity-70'
        : 'border-slate-800/60 bg-slate-900/30'
    }`}>
      {/* Header row */}
      <div className="flex items-start gap-2 p-3 cursor-pointer" onClick={onToggle}>
        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_STYLE[item.priority] || 'bg-slate-500'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-slate-200 leading-snug line-clamp-2">{item.title}</p>
          {/* ── Status row ── */}
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {/* Workflow pills — click to set status directly */}
            {[
              { val: 'open',        label: 'Not Started' },
              { val: 'in_progress', label: 'In Progress' },
              { val: 'completed',   label: 'Done'        },
            ].map(({ val, label }) => {
              const isActive =
                val === 'open'        ? item.remediationStatus === 'open' :
                val === 'in_progress' ? ['in_progress','awaiting_validation','blocked','carry_forward'].includes(item.remediationStatus) :
                                        ['completed','closed'].includes(item.remediationStatus);
              return (
                <button
                  key={val}
                  type="button"
                  disabled={isActive || !!actionLoading[item.id]}
                  onClick={(e) => { e.stopPropagation(); if (!isActive) onQuickStatus(item.id, val); }}
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors whitespace-nowrap ${
                    isActive
                      ? STATUS_STYLE[item.remediationStatus] || STATUS_STYLE.open
                      : 'border-slate-800 text-slate-600 hover:border-slate-600 hover:text-slate-300'
                  } disabled:cursor-default`}
                >
                  {actionLoading[item.id] === 'qs' && isActive
                    ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" />
                    : label}
                </button>
              );
            })}

            {/* Divider */}
            <span className="w-px h-3 bg-slate-800 shrink-0 mx-0.5" />

            {/* Exception action icons — Block + Escalate */}
            {!isTerminal && (
              <>
                <button
                  type="button"
                  title={item.remediationStatus === 'blocked' ? 'Unblock (set In Progress)' : 'Mark as Blocked'}
                  disabled={!!actionLoading[item.id]}
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickStatus(item.id, item.remediationStatus === 'blocked' ? 'in_progress' : 'blocked');
                  }}
                  className={`p-0.5 rounded transition-colors ${
                    item.remediationStatus === 'blocked'
                      ? 'text-orange-400 bg-orange-500/10'
                      : 'text-slate-700 hover:text-orange-400 hover:bg-orange-500/10'
                  } disabled:opacity-40`}
                >
                  <Ban className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title={item.remediationStatus === 'escalated' ? 'View escalation' : 'Escalate'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEscalateFor(escalateFor === item.id ? null : item.id);
                    if (!expanded) onToggle();
                  }}
                  className={`p-0.5 rounded transition-colors ${
                    item.remediationStatus === 'escalated' || escalateFor === item.id
                      ? 'text-rose-400 bg-rose-500/10'
                      : 'text-slate-700 hover:text-rose-400 hover:bg-rose-500/10'
                  }`}
                >
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </>
            )}

            {/* Owner badge */}
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${OWNER_STYLE[item.ownerType] || OWNER_STYLE.ACCOUNT_MANAGER}`}>
              {item.ownerType === 'ACCOUNT_MANAGER' ? 'AM' : item.ownerType === 'CUSTOMER' ? 'Cust' : 'Shared'}
            </span>

            {/* CF count — informational only (auto-handled by backend) */}
            {cfCount > 0 && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                cfCount >= 3
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                  : cfCount === 2
                  ? 'border-amber-500/25 bg-amber-500/10 text-amber-400'
                  : 'border-yellow-500/25 bg-yellow-500/10 text-yellow-400'
              }`}>
                CF×{cfCount}
              </span>
            )}

            {/* Overdue badge */}
            {overdue && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-400">
                OVERDUE
              </span>
            )}
          </div>
          <div className="flex gap-x-3 mt-1 text-[9px] text-slate-600">
            {item.ownerName && <span><User className="w-2.5 h-2.5 inline mr-0.5" />{item.ownerName}</span>}
            {item.dueDate   && <span><Clock className="w-2.5 h-2.5 inline mr-0.5" />{fmtDate(item.dueDate)}</span>}
            {item.customerName && <span>{item.customerName}</span>}
          </div>
        </div>
        <button className="text-slate-600 hover:text-slate-400 shrink-0 mt-0.5">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Progress range bar — always visible */}
      <ProgressRangeBar
        value={localPct}
        onChange={handlePctChange}
        readOnly={pctLocked}
        saving={pctSaving}
      />
      {pctError && (
        <p className="px-3 pb-1 text-[8px] text-rose-400">{pctError}</p>
      )}

      {/* Expanded action area */}
      {expanded && (
        <div className="border-t border-slate-800/60 p-3 space-y-3">
          {item.description && (
            <p className="text-[10px] text-slate-400 leading-relaxed">{item.description}</p>
          )}
          {item.actionPlan && (
            <p className="text-[10px] text-slate-500 leading-relaxed">{item.actionPlan}</p>
          )}

          {/* Escalate form — triggered by ⬆ icon in header */}
          {escalateFor === item.id && (
            <form onSubmit={onEscalate} className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 space-y-2">
              <p className="text-[10px] font-bold text-rose-300 uppercase tracking-wider">Escalation (AM Review Required)</p>
              <textarea
                placeholder="Reason for escalation (required)"
                value={escalateForm.reason}
                onChange={(e) => setEscalateForm((p) => ({ ...p, reason: e.target.value }))}
                rows={2}
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-300 placeholder-slate-600 outline-none focus:border-rose-500 transition-colors resize-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Blocker type (optional)"
                  value={escalateForm.blockerType}
                  onChange={(e) => setEscalateForm((p) => ({ ...p, blockerType: e.target.value }))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 placeholder-slate-600 outline-none focus:border-rose-500 transition-colors"
                />
                <input
                  type="text"
                  placeholder="Escalate to (optional)"
                  value={escalateForm.escalatedTo}
                  onChange={(e) => setEscalateForm((p) => ({ ...p, escalatedTo: e.target.value }))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 placeholder-slate-600 outline-none focus:border-rose-500 transition-colors"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEscalateFor(null)} className="text-slate-500 hover:text-slate-300 text-[10px] font-semibold px-2 py-1">Cancel</button>
                <button
                  type="submit"
                  disabled={escalating || !escalateForm.reason}
                  className="flex items-center gap-1 bg-rose-600/80 hover:bg-rose-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors"
                >
                  {escalating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpRight className="w-3 h-3" />}
                  {escalating ? 'Escalating…' : 'Confirm Escalation'}
                </button>
              </div>
            </form>
          )}

          {/* Escalation history */}
          {item.escalationHistory?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Escalation History</p>
              {item.escalationHistory.map((e) => (
                <div key={e.id} className="text-[9px] text-slate-500 pl-2 border-l border-slate-700">
                  {new Date(e.escalationDate).toLocaleDateString()} · {e.escalatedBy} · {e.escalationReason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Sub-list (used in Weekly tab) ───────────────────────────────────────────

const ItemSubList = ({ title, items, color }) => (
  <div className="glass-panel p-3 space-y-2">
    <p className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{title} ({items.length})</p>
    {items.slice(0, 8).map((t) => (
      <div key={t.id} className="text-[10px] text-slate-400 leading-snug border-l-2 border-slate-700 pl-2">
        <span className="font-semibold">{t.title}</span>
        {t.ownerName && <span className="text-slate-600"> · {t.ownerName}</span>}
        {t.dueDate   && <span className="text-slate-600"> · due {fmtDate(t.dueDate)}</span>}
      </div>
    ))}
    {items.length > 8 && (
      <p className="text-[9px] text-slate-600">+{items.length - 8} more</p>
    )}
  </div>
);

export default ActionItemsPanel;
