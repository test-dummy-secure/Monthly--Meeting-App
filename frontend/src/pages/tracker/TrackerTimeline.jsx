import React, { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { useTenant } from '../../context/TenantContext';
import { TenantSelector } from '../../components/TenantSelector';
import {
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  PlusCircle,
  ThumbsUp,
  UserPlus,
  RefreshCcw,
  ShieldCheck,
  Activity,
  Filter,
  Building2,
  ChevronDown,
} from 'lucide-react';
import { StatusBadge, SeverityBadge } from '../../components/tracker/TrackerBadges';

// ─── Timeline Event Type Config ───────────────────────────────
const EVENT_CONFIG = {
  created: {
    icon: PlusCircle,
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/15 border-indigo-500/30',
    line: 'border-indigo-500/20',
  },
  approved: {
    icon: ThumbsUp,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15 border-emerald-500/30',
    line: 'border-emerald-500/20',
  },
  assigned: {
    icon: UserPlus,
    color: 'text-sky-400',
    bg: 'bg-sky-500/15 border-sky-500/30',
    line: 'border-sky-500/20',
  },
  progress: {
    icon: Activity,
    color: 'text-blue-400',
    bg: 'bg-blue-500/15 border-blue-500/30',
    line: 'border-blue-500/20',
  },
  update: {
    icon: RefreshCcw,
    color: 'text-slate-400',
    bg: 'bg-slate-700/40 border-slate-600/40',
    line: 'border-slate-700/40',
  },
  validation: {
    icon: ShieldCheck,
    color: 'text-amber-400',
    bg: 'bg-amber-500/15 border-amber-500/30',
    line: 'border-amber-500/20',
  },
  escalated: {
    icon: AlertTriangle,
    color: 'text-red-400',
    bg: 'bg-red-500/15 border-red-500/30',
    line: 'border-red-500/20',
  },
  carry_forward: {
    icon: ArrowUpCircle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/15 border-amber-500/30',
    line: 'border-amber-500/20',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15 border-emerald-500/30',
    line: 'border-emerald-500/20',
  },
};

// ─── Single Timeline Event Node ───────────────────────────────
const TimelineEvent = ({ event, isLast }) => {
  const config = EVENT_CONFIG[event.type] || EVENT_CONFIG.update;
  const Icon = config.icon;
  const eventDate = new Date(event.date);

  return (
    <div className="flex gap-4">
      {/* Icon + Vertical Line */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-8 h-8 rounded-full border flex items-center justify-center ${config.bg} shrink-0 z-10`}>
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        </div>
        {!isLast && (
          <div className={`w-px flex-1 mt-1 border-l-2 border-dashed ${config.line} min-h-[24px]`} />
        )}
      </div>

      {/* Content */}
      <div className={`pb-6 flex-1 min-w-0 ${isLast ? '' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <p className="text-sm font-semibold text-slate-200 leading-snug">{event.event}</p>
          <time className="text-xs text-slate-500 shrink-0">
            {eventDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {' · '}
            {eventDate.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>
        <p className={`text-xs mt-1 font-medium ${config.color}`}>by {event.actor}</p>
      </div>
    </div>
  );
};

// ─── Task Timeline Card ───────────────────────────────────────
const TaskTimelineCard = ({ task, isHighlighted }) => {
  const [expanded, setExpanded] = useState(isHighlighted);

  return (
    <div className={`glass-panel overflow-hidden transition-all duration-300 ${isHighlighted ? 'ring-1 ring-indigo-500/40 cyber-glow' : ''}`}>
      {/* Card Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-start gap-4 p-5 hover:bg-slate-800/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-2">
            <SeverityBadge severity={task.severity} size="sm" />
            <StatusBadge status={task.status} size="sm" />
            <span className="text-xs font-mono text-slate-500">{task.sourceFindingId}</span>
          </div>
          <h3 className="text-sm font-bold text-slate-200 leading-snug line-clamp-1">{task.title}</h3>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Building2 className="w-3 h-3" />
              {task.customerName}
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="w-3 h-3" />
              {task.meetingTimeline}
            </span>
            <span className="text-xs text-slate-500">
              {task.timeline.length} {task.timeline.length === 1 ? 'event' : 'events'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/tracker/tasks/${task.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded hover:bg-indigo-500/10"
          >
            Details
          </Link>
          <ChevronDown
            className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Timeline Events */}
      {expanded && (
        <div className="px-5 pb-5 pt-2 border-t border-slate-800/60 animate-slide-up">
          <div className="pt-4">
            {[...task.timeline]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((event, idx, arr) => (
                <TimelineEvent key={event.id} event={event} isLast={idx === arr.length - 1} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Timeline Page ───────────────────────────────────────
export const TrackerTimeline = () => {
  const { selectedTenant } = useTenant();
  const [searchParams] = useSearchParams();
  const focusTaskId = searchParams.get('task');

  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [allTasks, setAllTasks] = useState([]);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const response = await api.tracker.list({ page: 1, pageSize: 500 });
        setAllTasks(response?.items || []);
      } catch (error) {
        console.error('Unable to load tracker timeline', error);
        setAllTasks([]);
      }
    };

    loadTasks();
  }, [selectedTenant?.id]);

  const customers = useMemo(() => [...new Set(allTasks.map((t) => t.customerName))], [allTasks]);

  const filtered = useMemo(() => {
    let tasks = [...allTasks];
    if (selectedCustomer) tasks = tasks.filter((t) => t.customerName === selectedCustomer);
    if (selectedStatus) tasks = tasks.filter((t) => t.status === selectedStatus);

    // Sort: focused task first, then by most recent timeline event
    tasks.sort((a, b) => {
      if (a.id === focusTaskId) return -1;
      if (b.id === focusTaskId) return 1;
      const aLatest = Math.max(...a.timeline.map((e) => new Date(e.date).getTime()));
      const bLatest = Math.max(...b.timeline.map((e) => new Date(e.date).getTime()));
      return bLatest - aLatest;
    });

    return tasks;
  }, [allTasks, selectedCustomer, selectedStatus, focusTaskId]);

  // Global chronological feed — all events across all tasks
  const globalFeed = useMemo(() => {
    const events = filtered.flatMap((task) =>
      task.timeline.map((evt) => ({
        ...evt,
        taskId: task.id,
        taskTitle: task.title,
        taskSeverity: task.severity,
        taskStatus: task.status,
        customerName: task.customerName,
        sourceFindingId: task.sourceFindingId,
      }))
    );
    return events.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
  }, [filtered]);

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
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Task Timeline</h1>
          <p className="text-slate-400 text-sm mt-1">
            Full audit trail of all remediation task events across meeting cycles
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((p) => !p)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
              showFilters
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filter
          </button>
          <Link
            to="/tracker/dashboard"
            className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg transition-all"
          >
            ← Tracker
          </Link>
        </div>
      </div>

      {/* ── Filters ── */}
      {showFilters && (
        <div className="glass-panel p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 animate-slide-up">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</label>
            <div className="relative">
              <select
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
                className="w-full appearance-none bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60 pr-8"
              >
                <option value="">All Customers</option>
                {customers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</label>
            <div className="relative">
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full appearance-none bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60 pr-8"
              >
                <option value="">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="awaiting_validation">Awaiting Validation</option>
                <option value="completed">Completed</option>
                <option value="escalated">Escalated</option>
                <option value="overdue">Overdue</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* ── Per-Task Timelines ── */}
        <div className="xl:col-span-2 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" />
            Per-Task Audit Trails ({filtered.length})
          </h2>
          {filtered.length === 0 ? (
            <div className="glass-panel p-12 flex items-center justify-center text-slate-500 text-sm">
              No tasks match your current filters.
            </div>
          ) : (
            filtered.map((task) => (
              <TaskTimelineCard
                key={task.id}
                task={task}
                isHighlighted={task.id === focusTaskId}
              />
            ))
          )}
        </div>

        {/* ── Global Activity Feed ── */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            Global Activity Feed
          </h2>
          <div className="glass-panel p-5 space-y-0">
            {globalFeed.map((evt, idx) => {
              const config = EVENT_CONFIG[evt.type] || EVENT_CONFIG.update;
              const Icon = config.icon;
              const d = new Date(evt.date);
              const isLast = idx === globalFeed.length - 1;

              return (
                <div key={`${evt.taskId}-${evt.id}`} className="flex gap-3">
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-7 h-7 rounded-full border flex items-center justify-center ${config.bg} shrink-0 z-10`}>
                      <Icon className={`w-3 h-3 ${config.color}`} />
                    </div>
                    {!isLast && (
                      <div className={`w-px flex-1 mt-1 border-l-2 border-dashed ${config.line} min-h-[20px]`} />
                    )}
                  </div>
                  <div className="pb-5 flex-1 min-w-0">
                    <Link
                      to={`/tracker/tasks/${evt.taskId}`}
                      className="text-xs font-semibold text-slate-200 hover:text-indigo-300 transition-colors line-clamp-2 leading-snug"
                    >
                      {evt.event}
                    </Link>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-slate-500">{evt.customerName}</span>
                      <span className="text-[10px] text-slate-600">·</span>
                      <span className="text-[10px] text-slate-500">
                        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <SeverityBadge severity={evt.taskSeverity} size="sm" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackerTimeline;
