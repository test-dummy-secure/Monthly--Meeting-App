import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useTenant } from '../../context/TenantContext';
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronRight,
  Clock,
  Eye,
  Flame,
  HeartPulse,
  Shield,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Users,
  ArrowUpRight,
  Filter,
  RefreshCw,
} from 'lucide-react';

// Business rule constants — not mock data
const ESCALATION_RULES = [
  { day: 7,  action: 'notify_customer',        label: 'Customer Notified',            level: 1, color: '#f59e0b' },
  { day: 14, action: 'notify_account_manager',  label: 'Account Manager Notified',     level: 2, color: '#f97316' },
  { day: 21, action: 'notify_customer_again',   label: 'Customer Re-Notified',         level: 3, color: '#ef4444' },
  { day: 28, action: 'escalate_stakeholder',    label: 'Senior Stakeholder Escalated', level: 4, color: '#dc2626' },
];

// ─── Severity Badge ──────────────────────────────────────────────
const SeverityBadge = ({ severity }) => {
  const styles = {
    critical: 'bg-red-500/15 text-red-400 border-red-500/30',
    high:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
    medium:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
    low:      'bg-sky-500/15 text-sky-400 border-sky-500/30',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${styles[severity] || styles.low}`}>
      {severity || 'low'}
    </span>
  );
};

// ─── Escalation Level Indicator ──────────────────────────────────
const EscalationLevelBadge = ({ level }) => {
  const configs = {
    0: { label: 'Healthy',   bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
    1: { label: 'Level 1',   bg: 'bg-amber-500/15',   text: 'text-amber-400',   border: 'border-amber-500/30',   dot: 'bg-amber-400' },
    2: { label: 'Level 2',   bg: 'bg-orange-500/15',  text: 'text-orange-400',  border: 'border-orange-500/30',  dot: 'bg-orange-400' },
    3: { label: 'Level 3',   bg: 'bg-red-500/15',     text: 'text-red-400',     border: 'border-red-500/30',     dot: 'bg-red-400' },
    4: { label: 'Escalated', bg: 'bg-red-600/20',     text: 'text-red-300',     border: 'border-red-500/40',     dot: 'bg-red-400 pulse-indicator' },
  };
  const c = configs[level] || configs[0];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
};

// ─── KPI Widget Card ────────────────────────────────────────────
const KPIWidget = ({ icon: Icon, label, value, sub, color, bgGlow, accent, onClick, pulse }) => (
  <button
    onClick={onClick}
    className={`glass-panel glass-panel-hover p-5 flex items-start gap-4 text-left w-full group animate-slide-up relative overflow-hidden ${pulse ? 'ring-1 ring-red-500/30' : ''}`}
  >
    {bgGlow && <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 ${bgGlow}`} />}
    <div className={`p-3 rounded-xl ${accent} shrink-0 relative z-10`}>
      <Icon className={`w-5 h-5 ${color}`} />
    </div>
    <div className="flex-1 min-w-0 relative z-10">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-3xl font-extrabold text-white leading-none">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1.5">{sub}</p>}
    </div>
    <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-400 transition-colors shrink-0 mt-1 relative z-10" />
  </button>
);

// ─── Escalation Distribution Bar ─────────────────────────────────
const EscalationDistribution = ({ byLevel }) => {
  const total = Object.values(byLevel).reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="text-sm text-slate-500">No escalations recorded — all tasks are up to date.</p>;
  const segments = [
    { key: 'level1', color: 'bg-amber-500',  label: 'Day 7 · Customer Notified',       count: byLevel.level1 },
    { key: 'level2', color: 'bg-orange-500', label: 'Day 14 · AM Notified',             count: byLevel.level2 },
    { key: 'level3', color: 'bg-red-500',    label: 'Day 21 · Customer Re-Notified',    count: byLevel.level3 },
    { key: 'level4', color: 'bg-red-700',    label: 'Day 28 · Stakeholder Escalated',   count: byLevel.level4 },
  ];
  return (
    <div className="space-y-4">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {segments.map(({ key, color, count }) => {
          const width = (count / total) * 100;
          if (width === 0) return null;
          return <div key={key} className={`${color} rounded-full transition-all duration-700`} style={{ width: `${width}%` }} />;
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {segments.map(({ key, color, label, count }) => (
          <div key={key} className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/30">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-400 truncate">{label}</p>
              <p className="text-sm font-bold text-white">{count}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Health Score Ring ───────────────────────────────────────────
const HealthRing = ({ score, size = 80, strokeWidth = 6 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(148,163,184,0.1)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-white">
        {score}
      </span>
    </div>
  );
};

// ─── Customer Health Card ───────────────────────────────────────
const CustomerHealthCard = ({ customer }) => (
  <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:border-slate-600/50 transition-all group">
    <div className="flex items-center gap-3 mb-3">
      <HealthRing score={customer.healthScore} size={48} strokeWidth={4} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-200 group-hover:text-white truncate transition-colors">
          {customer.name}
        </p>
        <p className="text-xs text-slate-500">{customer.accountManager}</p>
      </div>
      <span
        className="text-xs font-extrabold px-2 py-1 rounded-md"
        style={{ color: customer.gradeColor, backgroundColor: `${customer.gradeColor}20` }}
      >
        {customer.grade}
      </span>
    </div>
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <span>{customer.totalTasks} tasks</span>
      <span className="text-slate-700">·</span>
      {customer.staleTasks > 0 && (
        <span className="text-amber-400 font-medium">{customer.staleTasks} stale</span>
      )}
      {customer.escalatedTasks > 0 && (
        <>
          <span className="text-slate-700">·</span>
          <span className="text-red-400 font-medium">{customer.escalatedTasks} escalated</span>
        </>
      )}
      {customer.staleTasks === 0 && customer.escalatedTasks === 0 && (
        <span className="text-emerald-400 font-medium">All healthy</span>
      )}
    </div>
  </div>
);

// ─── Stale Task Row ─────────────────────────────────────────────
const StaleTaskRow = ({ task, index }) => (
  <div
    className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-800/50 transition-all group"
    style={{ animationDelay: `${index * 50}ms` }}
  >
    <div className="shrink-0">
      <SeverityBadge severity={task.severity} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-slate-200 group-hover:text-white truncate transition-colors">
        {task.title}
      </p>
      <p className="text-xs text-slate-500 mt-0.5 truncate">
        {task.customerName} · {task.ownerName || 'Unassigned'} · {task.staleDays}d stale
      </p>
    </div>
    <div className="shrink-0 flex items-center gap-2">
      <EscalationLevelBadge level={task.escalationLevel} />
      <Link
        to={`/tracker/tasks/${task.id}`}
        className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all opacity-0 group-hover:opacity-100"
        title="View Task"
      >
        <Eye className="w-3.5 h-3.5" />
      </Link>
    </div>
  </div>
);

// ─── Empty State ────────────────────────────────────────────────
const EmptyBucket = () => (
  <div className="flex flex-col items-center justify-center py-12 text-slate-500">
    <HeartPulse className="w-10 h-10 text-emerald-500/50 mb-3" />
    <p className="text-sm font-medium">No tasks in this bucket</p>
    <p className="text-xs text-slate-600 mt-1">All tasks are up to date</p>
  </div>
);

// ─── Main Component ─────────────────────────────────────────────
export const MonitoringDashboard = () => {
  const { selectedTenant } = useTenant();
  const [activeBucket, setActiveBucket] = useState('all-stale');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await api.monitoring.getDashboard(selectedTenant?.id || null);
      setData(result);
    } catch (err) {
      setError('Failed to load monitoring data. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.monitoring.getDashboard(selectedTenant?.id || null);
        if (active) setData(result);
      } catch {
        if (active) setError('Failed to load monitoring data.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [selectedTenant?.id]);

  const filteredTasks = useMemo(() => {
    if (!data?.tasks) return [];
    const t = data.tasks;
    switch (activeBucket) {
      case '7+':       return t.filter(x => x.staleDays >= 7  && x.staleDays < 14);
      case '14+':      return t.filter(x => x.staleDays >= 14 && x.staleDays < 21);
      case '21+':      return t.filter(x => x.staleDays >= 21 && x.staleDays < 28);
      case '28+':      return t.filter(x => x.staleDays >= 28);
      case 'all-stale':
      default:         return t.filter(x => x.staleDays >= 7);
    }
  }, [data?.tasks, activeBucket]);

  const buckets = [
    { key: 'all-stale', label: 'All Stale' },
    { key: '7+',        label: '7+ Days' },
    { key: '14+',       label: '14+ Days' },
    { key: '21+',       label: '21+ Days' },
    { key: '28+',       label: '28+ Days' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 animate-slide-up">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-3" />
        <span>Loading monitoring data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500 animate-slide-up">
        <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
        <p className="text-lg font-semibold text-slate-300 mb-4">{error}</p>
        <button
          onClick={() => fetchData()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  const { stats = {}, escalation = {}, customers = [] } = data || {};

  return (
    <div className="space-y-6 animate-slide-up">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <Activity className="w-7 h-7 text-indigo-400" />
            Monitoring Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time task staleness monitoring &amp; automated escalation tracking
            {selectedTenant && (
              <span className="ml-1 text-indigo-400 font-semibold">— {selectedTenant.name}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white text-sm font-semibold transition-colors border border-slate-700/50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            to="/meetings"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
          >
            <ShieldAlert className="w-4 h-4" />
            Meetings & Tracker
          </Link>
        </div>
      </div>

      {/* ── KPI Widget Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIWidget
          icon={Clock}
          label="Tasks Not Updated 7+ Days"
          value={stats.staleTasks7 ?? 0}
          sub={`${stats.totalStaleTasks ?? 0} total stale tasks`}
          color="text-amber-400"
          bgGlow="bg-amber-500"
          accent="bg-amber-500/10"
          onClick={() => setActiveBucket('7+')}
        />
        <KPIWidget
          icon={AlertTriangle}
          label="Tasks Not Updated 14+ Days"
          value={stats.staleTasks14 ?? 0}
          sub="Account managers notified"
          color="text-orange-400"
          bgGlow="bg-orange-500"
          accent="bg-orange-500/10"
          onClick={() => setActiveBucket('14+')}
        />
        <KPIWidget
          icon={Flame}
          label="Escalated Tasks (28+ Days)"
          value={stats.escalatedTasks ?? 0}
          sub="Stakeholder escalation triggered"
          color="text-red-400"
          bgGlow="bg-red-500"
          accent="bg-red-500/10"
          onClick={() => setActiveBucket('28+')}
          pulse={(stats.escalatedTasks ?? 0) > 0}
        />
        <KPIWidget
          icon={HeartPulse}
          label="Avg. Customer Health"
          value={`${stats.avgHealthScore ?? 100}%`}
          sub={`${customers.filter(c => c.healthScore >= 75).length} of ${customers.length} customers healthy`}
          color="text-emerald-400"
          bgGlow="bg-emerald-500"
          accent="bg-emerald-500/10"
          onClick={() => {}}
        />
      </div>

      {/* ── Escalation Distribution + Business Rules ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-panel p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Escalation Distribution
              </h2>
            </div>
            <span className="text-xs text-slate-500">{escalation.totalEscalations ?? 0} total</span>
          </div>
          <EscalationDistribution byLevel={escalation.byLevel || { level1: 0, level2: 0, level3: 0, level4: 0 }} />
        </div>

        <div className="glass-panel p-6">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Escalation Policy
            </h2>
          </div>
          <div className="space-y-3">
            {ESCALATION_RULES.map((rule) => (
              <div key={rule.day} className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/30">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-extrabold"
                  style={{ backgroundColor: `${rule.color}20`, color: rule.color }}
                >
                  {rule.day}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-300">{rule.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {rule.day === 7  && 'Auto-notify assigned customer contact'}
                    {rule.day === 14 && 'Escalate to assigned account manager'}
                    {rule.day === 21 && 'Re-notify customer with urgency flag'}
                    {rule.day === 28 && 'Escalate to senior stakeholder'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Stale Tasks Table ── */}
      <div className="glass-panel p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Monitored Tasks
            </h2>
            <span className="text-xs text-slate-500 ml-1">({filteredTasks.length})</span>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-800/60 rounded-lg">
            {buckets.map((b) => (
              <button
                key={b.key}
                onClick={() => setActiveBucket(b.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeBucket === b.key
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {filteredTasks.length === 0
          ? <EmptyBucket />
          : (
            <div className="space-y-1">
              {filteredTasks.map((task, i) => (
                <StaleTaskRow key={task.id} task={task} index={i} />
              ))}
            </div>
          )
        }
      </div>

      {/* ── Customer Health Scores ── */}
      <div className="glass-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Customer Health Scores
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Avg: <span className="text-white font-bold">{stats.avgHealthScore ?? 100}%</span>
            </span>
            {(stats.avgHealthScore ?? 100) < 70
              ? <TrendingDown className="w-4 h-4 text-red-400" />
              : <TrendingUp className="w-4 h-4 text-emerald-400" />
            }
          </div>
        </div>
        {customers.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No customer data available for the selected tenant.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {customers.map((customer) => (
              <CustomerHealthCard key={customer.id} customer={customer} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MonitoringDashboard;
