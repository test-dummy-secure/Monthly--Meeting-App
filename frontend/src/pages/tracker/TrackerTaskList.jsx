import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { useTenant } from '../../context/TenantContext';
import { TenantSelector } from '../../components/TenantSelector';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  X,
  SlidersHorizontal,
  ExternalLink,
  Calendar,
  Building2,
  Clock,
  TrendingUp,
  ChevronDown,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { StatusBadge, SeverityBadge } from '../../components/tracker/TrackerBadges';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// ─── Progress Bar ─────────────────────────────────────────────
const ProgressBar = ({ percentage, status }) => {
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
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-400 w-8 text-right shrink-0">
        {percentage}%
      </span>
    </div>
  );
};

// ─── Filter Chip ──────────────────────────────────────────────
const FilterChip = ({ label, onRemove }) => (
  <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-xs font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 rounded-full">
    {label}
    <button onClick={onRemove} className="hover:text-indigo-200 transition-colors">
      <X className="w-3 h-3" />
    </button>
  </span>
);

// ─── Column Header with Sort ──────────────────────────────────
const SortableHeader = ({ label, field, sortField, sortDir, onSort }) => (
  <button
    className="flex items-center gap-1 group text-left"
    onClick={() => onSort(field)}
  >
    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider group-hover:text-slate-200 transition-colors">
      {label}
    </span>
    <ArrowUpDown
      className={`w-3 h-3 transition-colors ${
        sortField === field ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'
      } ${sortField === field && sortDir === 'desc' ? 'rotate-180' : ''}`}
    />
  </button>
);

// ─── ClickUp Status Pill ──────────────────────────────────────
const CU_PILL = {
  'to do':       'bg-slate-500/15 text-slate-400 border-slate-500/25',
  'in progress': 'bg-sky-500/15   text-sky-400   border-sky-500/25',
  'complete':    'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  'closed':      'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
};
const ClickUpStatusPill = ({ status }) => {
  const cls = CU_PILL[status?.toLowerCase()] || 'bg-slate-500/15 text-slate-400 border-slate-500/25';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cls} capitalize`}>
      {status}
    </span>
  );
};

// ─── Task Table Row ───────────────────────────────────────────
const TaskRow = ({ task }) => {
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const isOverdue = dueDate ? dueDate < new Date() && task.status !== 'completed' : false;
  const ownerName = task.primaryOwner?.name || task.ownerName || 'Unassigned';
  const ownerAvatar = task.primaryOwner?.avatar || ownerName.charAt(0) || 'U';

  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors group">
      <td className="py-3.5 px-4">
        <div className="flex flex-col gap-0.5">
          <Link
            to={`/tracker/tasks/${task.id}`}
            className="text-sm font-semibold text-slate-200 group-hover:text-white hover:text-indigo-300 transition-colors line-clamp-1 max-w-md"
          >
            {task.title}
          </Link>
          <span className="text-xs text-slate-500 font-mono">{task.sourceFindingId}</span>
        </div>
      </td>
      <td className="py-3.5 px-4 whitespace-nowrap">
        <SeverityBadge severity={task.severity} size="sm" />
      </td>
      <td className="py-3.5 px-4 whitespace-nowrap">
        <StatusBadge status={task.status} size="sm" />
      </td>
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-sm text-slate-300 truncate max-w-[200px]">{task.customerName}</span>
        </div>
      </td>
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-indigo-400">{ownerAvatar}</span>
          </div>
          <span className="text-sm text-slate-300 truncate max-w-[160px]">{ownerName}</span>
        </div>
      </td>
      <td className="py-3.5 px-4">
        <ProgressBar percentage={task.progressPercentage} status={task.status} />
      </td>
      <td className="py-3.5 px-4 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className={`text-sm ${isOverdue ? 'text-rose-400 font-semibold' : 'text-slate-300'}`}>
            {dueDate ? dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          </span>
        </div>
      </td>
      <td className="py-3.5 px-4 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {task.carryForwardCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-semibold">
              CF×{task.carryForwardCount}
            </span>
          )}
          {task.escalationCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20 font-semibold">
              ESC×{task.escalationCount}
            </span>
          )}
          {task.carryForwardCount === 0 && task.escalationCount === 0 && (
            <span className="text-slate-600">—</span>
          )}
        </div>
      </td>
      <td className="py-3.5 px-4 whitespace-nowrap">
        {task.clickupStatus ? (
          <div className="flex items-center gap-1.5">
            <ClickUpStatusPill status={task.clickupStatus} />
            {task.clickupUrl && (
              <a
                href={task.clickupUrl}
                target="_blank"
                rel="noreferrer"
                className="text-slate-500 hover:text-amber-400 transition-colors"
                title="Open in ClickUp"
              >
                <Zap className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        ) : (
          <span className="text-slate-700 text-xs">—</span>
        )}
      </td>
      <td className="py-3.5 px-4">
        <Link
          to={`/tracker/tasks/${task.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors opacity-0 group-hover:opacity-100"
        >
          View <ExternalLink className="w-3 h-3" />
        </Link>
      </td>
    </tr>
  );
};

// ─── Main Task List ───────────────────────────────────────────
export const TrackerTaskList = ({ embedded = false }) => {
  const { selectedTenant } = useTenant();
  const [searchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState(searchParams.get('filter') === 'critical' ? 'critical' : '');
  const [selectedStatus, setSelectedStatus] = useState(
    searchParams.get('filter') === 'overdue' ? 'overdue'
    : searchParams.get('filter') === 'completed' ? 'completed'
    : ''
  );
  const [selectedCustomer, setSelectedCustomer] = useState(searchParams.get('customer') || '');
  const [sortField, setSortField] = useState('dueDate');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showFilters, setShowFilters] = useState(false);
  const [allTasks, setAllTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllMsg, setSyncAllMsg] = useState('');

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.tracker.list({ page: 1, pageSize: 500 });
      setAllTasks(response?.items || []);
    } catch (error) {
      console.error('Unable to load tracker tasks', error);
      setAllTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id]);

  // Pulls live status for every task in the current tenant from ClickUp,
  // then reloads the list so the table reflects whatever came back —
  // instead of waiting up to 30 minutes for the next scheduled sweep.
  const handleSyncAll = async () => {
    setSyncingAll(true);
    setSyncAllMsg('');
    try {
      const result = await api.ai.syncClickUpAll();
      await loadTasks();
      setSyncAllMsg(`Synced ${result.synced}/${result.total} tasks.`);
    } catch (err) {
      setSyncAllMsg(err?.response?.data?.error || 'Sync failed — try again shortly.');
    } finally {
      setSyncingAll(false);
      setTimeout(() => setSyncAllMsg(''), 5000);
    }
  };

  const customers = useMemo(() => [...new Set(allTasks.map((t) => t.customerName))], [allTasks]);

  const handleSort = useCallback(
    (field) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
      setPage(1);
    },
    [sortField]
  );

  const filtered = useMemo(() => {
    let tasks = [...allTasks];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(q) ||
          (t.sourceFindingId || '').toLowerCase().includes(q) ||
          (t.customerName || '').toLowerCase().includes(q) ||
          (t.primaryOwner?.name || t.ownerName || '').toLowerCase().includes(q) ||
          (t.category || '').toLowerCase().includes(q)
      );
    }

    if (selectedSeverity) tasks = tasks.filter((t) => t.severity === selectedSeverity);
    if (selectedStatus) tasks = tasks.filter((t) => t.status === selectedStatus);
    if (selectedCustomer) tasks = tasks.filter((t) => t.customerName === selectedCustomer);

    tasks.sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'severity':
          {
            const sOrd = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
            aVal = sOrd[a.severity] ?? 5;
            bVal = sOrd[b.severity] ?? 5;
          }
          break;
        case 'dueDate':
          aVal = new Date(a.dueDate).getTime();
          bVal = new Date(b.dueDate).getTime();
          break;
        case 'progress':
          aVal = a.progressPercentage;
          bVal = b.progressPercentage;
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        default:
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return tasks;
  }, [allTasks, searchQuery, selectedSeverity, selectedStatus, selectedCustomer, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const clearFilter = (filterName) => {
    if (filterName === 'severity') setSelectedSeverity('');
    if (filterName === 'status') setSelectedStatus('');
    if (filterName === 'customer') setSelectedCustomer('');
    setPage(1);
  };

  const activeFilters = [
    selectedSeverity && { key: 'severity', label: `Severity: ${selectedSeverity}` },
    selectedStatus && { key: 'status', label: `Status: ${selectedStatus.replace('_', ' ')}` },
    selectedCustomer && { key: 'customer', label: `Customer: ${selectedCustomer}` },
  ].filter(Boolean);

  return (
    <div className="space-y-5 animate-slide-up">
      {!embedded && (
        <>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tracker Scope</p>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                {selectedTenant?.name || 'All Assigned Tenants'}
              </h1>
            </div>
            <TenantSelector />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Task List</h1>
              <p className="text-slate-400 text-sm mt-1">
                {loading ? 'Loading tasks...' : `${filtered.length} ${filtered.length === 1 ? 'task' : 'tasks'} found`}
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Search & Filter Bar ── */}
      <div className="glass-panel p-4 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by title, finding ID, customer, owner..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-800/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-all"
            />
          </div>
          <button
            onClick={() => setShowFilters((p) => !p)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
              showFilters || activeFilters.length > 0
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400'
                : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeFilters.length > 0 && (
              <span className="bg-indigo-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {activeFilters.length}
              </span>
            )}
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncingAll}
            title="Pull the latest status for every task from ClickUp"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600 disabled:opacity-50 transition-all shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${syncingAll ? 'animate-spin' : ''}`} />
            Sync ClickUp
          </button>
        </div>
        {syncAllMsg && (
          <p className={`text-xs font-medium ${syncAllMsg.includes('failed') ? 'text-rose-400' : 'text-emerald-400'}`}>
            {syncAllMsg}
          </p>
        )}

        {/* Expanded Filters */}
        {showFilters && (
          <div className="pt-3 border-t border-slate-800/60 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Severity */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Severity</label>
              <div className="relative">
                <select
                  value={selectedSeverity}
                  onChange={(e) => { setSelectedSeverity(e.target.value); setPage(1); }}
                  className="w-full appearance-none bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60 pr-8"
                >
                  <option value="">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</label>
              <div className="relative">
                <select
                  value={selectedStatus}
                  onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
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

            {/* Customer */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</label>
              <div className="relative">
                <select
                  value={selectedCustomer}
                  onChange={(e) => { setSelectedCustomer(e.target.value); setPage(1); }}
                  className="w-full appearance-none bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/60 pr-8"
                >
                  <option value="">All Customers</option>
                  {customers.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              </div>
            </div>
          </div>
        )}

        {/* Active Filter Chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs text-slate-500">Active:</span>
            {activeFilters.map(({ key, label }) => (
              <FilterChip key={key} label={label} onRemove={() => clearFilter(key)} />
            ))}
            <button
              onClick={() => { setSelectedSeverity(''); setSelectedStatus(''); setSelectedCustomer(''); setPage(1); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-900/50">
                <th className="text-left py-3 px-4">
                  <SortableHeader label="Task" field="title" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-left py-3 px-4">
                  <SortableHeader label="Severity" field="severity" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-left py-3 px-4">
                  <SortableHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-left py-3 px-4">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Customer</span>
                </th>
                <th className="text-left py-3 px-4">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Owner</span>
                </th>
                <th className="text-left py-3 px-4">
                  <SortableHeader label="Progress" field="progress" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-left py-3 px-4">
                  <SortableHeader label="Due Date" field="dueDate" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="text-left py-3 px-4">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Flags</span>
                </th>
                <th className="text-left py-3 px-4">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <Zap className="w-3 h-3 text-amber-400" />
                    ClickUp
                  </span>
                </th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-500 text-sm">
                    No tasks match your current filters.
                  </td>
                </tr>
              ) : (
                paginated.map((task) => <TaskRow key={task.id} task={task} />)
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-800/80 bg-slate-900/30">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 px-2 py-1 focus:outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-slate-500">
              {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pg = i + 1;
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${
                    page === pg
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {pg}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackerTaskList;
