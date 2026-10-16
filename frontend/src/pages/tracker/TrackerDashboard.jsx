import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { useTenant } from '../../context/TenantContext';
import { TenantSelector } from '../../components/TenantSelector';
import {
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  Flame,
  ShieldAlert,
  BarChart3,
  Users,
  GitBranch,
  Network,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  X,
} from 'lucide-react';
import { StatusBadge, SeverityBadge } from '../../components/tracker/TrackerBadges';

// ─── Progress Ring ────────────────────────────────────────────
const ProgressRing = ({ percentage, size = 56, strokeWidth = 4, color = '#6366f1' }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgba(148,163,184,0.1)"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
      />
    </svg>
  );
};

// ─── KPI Stat Card ────────────────────────────────────────────
const StatCard = ({ icon: _Icon, label, value, sub, color, bgColor, link }) => (
  <Link
    to={link || '#'}
    className="glass-panel glass-panel-hover p-5 flex items-center gap-4 group animate-slide-up"
  >
    <div className={`p-3 rounded-xl ${bgColor} shrink-0`}>
      <_Icon className={`w-5 h-5 ${color}`} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-2xl font-extrabold text-white">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>}
    </div>
    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
  </Link>
);

// ─── Status Distribution Bar ──────────────────────────────────
const StatusDistributionBar = ({ byStatus }) => {
  const safeByStatus = byStatus || {};
  const total = Object.values(safeByStatus).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const segments = [
    { key: 'completed', color: 'bg-emerald-500', label: 'Completed' },
    { key: 'in_progress', color: 'bg-blue-500', label: 'In Progress' },
    { key: 'awaiting_validation', color: 'bg-amber-500', label: 'Awaiting Validation' },
    { key: 'open', color: 'bg-slate-500', label: 'Open' },
    { key: 'overdue', color: 'bg-rose-500', label: 'Overdue' },
    { key: 'escalated', color: 'bg-red-600', label: 'Escalated' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {segments.map(({ key, color }) => {
          const width = ((safeByStatus[key] || 0) / total) * 100;
          if (width === 0) return null;
          return (
            <div
              key={key}
              className={`${color} rounded-full transition-all duration-700`}
              style={{ width: `${width}%` }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map(({ key, color, label }) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${color}`} />
            <span className="text-xs text-slate-400">
              {label} <span className="text-slate-300 font-semibold">({safeByStatus[key] || 0})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Recent Task Row ──────────────────────────────────────────
const RecentTaskRow = ({ task }) => (
  <Link
    to={`/tracker/tasks/${task.id}`}
    className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-800/50 transition-colors group"
  >
    <div className="shrink-0">
      <SeverityBadge severity={task.severity} size="sm" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-slate-200 group-hover:text-white truncate transition-colors">
        {task.title}
      </p>
      <p className="text-xs text-slate-500 mt-0.5 truncate">{task.customerName} · {task.sourceFindingId}</p>
    </div>
    <div className="shrink-0 flex items-center gap-2">
      <StatusBadge status={task.status} size="sm" />
      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400" />
    </div>
  </Link>
);

// ─── Severity Breakdown Card ──────────────────────────────────
const SeverityBreakdown = ({ bySeverity }) => {
  const items = [
    { key: 'critical', label: 'Critical', color: 'text-red-400', bg: 'bg-red-500', barBg: 'bg-red-500/20' },
    { key: 'high', label: 'High', color: 'text-orange-400', bg: 'bg-orange-500', barBg: 'bg-orange-500/20' },
    { key: 'medium', label: 'Medium', color: 'text-amber-400', bg: 'bg-amber-500', barBg: 'bg-amber-500/20' },
    { key: 'low', label: 'Low', color: 'text-sky-400', bg: 'bg-sky-500', barBg: 'bg-sky-500/20' },
  ];
  const safeBySeverity = bySeverity || {};
  const total = Object.values(safeBySeverity).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      {items.map(({ key, label, color, bg, barBg }) => {
        const count = safeBySeverity[key] || 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={key} className="flex items-center gap-3">
            <span className={`text-xs font-semibold w-14 shrink-0 ${color}`}>{label}</span>
            <div className={`flex-1 h-2 rounded-full ${barBg}`}>
              <div
                className={`h-2 rounded-full ${bg} transition-all duration-700`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-bold text-slate-300 w-5 text-right shrink-0">{count}</span>
          </div>
        );
      })}
    </div>
  );
};

// ─── Main Dashboard Component ─────────────────────────────────
export const TrackerDashboard = () => {
  const { selectedTenant, tenantId, selectTenant, tenants } = useTenant();
  const [searchParams] = useSearchParams();
  const urlTenantApplied = useRef(false);

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
  const [trackerData, setTrackerData] = useState({ items: [], stats: null });
  const [loading, setLoading] = useState(true);

  // AI recommendations state
  const [aiRecs, setAiRecs] = useState([]);
  const [aiRecsLoading, setAiRecsLoading] = useState(false);
  const [aiActionLoading, setAiActionLoading] = useState({});
  const [aiRejectModal, setAiRejectModal] = useState(null);
  const [aiRejectReason, setAiRejectReason] = useState('');

  const loadTracker = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.tracker.list({ page: 1, pageSize: 500 });
      setTrackerData(response || { items: [], stats: null });
    } catch (error) {
      console.error('Unable to load tracker dashboard', error);
      setTrackerData({ items: [], stats: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTracker();
  }, [selectedTenant?.id, loadTracker]);

  // Load pending AI recommendations whenever tenant changes
  useEffect(() => {
    if (!tenantId) { setAiRecs([]); return; }
    setAiRecsLoading(true);
    api.ai.listRecommendations({ tenantId, status: 'pending' })
      .then((result) => setAiRecs(result.recommendations || []))
      .catch(() => {})
      .finally(() => setAiRecsLoading(false));
  }, [tenantId]);

  const handleApproveAiRec = async (rec) => {
    setAiActionLoading((prev) => ({ ...prev, [rec.id]: 'approving' }));
    try {
      await api.ai.approve(rec.id, { tenantId });
      setAiRecs((prev) => prev.filter((r) => r.id !== rec.id));
      await loadTracker();
    } catch (err) {
      console.error('AI approve failed:', err);
    } finally {
      setAiActionLoading((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  };

  const handleRejectAiRec = async () => {
    if (!aiRejectModal) return;
    const { id } = aiRejectModal;
    setAiActionLoading((prev) => ({ ...prev, [id]: 'rejecting' }));
    try {
      await api.ai.reject(id, { tenantId, reason: aiRejectReason || 'Rejected by account manager' });
      setAiRecs((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('AI reject failed:', err);
    } finally {
      setAiActionLoading((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setAiRejectModal(null);
      setAiRejectReason('');
    }
  };

  const analytics = {
    byStatus: { open: 0, in_progress: 0, awaiting_validation: 0, completed: 0, escalated: 0, overdue: 0 },
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    byTenant: {},
    totalTasks: 0,
    completedTasks: 0,
    overallProgress: 0,
    avgProgress: 0,
    totalCarryForwards: 0,
    totalEscalations: 0,
    overdueCount: 0,
    activeTasks: 0,
    ...(trackerData.stats || {}),
  };

  analytics.byStatus = { ...{ open: 0, in_progress: 0, awaiting_validation: 0, completed: 0, escalated: 0, overdue: 0 }, ...(trackerData.stats?.byStatus || {}) };
  analytics.bySeverity = { ...{ critical: 0, high: 0, medium: 0, low: 0 }, ...(trackerData.stats?.bySeverity || {}) };
  analytics.byTenant = trackerData.stats?.byTenant || {};

  const allTasks = trackerData.items || [];

  const criticalOrEscalated = allTasks
    .filter((t) => (t.severity === 'critical' || t.status === 'escalated' || t.status === 'overdue') && t.status !== 'completed')
    .slice(0, 5);

  const recentActivity = [...allTasks]
    .sort((a, b) => new Date(b.lastUpdatedDate) - new Date(a.lastUpdatedDate))
    .slice(0, 6);

  const progressColor =
    analytics.overallProgress >= 75
      ? '#10b981'
      : analytics.overallProgress >= 40
      ? '#f59e0b'
      : '#ef4444';

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tracker Scope</p>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {selectedTenant?.name || 'All Assigned Tenants'}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Tenant-filtered remediation tasks, escalations, and ownership progress
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Link
            to="/meetings"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 text-sm font-medium transition-colors border border-transparent hover:border-slate-700/50"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Meetings
          </Link>
          <Link
            to="/tracker/timeline"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-sm font-semibold transition-colors border border-slate-700/50"
          >
            <GitBranch className="w-4 h-4" />
            Timeline
          </Link>
          <Link
            to="/tracker/ownership"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-sm font-semibold transition-colors border border-slate-700/50"
          >
            <Network className="w-4 h-4" />
            Ownership
          </Link>
          <TenantSelector />
          <Link
            to="/tracker/tasks"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
          >
            <ClipboardList className="w-4 h-4" />
            All Tasks
          </Link>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={ClipboardList}
          label="Total Tasks"
          value={analytics.totalTasks}
          sub={`${analytics.activeTasks} active`}
          color="text-indigo-400"
          bgColor="bg-indigo-500/10"
          link="/tracker/tasks"
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue / Escalated"
          value={(analytics.byStatus?.overdue || 0) + (analytics.byStatus?.escalated || 0)}
          sub={`${analytics.totalEscalations} total escalations`}
          color="text-red-400"
          bgColor="bg-red-500/10"
          link="/tracker/tasks?filter=overdue"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={analytics.completedTasks}
          sub={`${analytics.overallProgress}% completion rate`}
          color="text-emerald-400"
          bgColor="bg-emerald-500/10"
          link="/tracker/tasks?filter=completed"
        />
        <StatCard
          icon={TrendingUp}
          label="Carry Forwards"
          value={analytics.totalCarryForwards}
          sub="tasks rolled across cycles"
          color="text-amber-400"
          bgColor="bg-amber-500/10"
          link="/tracker/tasks"
        />
      </div>

      {/* ── AI Pending Recommendations ── */}
      {(aiRecsLoading || aiRecs.length > 0) && (
        <div className="glass-panel p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                AI Pending Recommendations
              </h2>
              {aiRecs.length > 0 && (
                <span className="bg-violet-500/20 text-violet-300 border border-violet-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {aiRecs.length} pending
                </span>
              )}
            </div>
            {aiRecsLoading && <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />}
          </div>
          {aiRecsLoading && aiRecs.length === 0 ? (
            <p className="text-xs text-slate-500">Loading recommendations…</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {aiRecs.map((rec) => {
                const sevColor = {
                  critical: 'text-rose-400 border-rose-500/30 bg-rose-500/5',
                  high:     'text-amber-400 border-amber-500/30 bg-amber-500/5',
                  medium:   'text-indigo-400 border-indigo-500/30 bg-indigo-500/5',
                  low:      'text-slate-400 border-slate-600 bg-slate-800/40',
                }[rec.severity] || 'text-slate-400 border-slate-600 bg-slate-800/40';
                const actionLoad = aiActionLoading[rec.id];
                return (
                  <div key={rec.id} className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-200 leading-tight">{rec.title}</p>
                        {rec.customerName && (
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{rec.customerName}</p>
                        )}
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase shrink-0 ${sevColor}`}>
                        {rec.severity}
                      </span>
                    </div>
                    {rec.actionPlan && (
                      <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">{rec.actionPlan}</p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                      {rec.category && <span>Category: <span className="text-slate-400">{rec.category}</span></span>}
                      {rec.recommendedOwner && <span>Owner: <span className="text-slate-400">{rec.recommendedOwner}</span></span>}
                      {rec.dueDateSuggestion && <span>Due: <span className="text-slate-400">{rec.dueDateSuggestion.slice(0, 10)}</span></span>}
                    </div>
                    <div className="flex gap-2 pt-0.5">
                      <button
                        onClick={() => handleApproveAiRec(rec)}
                        disabled={!!actionLoad}
                        className="flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <ThumbsUp className="w-3 h-3" />
                        {actionLoad === 'approving' ? 'Approving…' : 'Approve → Task'}
                      </button>
                      <button
                        onClick={() => { setAiRejectModal({ id: rec.id }); setAiRejectReason(''); }}
                        disabled={!!actionLoad}
                        className="flex items-center gap-1 bg-slate-800/60 hover:bg-rose-500/10 border border-slate-700 hover:border-rose-500/30 text-slate-400 hover:text-rose-400 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <ThumbsDown className="w-3 h-3" />
                        {actionLoad === 'rejecting' ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Progress Overview + Severity Breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Overall Progress */}
        <div className="glass-panel p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Overall Progress
            </h2>
            <BarChart3 className="w-4 h-4 text-slate-500" />
          </div>

          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <ProgressRing
                percentage={analytics.overallProgress}
                size={80}
                strokeWidth={6}
                color={progressColor}
              />
              <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-white">
                {analytics.overallProgress}%
              </span>
            </div>
            <div className="space-y-2 flex-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Avg. Progress</span>
                <span className="text-white font-bold">{analytics.avgProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full">
                <div
                  className="h-1.5 bg-indigo-500 rounded-full transition-all duration-700"
                  style={{ width: `${analytics.avgProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Carry Forwards</span>
                <span className="text-amber-400 font-bold">{analytics.totalCarryForwards}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Total Escalations</span>
                <span className="text-red-400 font-bold">{analytics.totalEscalations}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Severity Breakdown */}
        <div className="glass-panel p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              By Severity
            </h2>
            <ShieldAlert className="w-4 h-4 text-slate-500" />
          </div>
          <SeverityBreakdown bySeverity={analytics.bySeverity} />
        </div>

        {/* Status Distribution */}
        <div className="glass-panel p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Status Distribution
            </h2>
            <Clock className="w-4 h-4 text-slate-500" />
          </div>
          <StatusDistributionBar byStatus={analytics.byStatus} />

          <div className="pt-1 border-t border-slate-800/60 mt-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Active Tasks</span>
              <span className="text-sm font-bold text-white">{analytics.activeTasks}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Priority Alerts + Recent Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Priority Alerts */}
        <div className="glass-panel p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-red-400" />
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Priority Alerts
              </h2>
            </div>
            <Link
              to="/tracker/tasks?filter=critical"
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
            >
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          {criticalOrEscalated.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
              <CheckCircle2 className="w-5 h-5 mr-2 text-emerald-500" />
              No critical alerts at this time
            </div>
          ) : (
            <div className="space-y-1">
              {criticalOrEscalated.map((task) => (
                <RecentTaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="glass-panel p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Recent Activity
              </h2>
            </div>
            <Link
              to="/tracker/tasks"
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
            >
              All tasks <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-1">
            {recentActivity.map((task) => (
              <RecentTaskRow key={task.id} task={task} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Customer Breakdown ── */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Task Distribution by Customer
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Object.entries(analytics.byTenant || {}).map(([name, count]) => (
            <Link
              key={name}
              to={`/tracker/tasks?customer=${encodeURIComponent(name)}`}
              className="p-3 rounded-lg bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/50 hover:border-slate-600/50 transition-all group"
            >
              <p className="text-sm font-semibold text-slate-200 group-hover:text-white truncate transition-colors">
                {name}
              </p>
              <p className="text-xl font-extrabold text-indigo-400 mt-1">{count}</p>
              <p className="text-xs text-slate-500">{count === 1 ? 'task' : 'tasks'}</p>
            </Link>
          ))}
        </div>
      </div>

      {loading && (
        <div className="glass-panel p-6 text-sm text-slate-400">Refreshing tenant tracker metrics...</div>
      )}

      {/* ── AI Reject Reason Modal ── */}
      {aiRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel p-5 w-full max-w-sm space-y-4 mx-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Reject Recommendation</h3>
              <button onClick={() => { setAiRejectModal(null); setAiRejectReason(''); }} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">Provide a reason (optional). Rejected recommendations are stored for audit history.</p>
            <textarea
              value={aiRejectReason}
              onChange={(e) => setAiRejectReason(e.target.value)}
              placeholder="Reason for rejection…"
              rows={3}
              className="w-full bg-slate-900 border border-slate-800 focus:border-rose-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors resize-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setAiRejectModal(null); setAiRejectReason(''); }}
                className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-3 py-2">Cancel</button>
              <button onClick={handleRejectAiRec}
                className="bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrackerDashboard;
