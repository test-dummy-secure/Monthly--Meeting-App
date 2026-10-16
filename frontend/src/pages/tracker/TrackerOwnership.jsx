import React, { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { useTenant } from '../../context/TenantContext';
import { TenantSelector } from '../../components/TenantSelector';
import {
  Users,
  ChevronRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Mail,
  BarChart3,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { StatusBadge, SeverityBadge } from '../../components/tracker/TrackerBadges';

// ─── Progress Bar ─────────────────────────────────────────────
const MiniProgressBar = ({ percentage, status }) => {
  const colorMap = {
    completed: 'bg-emerald-500',
    overdue: 'bg-rose-500',
    escalated: 'bg-red-500',
    awaiting_validation: 'bg-amber-500',
    in_progress: 'bg-blue-500',
    open: 'bg-slate-500',
  };
  const color = colorMap[status] || 'bg-indigo-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-400 w-8 text-right">{percentage}%</span>
    </div>
  );
};

// ─── Avatar ───────────────────────────────────────────────────
const Avatar = ({ initials, size = 'md', color = 'indigo' }) => {
  const colors = {
    indigo: 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400',
    sky: 'bg-sky-500/20 border-sky-500/30 text-sky-400',
    emerald: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
    amber: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
    rose: 'bg-rose-500/20 border-rose-500/30 text-rose-400',
    slate: 'bg-slate-700 border-slate-600 text-slate-400',
  };
  const sizes = {
    sm: 'w-7 h-7 text-[9px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm',
  };

  return (
    <div
      className={`rounded-full border flex items-center justify-center shrink-0 font-bold ${colors[color] || colors.indigo} ${sizes[size] || sizes.md}`}
    >
      {initials}
    </div>
  );
};

// ─── Owner Task Card (inside owner section) ───────────────────
const OwnerTaskCard = ({ task, ownerType }) => (
  <Link
    to={`/tracker/tasks/${task.id}`}
    className="flex items-start gap-3 p-3 rounded-lg border border-slate-800/60 hover:border-slate-700 hover:bg-slate-800/40 transition-all group"
  >
    <div className="mt-0.5">
      <SeverityBadge severity={task.severity} size="sm" showIcon={false} />
    </div>
    <div className="flex-1 min-w-0 space-y-1.5">
      <p className="text-xs font-semibold text-slate-200 group-hover:text-white line-clamp-2 leading-snug transition-colors">
        {task.title}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={task.status} size="sm" />
        <span className="text-[10px] text-slate-600 font-mono">{task.sourceFindingId}</span>
      </div>
      <MiniProgressBar percentage={task.progressPercentage} status={task.status} />
      <div className="flex items-center gap-1.5">
        <Clock className="w-3 h-3 text-slate-600" />
        <span className={`text-[10px] font-medium ${
          new Date(task.dueDate) < new Date() && task.status !== 'completed'
            ? 'text-rose-400'
            : 'text-slate-500'
        }`}>
          Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        {ownerType === 'primary' && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold uppercase">
            Lead
          </span>
        )}
      </div>
    </div>
    <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0 mt-0.5 transition-colors" />
  </Link>
);

// ─── Owner Profile Card ───────────────────────────────────────
const OwnerCard = ({ owner, primaryTasks, secondaryTasks, avatarColor }) => {
  const [expanded, setExpanded] = useState(true);
  const allTasks = [...primaryTasks, ...secondaryTasks];

  const completedCount = allTasks.filter((t) => t.status === 'completed').length;
  const overdueCount = allTasks.filter(
    (t) => new Date(t.dueDate) < new Date() && t.status !== 'completed'
  ).length;
  const escalatedCount = allTasks.filter((t) => t.status === 'escalated').length;
  const avgProgress =
    allTasks.length > 0
      ? Math.round(allTasks.reduce((s, t) => s + t.progressPercentage, 0) / allTasks.length)
      : 0;

  return (
    <div className="glass-panel overflow-hidden">
      {/* Owner Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-start gap-4 p-5 hover:bg-slate-800/30 transition-colors text-left"
      >
        <Avatar initials={owner.avatar} size="lg" color={avatarColor} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-base font-extrabold text-white">{owner.name}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 border border-slate-600 font-medium">
              {owner.role}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mb-3">
            <Mail className="w-3 h-3 text-slate-500" />
            <span className="text-xs text-slate-500 font-mono">{owner.email}</span>
          </div>
          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center">
              <p className="text-lg font-extrabold text-white">{allTasks.length}</p>
              <p className="text-[10px] text-slate-500 leading-tight">Total</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-extrabold text-emerald-400">{completedCount}</p>
              <p className="text-[10px] text-slate-500 leading-tight">Done</p>
            </div>
            <div className={`text-center ${overdueCount + escalatedCount > 0 ? '' : ''}`}>
              <p className={`text-lg font-extrabold ${overdueCount + escalatedCount > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                {overdueCount + escalatedCount}
              </p>
              <p className="text-[10px] text-slate-500 leading-tight">At Risk</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-extrabold text-indigo-400">{avgProgress}%</p>
              <p className="text-[10px] text-slate-500 leading-tight">Avg Prog.</p>
            </div>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform duration-300 shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-800/60 animate-slide-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/60">
            {/* Primary Tasks */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 font-bold uppercase tracking-wider">
                  Primary Lead
                </span>
                <span className="text-xs text-slate-500">{primaryTasks.length} tasks</span>
              </div>
              {primaryTasks.length === 0 ? (
                <p className="text-xs text-slate-600 italic py-4 text-center">No primary tasks assigned</p>
              ) : (
                <div className="space-y-2">
                  {primaryTasks.map((task) => (
                    <OwnerTaskCard key={task.id} task={task} ownerType="primary" />
                  ))}
                </div>
              )}
            </div>

            {/* Secondary Tasks */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/25 font-bold uppercase tracking-wider">
                  Secondary Support
                </span>
                <span className="text-xs text-slate-500">{secondaryTasks.length} tasks</span>
              </div>
              {secondaryTasks.length === 0 ? (
                <p className="text-xs text-slate-600 italic py-4 text-center">No secondary tasks assigned</p>
              ) : (
                <div className="space-y-2">
                  {secondaryTasks.map((task) => (
                    <OwnerTaskCard key={task.id} task={task} ownerType="secondary" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Team Panel ───────────────────────────────────────────────
const TeamPanel = ({ teamName, tasks, isHighlighted }) => {
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const atRiskCount = tasks.filter(
    (t) => (t.status === 'escalated' || t.status === 'overdue') && t.status !== 'completed'
  ).length;
  const avgProgress =
    tasks.length > 0
      ? Math.round(tasks.reduce((s, t) => s + t.progressPercentage, 0) / tasks.length)
      : 0;

  const colorPct = avgProgress >= 75 ? 'bg-emerald-500' : avgProgress >= 40 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div
      className={`glass-panel p-4 space-y-3 transition-all ${isHighlighted ? 'ring-1 ring-indigo-500/40 cyber-glow' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-200 leading-snug">{teamName}</h3>
        {atRiskCount > 0 && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full font-bold">
            <AlertTriangle className="w-2.5 h-2.5" /> {atRiskCount} at risk
          </span>
        )}
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-slate-500">Team Progress</span>
          <span className="font-bold text-white">{avgProgress}%</span>
        </div>
        <div className="w-full h-2 bg-slate-800 rounded-full">
          <div
            className={`h-2 rounded-full transition-all duration-700 ${colorPct}`}
            style={{ width: `${avgProgress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-slate-500" />
          <span className="text-slate-400">{tasks.length} Total</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-slate-400">{completedCount} Done</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-slate-400">{tasks.filter((t) => t.status === 'in_progress').length} Active</span>
        </div>
      </div>

      {/* Severity breakdown */}
      <div className="flex gap-1.5 flex-wrap">
        {['critical', 'high', 'medium', 'low'].map((sev) => {
          const count = tasks.filter((t) => t.severity === sev).length;
          if (count === 0) return null;
          return (
            <span key={sev}>
              <SeverityBadge severity={sev} size="sm" />
              <span className="sr-only">{count}</span>
            </span>
          );
        })}
      </div>

      <Link
        to={`/tracker/tasks?customer=`}
        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
      >
        View team tasks <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
};

// ─── Main Ownership View ──────────────────────────────────────
export const TrackerOwnership = () => {
  const { selectedTenant } = useTenant();
  const [searchParams] = useSearchParams();
  const focusTeam = searchParams.get('team');

  const [filterCustomer, setFilterCustomer] = useState('');
  const [viewMode, setViewMode] = useState('owners'); // 'owners' | 'teams'
  const [allTasks, setAllTasks] = useState([]);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const response = await api.tracker.list({ page: 1, pageSize: 500 });
        setAllTasks(response?.items || []);
      } catch (error) {
        console.error('Unable to load ownership view', error);
        setAllTasks([]);
      }
    };

    loadTasks();
  }, [selectedTenant?.id]);

  const customers = useMemo(() => [...new Set(allTasks.map((t) => t.customerName))], [allTasks]);

  const filtered = useMemo(() => {
    if (!filterCustomer) return allTasks;
    return allTasks.filter((t) => t.customerName === filterCustomer);
  }, [allTasks, filterCustomer]);

  // Group by primary owners
  const ownerMap = useMemo(() => {
    const map = {};
    filtered.forEach((task) => {
      const pId = task.primaryOwner.id;
      if (!map[pId]) {
        map[pId] = {
          owner: task.primaryOwner,
          primaryTasks: [],
          secondaryTasks: [],
        };
      }
      map[pId].primaryTasks.push(task);
    });

    // Also add secondary owner references
    filtered.forEach((task) => {
      const sId = task.secondaryOwner.id;
      if (!map[sId]) {
        map[sId] = {
          owner: task.secondaryOwner,
          primaryTasks: [],
          secondaryTasks: [],
        };
      }
      if (!map[sId].primaryTasks.find((t) => t.id === task.id)) {
        map[sId].secondaryTasks.push(task);
      }
    });

    return map;
  }, [filtered]);

  // Group by team
  const teamMap = useMemo(() => {
    const map = {};
    filtered.forEach((task) => {
      const team = task.ownershipTeam;
      if (!map[team]) map[team] = [];
      map[team].push(task);
    });
    return map;
  }, [filtered]);

  const AVATAR_COLORS = ['indigo', 'sky', 'emerald', 'amber', 'rose', 'slate'];

  return (
    <div className="space-y-5 animate-slide-up">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tracker Scope</p>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {selectedTenant?.name || 'All Assigned Tenants'}
          </h1>
        </div>
        <TenantSelector />
      </div>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Ownership View</h1>
          <p className="text-slate-400 text-sm mt-1">
            Task accountability mapped to owners and security teams
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/tracker/dashboard"
            className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg transition-all"
          >
            ← Tracker
          </Link>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* View Mode Toggle */}
        <div className="flex items-center bg-slate-800/60 border border-slate-700/60 rounded-lg p-1 gap-1">
          <button
            onClick={() => setViewMode('owners')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
              viewMode === 'owners'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> By Owner
          </button>
          <button
            onClick={() => setViewMode('teams')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
              viewMode === 'teams'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" /> By Team
          </button>
        </div>

        {/* Customer Filter */}
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <select
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            className="appearance-none pl-8 pr-8 py-2 bg-slate-800/60 border border-slate-700/60 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60"
          >
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        </div>
      </div>

      {/* ── Summary Ribbon ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Total Owners',
            value: Object.keys(ownerMap).length,
            icon: Users,
            color: 'text-indigo-400',
            bg: 'bg-indigo-500/10',
          },
          {
            label: 'Total Teams',
            value: Object.keys(teamMap).length,
            icon: BarChart3,
            color: 'text-sky-400',
            bg: 'bg-sky-500/10',
          },
          {
            label: 'Completed Tasks',
            value: filtered.filter((t) => t.status === 'completed').length,
            icon: CheckCircle2,
            color: 'text-emerald-400',
            bg: 'bg-emerald-500/10',
          },
          {
            label: 'At Risk',
            value: filtered.filter(
              (t) => t.status === 'escalated' || t.status === 'overdue'
            ).length,
            icon: AlertTriangle,
            color: 'text-red-400',
            bg: 'bg-red-500/10',
          },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="glass-panel p-4 flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${bg} shrink-0`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div>
              <p className="text-xl font-extrabold text-white">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Owner / Team Views ── */}
      {viewMode === 'owners' ? (
        <div className="space-y-4">
          {Object.entries(ownerMap).length === 0 ? (
            <div className="glass-panel p-12 flex items-center justify-center text-slate-500 text-sm">
              No owners found for the selected filters.
            </div>
          ) : (
            Object.entries(ownerMap).map(([ownerId, { owner, primaryTasks, secondaryTasks }], idx) => (
              <OwnerCard
                key={ownerId}
                owner={owner}
                primaryTasks={primaryTasks}
                secondaryTasks={secondaryTasks}
                avatarColor={AVATAR_COLORS[idx % AVATAR_COLORS.length]}
              />
            ))
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(teamMap).map(([teamName, tasks]) => (
            <TeamPanel
              key={teamName}
              teamName={teamName}
              tasks={tasks}
              isHighlighted={focusTeam === teamName}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TrackerOwnership;
