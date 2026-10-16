import React from 'react';
import { createPortal } from 'react-dom';
import {
  X, TrendingUp, Calendar, AlertTriangle, Search, ListChecks, CheckCircle2,
  Sparkles, RotateCcw, Clock, CalendarClock, CalendarCheck, CalendarX,
} from 'lucide-react';

const MAX_ITEMS_SHOWN = 6;

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const KPIDetailsModal = ({ isOpen, onClose, kpiType, data, aiStats, meetingStats }) => {
  if (!isOpen) return null;

  const summary   = data?.tenantSummary || {};
  const meetings  = data?.meetings || [];
  const taskList  = data?.taskList || [];
  const now       = new Date();

  const getKPIContent = () => {
    switch (kpiType) {

      // ── Bottom KPI row (pre-existing) ──────────────────────────────────
      case 'avgProgress': {
        const ts = summary.taskStatusCounts || {};
        return {
          title: 'Average Progress',
          icon: TrendingUp,
          color: 'indigo',
          value: `${summary.averageProgress ?? 0}%`,
          details: [
            { label: 'Total Tasks',   value: summary.totalTasks || 0 },
            { label: 'Completed',     value: summary.completedTasks || 0 },
            { label: 'Open',          value: summary.openTasks || 0 },
            { label: 'Escalated',     value: ts.escalated || 0 },
          ],
          description: 'Average remediation progress across every tracked task for this tenant — a quick read on overall review health.',
          items: taskList.map((t) => ({
            primary: t.title || 'Untitled task',
            secondary: `${t.remediationStatus || 'unknown'} · ${t.ownerName || 'Unassigned'}`,
          })),
        };
      }

      case 'meetings': {
        const active = meetings.filter((m) => ['scheduled', 'approval_pending', 'approved'].includes(m.status));
        const byStatus = active.reduce((acc, m) => {
          acc[m.status] = (acc[m.status] || 0) + 1;
          return acc;
        }, {});
        return {
          title: 'Active Meetings',
          icon: Calendar,
          color: 'sky',
          value: data?.activeMeetings ?? 0,
          details: [
            { label: 'Scheduled',         value: byStatus.scheduled || 0 },
            { label: 'Approval Pending',  value: byStatus.approval_pending || 0 },
            { label: 'Approved',          value: byStatus.approved || 0 },
            { label: 'Total Tracked',     value: meetings.length },
          ],
          description: 'Monthly review meetings currently scheduled, awaiting approval, or approved for this tenant.',
          items: active.map((m) => ({
            primary: m.title || 'Untitled meeting',
            secondary: `${fmtDate(m.scheduledStart)} · ${m.status}`,
          })),
        };
      }

      case 'upcoming': {
        const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const upcoming = meetings.filter((m) => new Date(m.scheduledStart) > now);
        const thisWeek = upcoming.filter((m) => new Date(m.scheduledStart) <= weekAhead);
        return {
          title: 'Upcoming Meetings',
          icon: Calendar,
          color: 'emerald',
          value: data?.upcomingMeetings ?? 0,
          details: [
            { label: 'Next 7 Days', value: thisWeek.length },
            { label: 'Total Upcoming', value: upcoming.length },
          ],
          description: 'Monthly review meetings scheduled ahead, across all statuses.',
          items: upcoming.map((m) => ({
            primary: m.title || 'Untitled meeting',
            secondary: `${fmtDate(m.scheduledStart)} · ${m.status}`,
          })),
        };
      }

      case 'findings': {
        const sev = data?.findingsSeverityCounts || { critical: 0, high: 0, medium: 0, low: 0 };
        return {
          title: 'Open Findings',
          icon: Search,
          color: 'amber',
          value: data?.openFindings ?? 0,
          details: [
            { label: 'Critical', value: sev.critical },
            { label: 'High',     value: sev.high },
            { label: 'Medium',   value: sev.medium },
            { label: 'Low',      value: sev.low },
          ],
          description: 'Security findings awaiting remediation or approval — counted as open unless severity is Low. Showing the most recent findings on file.',
          items: (data?.recentFindings || []).map((f) => ({
            primary: f.title || f.category || 'Untitled finding',
            secondary: `${f.severity || 'unknown'} · ${f.category || 'uncategorized'}`,
          })),
        };
      }

      case 'tasks': {
        const ts = summary.taskStatusCounts || {};
        const escalated = taskList.filter((t) => (t.escalationCount || 0) > 0);
        return {
          title: 'Escalated Tasks',
          icon: AlertTriangle,
          color: 'rose',
          value: summary.escalatedTasks ?? 0,
          details: [
            { label: 'Overdue',             value: ts.overdue || 0 },
            { label: 'Awaiting Approval',   value: ts.awaiting_validation || 0 },
            { label: 'In Progress',         value: ts.in_progress || 0 },
            { label: 'Completed',           value: ts.completed || 0 },
          ],
          description: 'Remediation tasks that have been escalated and require immediate attention.',
          items: escalated.map((t) => ({
            primary: t.title || 'Untitled task',
            secondary: `${t.ownerName || 'Unassigned'} · Due ${fmtDate(t.dueDate)}`,
          })),
        };
      }

      // ── Top summary rows (newly wired) ─────────────────────────────────
      case 'openTasks': {
        const ts = summary.taskStatusCounts || {};
        const open = taskList.filter((t) => t.remediationStatus === 'open' || t.remediationStatus === 'in_progress' || t.approvalStatus === 'pending');
        return {
          title: 'Open Tasks',
          icon: ListChecks,
          color: 'indigo',
          value: summary.openTasks ?? 0,
          details: [
            { label: 'Open',                value: ts.open || 0 },
            { label: 'In Progress',         value: ts.in_progress || 0 },
            { label: 'Awaiting Approval',   value: ts.awaiting_validation || 0 },
          ],
          description: 'Tasks not yet marked complete for this tenant, across all remediation stages.',
          items: open.map((t) => ({
            primary: t.title || 'Untitled task',
            secondary: `${t.ownerName || 'Unassigned'} · Due ${fmtDate(t.dueDate)}`,
          })),
        };
      }

      case 'closedTasks': {
        const closed = taskList.filter((t) => t.remediationStatus === 'closed');
        return {
          title: 'Closed Tasks',
          icon: CheckCircle2,
          color: 'emerald',
          value: summary.completedTasks ?? 0,
          details: [
            { label: 'Total Tasks',      value: summary.totalTasks || 0 },
            { label: 'Closed',           value: summary.completedTasks || 0 },
            { label: 'Avg. Progress',    value: `${summary.averageProgress ?? 0}%` },
          ],
          description: 'Tasks marked complete for this tenant across all tracked meetings.',
          items: closed.map((t) => ({
            primary: t.title || 'Untitled task',
            secondary: `${t.ownerName || 'Unassigned'} · ${t.customerName || ''}`,
          })),
        };
      }

      case 'escalations': {
        const ts = summary.taskStatusCounts || {};
        const escalated = taskList.filter((t) => (t.escalationCount || 0) > 0);
        return {
          title: 'Escalations',
          icon: AlertTriangle,
          color: 'rose',
          value: summary.escalatedTasks ?? 0,
          details: [
            { label: 'Escalated', value: ts.escalated || 0 },
            { label: 'Overdue',   value: ts.overdue || 0 },
          ],
          description: 'Tasks with at least one escalation event recorded in their timeline.',
          items: escalated.map((t) => ({
            primary: t.title || 'Untitled task',
            secondary: `${t.escalationCount}× escalated · ${t.ownerName || 'Unassigned'}`,
          })),
        };
      }

      case 'pendingAI': {
        const items = aiStats?.pendingItems || [];
        return {
          title: 'Pending AI Tasks',
          icon: Sparkles,
          color: 'violet',
          value: aiStats?.pending ?? 0,
          details: [
            { label: 'Awaiting AM Approval', value: aiStats?.pending ?? 0 },
          ],
          description: 'AI-generated task recommendations from meeting analysis, not yet reviewed by an Account Manager.',
          items: items.map((r) => ({
            primary: r.title || 'Untitled recommendation',
            secondary: `${r.owner_name || r.ownerName || 'Unassigned'} · Due ${fmtDate(r.due_date || r.dueDate)}`,
          })),
        };
      }

      case 'carryForward': {
        const carried = taskList.filter((t) => (t.carryForwardCount || 0) > 0);
        return {
          title: 'Carry Forward Tasks',
          icon: RotateCcw,
          color: 'amber',
          value: summary.totalCarryForwards ?? 0,
          details: [
            { label: 'Total Carry-Forwards', value: summary.totalCarryForwards ?? 0 },
          ],
          description: 'Tasks unresolved at meeting close, rolled forward into the next review cycle.',
          items: carried.map((t) => ({
            primary: t.title || 'Untitled task',
            secondary: `Carried ${t.carryForwardCount}× · ${t.ownerName || 'Unassigned'}`,
          })),
        };
      }

      case 'overdueTasks': {
        const ts = summary.taskStatusCounts || {};
        const overdue = taskList.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.remediationStatus !== 'closed');
        return {
          title: 'Overdue Tasks',
          icon: Clock,
          color: 'amber',
          value: ts.overdue || 0,
          details: [
            { label: 'Overdue',   value: ts.overdue || 0 },
            { label: 'Escalated', value: ts.escalated || 0 },
          ],
          description: 'Tasks past their due date that have not been marked complete.',
          items: overdue.map((t) => ({
            primary: t.title || 'Untitled task',
            secondary: `${t.ownerName || 'Unassigned'} · Was due ${fmtDate(t.dueDate)}`,
          })),
        };
      }

      case 'upcomingReview': {
        const upcoming = meetings.filter((m) => new Date(m.scheduledStart) > now && ['scheduled', 'approval_pending'].includes(m.status));
        return {
          title: 'Upcoming Meetings',
          icon: CalendarClock,
          color: 'indigo',
          value: meetingStats?.upcoming ?? 0,
          details: [
            { label: 'Scheduled / Pending Review', value: meetingStats?.upcoming ?? 0 },
          ],
          description: 'This tenant’s meetings scheduled ahead, awaiting approval or confirmation.',
          items: upcoming.map((m) => ({
            primary: m.title || 'Untitled meeting',
            secondary: `${fmtDate(m.scheduledStart)} · ${m.status}`,
          })),
        };
      }

      case 'completedThisMonth': {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const completed = meetings.filter((m) => ['conducted', 'closed'].includes(m.status) && new Date(m.scheduledStart) >= monthStart);
        return {
          title: 'Completed This Month',
          icon: CalendarCheck,
          color: 'emerald',
          value: meetingStats?.completedThisMonth ?? 0,
          details: [
            { label: 'Conducted or Closed', value: meetingStats?.completedThisMonth ?? 0 },
          ],
          description: 'Meetings conducted or closed for this tenant since the start of the current calendar month.',
          items: completed.map((m) => ({
            primary: m.title || 'Untitled meeting',
            secondary: `${fmtDate(m.scheduledStart)} · ${m.status}`,
          })),
        };
      }

      case 'rescheduledMeetings': {
        const rescheduled = meetings.filter((m) => m.rescheduleRequest || m.status === 'reschedule_requested');
        return {
          title: 'Rescheduled Meetings',
          icon: CalendarX,
          color: 'fuchsia',
          value: meetingStats?.rescheduled ?? 0,
          details: [
            { label: 'With Reschedule History', value: meetingStats?.rescheduled ?? 0 },
          ],
          description: 'Meetings that have been rescheduled at least once, or currently have a pending reschedule request.',
          items: rescheduled.map((m) => ({
            primary: m.title || 'Untitled meeting',
            secondary: `${fmtDate(m.scheduledStart)} · ${m.status}`,
          })),
        };
      }

      default:
        return null;
    }
  };

  const content = getKPIContent();
  if (!content) return null;

  const IconComponent = content.icon;
  const colorClasses = {
    indigo:  'from-indigo-600 to-indigo-700',
    sky:     'from-sky-600 to-blue-700',
    emerald: 'from-emerald-600 to-green-700',
    amber:   'from-amber-600 to-orange-700',
    rose:    'from-rose-600 to-red-700',
    violet:  'from-violet-600 to-purple-700',
    fuchsia: 'from-fuchsia-600 to-pink-700',
  };

  const items = content.items || [];
  const shownItems = items.slice(0, MAX_ITEMS_SHOWN);
  const extraCount = items.length - shownItems.length;

  // Rendered via a portal straight into document.body — Layout.jsx wraps every
  // page in an animated wrapper div (`animate-slide-up`, a transform-based
  // animation). Any ancestor with a CSS transform becomes the containing
  // block for `position: fixed` descendants, so without a portal this modal
  // would be fixed relative to that wrapper's box instead of the real
  // viewport — which is what caused it to render oversized and pushed off
  // the bottom of the screen instead of centered.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Light backdrop — dims and blocks the page underneath (nothing behind
          it is clickable, and clicking it closes the modal) without fully
          obscuring the sidebar/menu, so the rest of the app stays visible. */}
      <div className="absolute inset-0 bg-[#1A1814]/35 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative flex w-full max-w-lg sm:max-w-xl flex-col max-h-[85vh] rounded-[24px] border border-[#D8D2C4] bg-[#FDFAF5] shadow-2xl shadow-black/20 overflow-hidden animate-slide-up">

        {/* Header with gradient background — these are real, non-remapped
            Tailwind colors (sky/emerald/amber/rose/violet/fuchsia), so white
            text here has correct contrast, unlike the body below. */}
        <div className={`shrink-0 bg-gradient-to-r ${colorClasses[content.color]} p-5 sm:p-6`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="rounded-xl bg-white/10 p-3 backdrop-blur-sm shrink-0">
                <IconComponent className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">KPI Details</p>
                <h2 className="text-xl sm:text-2xl font-bold text-white truncate">{content.title}</h2>
              </div>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20 backdrop-blur-sm"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable content — this app's tailwind.config.js remaps `slate`
            to its own light-cream brand scale and sets no darkMode option, so
            `bg-slate-900` + `text-white` here previously rendered as
            near-invisible white-on-near-white. Rebuilt on the app's real,
            literal cream tokens (matching Sidebar.jsx's own convention). */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">

          {/* Main Value */}
          <div className="rounded-[16px] border border-[#E4DFCF] bg-[#F5F1E8] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6B6358] mb-2">Current Value</p>
            <span className="text-4xl font-bold text-[#1A1814]">{content.value}</span>
          </div>

          {/* Description */}
          <div className="rounded-[16px] border border-[#E4DFCF] bg-[#F5F1E8] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6B6358] mb-2">Overview</p>
            <p className="text-sm leading-relaxed text-[#4A4239]">{content.description}</p>
          </div>

          {/* Details Grid */}
          {content.details?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6B6358] mb-3">Breakdown</p>
              <div className="grid grid-cols-2 gap-3">
                {content.details.map((detail, index) => (
                  <div key={index} className="rounded-[14px] border border-[#E4DFCF] bg-[#F5F1E8] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#A89E90] mb-2">{detail.label}</p>
                    <p className="text-xl font-bold text-[#1A1814]">{detail.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Real matching records — the actual items behind the count above */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6B6358] mb-3">
              {items.length > 0 ? `Matching Records (${items.length})` : 'Matching Records'}
            </p>
            {shownItems.length > 0 ? (
              <div className="space-y-2">
                {shownItems.map((item, index) => (
                  <div key={index} className="rounded-[12px] border border-[#E4DFCF] bg-[#F5F1E8] px-4 py-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[#1A1814] truncate">{item.primary}</p>
                    <p className="text-xs text-[#A89E90] shrink-0 text-right">{item.secondary}</p>
                  </div>
                ))}
                {extraCount > 0 && (
                  <p className="text-xs text-[#A89E90] text-center pt-1">+{extraCount} more not shown</p>
                )}
              </div>
            ) : (
              <div className="rounded-[12px] border border-[#E4DFCF] bg-[#F5F1E8] px-4 py-6 text-center text-sm text-[#A89E90]">
                No matching records right now.
              </div>
            )}
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
};
