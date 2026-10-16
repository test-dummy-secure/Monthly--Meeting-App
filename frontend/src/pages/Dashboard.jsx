// src/pages/Dashboard.jsx
import React, { useState, useEffect } from "react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useTenant } from "../context/TenantContext";
import KPICard from "../components/widgets/KPICard";
import { KPIDetailsModal } from "../components/KPIDetailsModal";
import TaskStatusDonut from "../components/dashboard/TaskStatusDonut";
import CriticalAttention from "../components/dashboard/CriticalAttention";
import SkeletonLoader from "../components/SkeletonLoader";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";
import { TenantSelector } from "../components/TenantSelector";
import { api } from "../services/api";
import { Sparkles, Clock, RotateCcw, CalendarCheck, CalendarClock, CalendarX, TrendingUp, Video, Calendar, Search, AlertTriangle } from "lucide-react";

const Dashboard = () => {
  const { selectedTenant, tenantId } = useTenant();
  const {
    data,
    isLoading,
    isError,
    error,
  } = useDashboardData();

  const [selectedKPI, setSelectedKPI] = useState(null);
  const [showKPIModal, setShowKPIModal] = useState(false);

  const [aiStats,      setAiStats]      = useState({ pending: 0, carryForward: 0, pendingItems: [] });
  const [meetingStats, setMeetingStats] = useState({ upcoming: 0, completedThisMonth: 0, rescheduled: 0 });

  useEffect(() => {
    if (!tenantId) { setAiStats({ pending: 0, carryForward: 0, pendingItems: [] }); return; }
    let active = true;
    (async () => {
      try {
        const result = await api.ai.listRecommendations({ tenantId, status: 'pending' });
        if (active) setAiStats((prev) => ({ ...prev, pending: result.count || 0, pendingItems: result.recommendations || [] }));
      } catch { /* non-fatal */ }
    })();
    return () => { active = false; };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) { setMeetingStats({ upcoming: 0, completedThisMonth: 0, rescheduled: 0 }); return; }
    let active = true;
    (async () => {
      try {
        const list = await api.meetings.list();
        const tenantMeetings = list.filter((m) => m.tenantId === tenantId);
        const now   = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const upcoming          = tenantMeetings.filter((m) => new Date(m.scheduledStart) > now && ['scheduled', 'approval_pending'].includes(m.status)).length;
        const completedThisMonth = tenantMeetings.filter((m) => ['conducted', 'closed'].includes(m.status) && new Date(m.scheduledStart) >= monthStart).length;
        const rescheduled       = tenantMeetings.filter((m) => (m.rescheduleCount || 0) > 0 || m.status === 'reschedule_requested').length;
        if (active) setMeetingStats({ upcoming, completedThisMonth, rescheduled });
      } catch { /* non-fatal */ }
    })();
    return () => { active = false; };
  }, [tenantId]);

  const handleKPIClick = (kpiType) => {
    setSelectedKPI(kpiType);
    setShowKPIModal(true);
  };

  if (isLoading) return <SkeletonLoader />;
  if (isError) return <ErrorState error={error} />;
  if (!data) return <EmptyState message="No dashboard data available" />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tenant Overview</p>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {selectedTenant?.name || 'All Available Tenants'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Tenant-scoped dashboard, tracker, report, and meeting intelligence
          </p>
        </div>
        <TenantSelector />
      </div>

      {data.tenantSummary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass-panel p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Tenant</p>
            <p className="mt-1 text-sm font-semibold text-white">{selectedTenant?.name || 'Global View'}</p>
          </div>
          <button
            type="button"
            onClick={() => handleKPIClick('openTasks')}
            className="glass-panel p-4 text-left transition hover:ring-1 hover:ring-indigo-400/40"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Open Tasks</p>
            <p className="mt-1 text-2xl font-extrabold text-indigo-400">{data.tenantSummary.openTasks}</p>
          </button>
          <button
            type="button"
            onClick={() => handleKPIClick('closedTasks')}
            className="glass-panel p-4 text-left transition hover:ring-1 hover:ring-emerald-400/40"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Closed Tasks</p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-400">{data.tenantSummary.completedTasks}</p>
          </button>
          <button
            type="button"
            onClick={() => handleKPIClick('escalations')}
            className="glass-panel p-4 text-left transition hover:ring-1 hover:ring-rose-400/40"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Escalations</p>
            <p className="mt-1 text-2xl font-extrabold text-rose-400">{data.tenantSummary.escalatedTasks}</p>
          </button>
        </div>
      )}

      {/* AI + Carry Forward summary row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => handleKPIClick('pendingAI')}
          className="glass-panel p-4 flex items-center gap-4 text-left transition hover:ring-1 hover:ring-violet-400/40"
        >
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Pending AI Tasks</p>
            <p className="mt-0.5 text-2xl font-extrabold text-violet-400">{aiStats.pending}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Awaiting AM approval</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleKPIClick('carryForward')}
          className="glass-panel p-4 flex items-center gap-4 text-left transition hover:ring-1 hover:ring-orange-400/40"
        >
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/20 flex items-center justify-center shrink-0">
            <RotateCcw className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Carry Forward Tasks</p>
            <p className="mt-0.5 text-2xl font-extrabold text-orange-400">
              {data.tenantSummary?.totalCarryForwards || 0}
            </p>
            <p className="text-[10px] text-slate-600 mt-0.5">Unresolved across meetings</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleKPIClick('overdueTasks')}
          className="glass-panel p-4 flex items-center gap-4 text-left transition hover:ring-1 hover:ring-amber-400/40"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Overdue Tasks</p>
            <p className="mt-0.5 text-2xl font-extrabold text-amber-400">
              {data.tenantSummary?.taskStatusCounts?.overdue || 0}
            </p>
            <p className="text-[10px] text-slate-600 mt-0.5">Past due date</p>
          </div>
        </button>
      </div>

      {/* Meeting stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => handleKPIClick('upcomingReview')}
          className="glass-panel p-4 flex items-center gap-4 text-left transition hover:ring-1 hover:ring-indigo-400/40"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center shrink-0">
            <CalendarClock className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Upcoming Meetings</p>
            <p className="mt-0.5 text-2xl font-extrabold text-indigo-400">{meetingStats.upcoming}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Scheduled or pending review</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleKPIClick('completedThisMonth')}
          className="glass-panel p-4 flex items-center gap-4 text-left transition hover:ring-1 hover:ring-emerald-400/40"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <CalendarCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Completed This Month</p>
            <p className="mt-0.5 text-2xl font-extrabold text-emerald-400">{meetingStats.completedThisMonth}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Conducted or closed</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleKPIClick('rescheduledMeetings')}
          className="glass-panel p-4 flex items-center gap-4 text-left transition hover:ring-1 hover:ring-fuchsia-400/40"
        >
          <div className="w-10 h-10 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/20 flex items-center justify-center shrink-0">
            <CalendarX className="w-5 h-5 text-fuchsia-400" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Rescheduled</p>
            <p className="mt-0.5 text-2xl font-extrabold text-fuchsia-400">{meetingStats.rescheduled}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Meetings with reschedule history</p>
          </div>
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard
          title="Average Progress"
          value={`${data.tenantSummary?.averageProgress ?? 0}%`}
          icon={<div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/20 flex items-center justify-center shrink-0"><TrendingUp className="w-5 h-5 text-teal-400" /></div>}
          onClick={() => handleKPIClick('avgProgress')}
        />
        <KPICard
          title="Active Meetings"
          value={data.activeMeetings}
          icon={<div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0"><Video className="w-5 h-5 text-emerald-400" /></div>}
          onClick={() => handleKPIClick('meetings')}
        />
        <KPICard
          title="Upcoming Meetings"
          value={data.upcomingMeetings}
          icon={<div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/20 flex items-center justify-center shrink-0"><Calendar className="w-5 h-5 text-sky-400" /></div>}
          onClick={() => handleKPIClick('upcoming')}
        />
        <KPICard
          title="Open Findings"
          value={data.openFindings}
          icon={<div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0"><Search className="w-5 h-5 text-violet-400" /></div>}
          onClick={() => handleKPIClick('findings')}
        />
        <KPICard
          title="Escalated Tasks"
          value={data.escalatedTasks}
          icon={<div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/20 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5 text-rose-400" /></div>}
          onClick={() => handleKPIClick('tasks')}
        />
      </div>

      {/* Replaces the old activity feed + always-on findings table. Findings
          now only surface on click, via the Open Findings KPI card's modal
          (real severity breakdown, not a raw list sitting on the page by
          default). Two graphs: a donut for the real, mutually-exclusive
          status distribution, and a focused "needs attention" panel for the
          handful of independent/overlapping risk signals a manager actually
          scans for first. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TaskStatusDonut remediationStatusCounts={data.remediationStatusCounts} taskList={data.taskList} />
        <CriticalAttention
          taskStatusCounts={data.tenantSummary?.taskStatusCounts}
          findingsSeverityCounts={data.findingsSeverityCounts}
        />
      </div>

      {/* KPI Details Modal */}
      <KPIDetailsModal
        isOpen={showKPIModal}
        onClose={() => setShowKPIModal(false)}
        kpiType={selectedKPI}
        data={data}
        aiStats={aiStats}
        meetingStats={meetingStats}
      />
    </div>
  );
};

export default Dashboard;
