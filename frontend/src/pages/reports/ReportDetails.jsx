import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { REVIEW_OUTCOMES } from '../../services/trackerMockData';
import { StatusBadge, SeverityBadge } from '../../components/tracker/TrackerBadges';
import {
  ArrowLeft,
  ChevronRight,
  Hash,
  FileText,
  Building2,
  Calendar,
  Layers,
  Users,
  Clock,
  Download,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Info,
  TrendingUp,
  BarChart3,
} from 'lucide-react';

const MetricBlock = ({ label, value, sub, colorClass, bgClass }) => (
  <div className="bg-slate-900/30 border border-slate-805 rounded-xl p-4 flex flex-col justify-between min-h-[90px]">
    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
    <div className="flex items-baseline gap-1 mt-1">
      <span className={`text-2xl font-extrabold ${colorClass || 'text-white'}`}>{value}</span>
      {sub && <span className="text-[10px] text-slate-500 font-medium">{sub}</span>}
    </div>
  </div>
);

// ─── InfoItem helper ─────────────────────────────────────────
const InfoItem = ({ icon: Icon, label, value, mono = false }) => (
  <div className="flex items-start gap-3 py-2.5 border-b border-slate-800/40 last:border-0">
    <Icon className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-28 shrink-0">{label}</span>
    <span className={`text-xs flex-1 text-slate-300 ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
  </div>
);

const normalizeReport = (raw) => {
  // Prefer live tasks returned by GET /:reportId over the generation-time snapshot
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : (raw.exportPayload?.tasks || []);

  const taskList = rawTasks.map(t => ({
    id:            t.id,
    title:         t.title,
    severity:      t.severity || 'low',
    status:        t.remediationStatus || t.approvalStatus || 'open',
    reviewOutcome: t.reviewOutcome || null,
    progress:      t.progressPercentage || 0,
    owner:         t.ownerName || t.primaryOwner?.name || null,
  }));
  return {
    ...raw,
    description:     raw.summary || '',
    taskList,
    overdueTasksCount:      raw.overdueTasksCount      ?? 0,
    upcomingMeetingDate:    raw.upcomingMeetingDate     ?? null,
    ownership:              raw.ownership               ?? raw.generatedBy ?? '',
    meetingTimeline:        raw.meetingTimeline         ?? (raw.exportPayload?.meeting?.title ?? ''),
    reviewOutcomeBreakdown: raw.reviewOutcomeBreakdown  ?? null,
    taskStatusBreakdown:    raw.taskStatusBreakdown     ?? null,
    taskOwnershipBreakdown: raw.taskOwnershipBreakdown  ?? null,
  };
};

export const ReportDetails = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const [report, setReport]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [notFound, setNotFound]   = useState(false);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const raw = await api.reports.getById(reportId);
        if (active) {
          if (!raw) { setNotFound(true); return; }
          setReport(normalizeReport(raw));
        }
      } catch (err) {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [reportId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 animate-slide-up font-sans">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-3" />
        <span>Loading report...</span>
      </div>
    );
  }

  if (notFound || !report) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500 animate-slide-up font-sans">
        <AlertTriangle className="w-10 h-10 mb-3 text-amber-500" />
        <p className="text-lg font-semibold text-slate-300">Report document not found</p>
        <Link to="/reports" className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm font-semibold">
          ← Back to Reports
        </Link>
      </div>
    );
  }

  const handleDownload = (format) => {
    if (downloading) return;
    setDownloading(format);

    setTimeout(() => {
      const slug = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '_');

      if (format === 'pdf') {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const lm = 14;
        const pageW = 210;
        const contentW = pageW - lm * 2;
        let y = 20;

        const line = (text, fontSize = 11, bold = false, color = [30, 30, 30]) => {
          doc.setFontSize(fontSize);
          doc.setFont('helvetica', bold ? 'bold' : 'normal');
          doc.setTextColor(...color);
          const lines = doc.splitTextToSize(String(text ?? ''), contentW);
          doc.text(lines, lm, y);
          y += lines.length * (fontSize * 0.45) + 2;
        };

        const hRule = () => {
          doc.setDrawColor(180, 180, 180);
          doc.line(lm, y, pageW - lm, y);
          y += 4;
        };

        // Header
        line('NxgSecure — Security Compliance Report', 16, true, [184, 135, 42]);
        y += 2;
        hRule();

        line(report.title, 13, true);
        y += 1;
        line(`Customer: ${report.customerName || '—'}`, 10);
        line(`Report Type: ${isWk ? 'Weekly Progress' : 'Monthly Meeting Summary'}`, 10);
        line(`Meeting ID: ${report.meetingId || '—'}`, 10);
        line(`Generated By: ${report.generatedBy || report.ownership || '—'}`, 10);
        line(`Generated At: ${report.generatedAt ? new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}`, 10);
        if (isWk && report.weekNumber) {
          line(`Week: Week ${report.weekNumber}`, 10);
          if (report.reportPeriodStart && report.reportPeriodEnd) {
            line(`Period: ${new Date(report.reportPeriodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(report.reportPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 10);
          }
        }
        y += 3;
        hRule();

        // Metrics
        line('Key Metrics', 12, true);
        y += 1;
        const metrics = [
          ['Progress', `${report.progressPercentage ?? 0}%`],
          ['Open Tasks', report.openTasksCount ?? 0],
          ['Closed Tasks', report.closedTasksCount ?? 0],
          ['Overdue Tasks', report.overdueTasksCount ?? 0],
          ['Escalated Tasks', report.escalatedTasksCount ?? 0],
          ['Carry-Forward Tasks', report.carryForwardTasksCount ?? 0],
          ['Blocked Tasks', report.blockedTasksCount ?? 0],
        ];
        metrics.forEach(([label, val]) => {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(80, 80, 80);
          doc.text(`${label}:`, lm, y);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(30, 30, 30);
          doc.text(String(val), lm + 52, y);
          y += 6;
        });
        y += 2;
        hRule();

        // Summary
        if (report.description) {
          line('Executive Summary', 12, true);
          y += 1;
          line(report.description, 10);
          y += 3;
          hRule();
        }

        // Task List
        if (report.taskList?.length > 0) {
          line('Scope Checklist', 12, true);
          y += 2;
          report.taskList.forEach((t, i) => {
            if (y > 265) { doc.addPage(); y = 20; }
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(30, 30, 30);
            const taskLines = doc.splitTextToSize(`${i + 1}. ${t.title || 'Untitled Task'}`, contentW - 10);
            doc.text(taskLines, lm, y);
            y += taskLines.length * 4.5 + 1;
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 100, 100);
            doc.setFontSize(9);
            doc.text(`Status: ${t.status || '—'}  |  Severity: ${t.severity || '—'}  |  Progress: ${t.progress ?? 0}%  |  Owner: ${t.owner || '—'}`, lm + 4, y);
            y += 6;
          });
        }

        // Footer
        const totalPages = doc.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
          doc.setPage(p);
          doc.setFontSize(8);
          doc.setTextColor(160, 160, 160);
          doc.text(`NxgSecure  |  ${report.customerName || ''}  |  Page ${p} of ${totalPages}`, lm, 290);
        }

        doc.save(`${slug}_${reportId}.pdf`);

      } else {
        // Excel / CSV export
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [
          ['Report Title', 'Customer', 'Type', 'Meeting ID', 'Progress %', 'Open', 'Closed', 'Overdue', 'Escalated', 'Carry-Forward', 'Blocked', 'Generated By', 'Generated At'],
          [
            esc(report.title), esc(report.customerName), esc(isWk ? 'Weekly Progress' : 'Monthly Summary'),
            esc(report.meetingId), report.progressPercentage ?? 0,
            report.openTasksCount ?? 0, report.closedTasksCount ?? 0,
            report.overdueTasksCount ?? 0, report.escalatedTasksCount ?? 0,
            report.carryForwardTasksCount ?? 0, report.blockedTasksCount ?? 0,
            esc(report.generatedBy || report.ownership), esc(report.generatedAt ? new Date(report.generatedAt).toISOString() : ''),
          ],
          [],
          ['#', 'Task Title', 'Status', 'Severity', 'Progress %', 'Owner', 'Review Outcome'],
          ...(report.taskList?.map((t, i) => [
            i + 1, esc(t.title), esc(t.status), esc(t.severity), t.progress ?? 0, esc(t.owner), esc(t.reviewOutcome),
          ]) || []),
        ];
        const csv = rows.map(r => r.join(',')).join('\r\n');
        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv));
        element.setAttribute('download', `${slug}_${reportId}.csv`);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
      }

      setDownloading(null);
    }, 800);
  };

  const isWk = report.reportType === 'weekly_progress';

  return (
    <div className="space-y-5 animate-slide-up font-sans text-xs max-w-6xl">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <Link to="/reports" className="hover:text-slate-350 transition-colors">Reports Engine</Link>
        <ChevronRight className="w-3 h-3" />
        <Link to="/reports/list" className="hover:text-slate-350 transition-colors">Ledger</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-slate-400 font-mono">{report.id}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4 flex-1">
          <button
            onClick={() => navigate('/reports/list')}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all shrink-0 mt-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase ${
                isWk 
                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' 
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}>
                {isWk ? 'Weekly Progress' : 'Monthly Summary'}
              </span>
              <span className="text-[10px] font-mono text-slate-550 bg-slate-805/40 px-2 py-0.5 rounded border border-slate-800/50">
                {report.meetingId}
              </span>
            </div>
            <h1 className="text-xl font-extrabold text-white tracking-tight leading-snug">{report.title}</h1>
            <p className="text-xs text-slate-450 mt-1">{report.customerName} · {report.meetingTimeline}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-10 sm:ml-0 flex-wrap">
          <Link
            to={`/reports/${report.id}/preview`}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 hover:border-slate-550 rounded-lg font-semibold shadow-md transition-all text-xs"
          >
            <Eye className="w-4 h-4" /> Preview Layout
          </Link>
          <button
            onClick={() => handleDownload('pdf')}
            disabled={!!downloading}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-550 text-white rounded-lg font-semibold shadow-md shadow-indigo-950/20 transition-all text-xs disabled:opacity-50"
          >
            {downloading === 'pdf' ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" /> Download PDF
              </>
            )}
          </button>
          <button
            onClick={() => handleDownload('excel')}
            disabled={!!downloading}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 hover:border-slate-550 rounded-lg font-semibold shadow-md transition-all text-xs disabled:opacity-50"
          >
            {downloading === 'excel' ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 text-slate-400" /> Export Excel
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <MetricBlock
          label="Progress Percentage"
          value={`${report.progressPercentage}%`}
          colorClass="text-indigo-400"
        />
        <MetricBlock
          label="Open Tasks"
          value={report.openTasksCount}
          colorClass="text-sky-400"
        />
        <MetricBlock
          label="Closed Tasks"
          value={report.closedTasksCount}
          colorClass="text-emerald-400"
        />
        <MetricBlock
          label="Overdue Tasks"
          value={report.overdueTasksCount}
          colorClass={report.overdueTasksCount > 0 ? 'text-rose-400 font-bold' : 'text-slate-450'}
        />
        <MetricBlock
          label="Escalated Tasks"
          value={report.escalatedTasksCount}
          colorClass={report.escalatedTasksCount > 0 ? 'text-red-400 font-bold' : 'text-slate-450'}
        />
        <MetricBlock
          label="Carry Forwards"
          value={report.carryForwardTasksCount}
          colorClass={report.carryForwardTasksCount > 0 ? 'text-amber-400' : 'text-slate-450'}
        />
      </div>

      {/* Main Details and Document Scope */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Left Column (Document description and task ledger table) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Executive description */}
          <div className="glass-panel p-5 space-y-3">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-indigo-400" /> Executive Description
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed font-normal">{report.description}</p>
          </div>

          {/* Tasks ledger in this report */}
          <div className="glass-panel p-5 space-y-4">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Scope Checklist ({report.taskList.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800/60 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-left">
                    <th className="pb-2">Task</th>
                    <th className="pb-2 w-24">Severity</th>
                    <th className="pb-2 w-28">Status</th>
                    <th className="pb-2 w-28">Review</th>
                    <th className="pb-2 w-20">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30">
                  {report.taskList.map((task) => {
                    const rv = REVIEW_OUTCOMES[task.reviewOutcome];
                    return (
                      <tr key={task.id} className="hover:bg-slate-800/10 transition-colors">
                        <td className="py-3 pr-4">
                          <div className="font-semibold text-slate-300 line-clamp-1 max-w-xs text-xs">{task.title}</div>
                          <span className="text-[9px] text-slate-600 font-mono mt-0.5 block">{task.id}</span>
                          {task.owner && <span className="text-[9px] text-slate-500">{task.owner}</span>}
                        </td>
                        <td className="py-3"><SeverityBadge severity={task.severity} size="sm" /></td>
                        <td className="py-3"><StatusBadge status={task.status} size="sm" /></td>
                        <td className="py-3">
                          {rv ? (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${rv.color}`}>
                              {rv.label}
                            </span>
                          ) : <span className="text-slate-600 text-[9px]">—</span>}
                        </td>
                        <td className="py-3 font-bold text-slate-300 text-xs">{task.progress}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Weekly Review Outcome Breakdown */}
          {report.reviewOutcomeBreakdown && (
            <div className="glass-panel p-5 space-y-4">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-sky-400" /> Weekly Review Outcomes
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(report.reviewOutcomeBreakdown).map(([key, count]) => {
                  const meta = REVIEW_OUTCOMES[key];
                  return (
                    <div key={key} className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3 flex items-center gap-3">
                      <span className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase ${meta?.color || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                        {meta?.label || key}
                      </span>
                      <span className="text-xl font-extrabold text-white ml-auto">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task Status Breakdown */}
          {report.taskStatusBreakdown && (
            <div className="glass-panel p-5 space-y-4">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-indigo-400" /> Task Status Breakdown
              </h3>
              <div className="space-y-2">
                {Object.entries(report.taskStatusBreakdown)
                  .filter(([, count]) => count > 0)
                  .map(([status, count]) => {
                    const total = Object.values(report.taskStatusBreakdown).reduce((a, b) => a + b, 0) || 1;
                    const pct = Math.round((count / total) * 100);
                    const barColor = {
                      open: 'bg-slate-500',
                      in_progress: 'bg-blue-500',
                      awaiting_validation: 'bg-amber-500',
                      completed: 'bg-emerald-500',
                      carry_forward: 'bg-orange-500',
                      escalated: 'bg-rose-500',
                      overdue: 'bg-red-600',
                    }[status] || 'bg-slate-500';
                    return (
                      <div key={status} className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400 capitalize">{status.replace(/_/g, ' ')}</span>
                          <span className="text-slate-300 font-semibold">{count} ({pct}%)</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5">
                          <div className={`${barColor} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (Metadata list and Owners details) */}
        <div className="space-y-5">
          {/* Metadata Block */}
          <div className="glass-panel p-5">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-slate-500" /> Document Information
            </h3>
            <div className="space-y-0 text-slate-350">
              <InfoItem icon={Layers} label="Report Type" value={isWk ? 'Weekly Progress Report' : 'Monthly Summary'} />
              <InfoItem icon={Calendar} label="Compiled Date" value={new Date(report.generatedAt).toLocaleString()} />
              <InfoItem icon={Users} label="Compiled By" value={report.generatedBy} />
              <InfoItem
                icon={Calendar}
                label="Next Review"
                value={report.upcomingMeetingDate ? new Date(report.upcomingMeetingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
              />
              <InfoItem icon={Users} label="Ownership Scope" value={report.ownership} />
            </div>
          </div>

          {/* Customer info */}
          <div className="glass-panel p-5">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-indigo-400" /> Customer Context
            </h3>
            <div className="space-y-0">
              <InfoItem icon={Building2} label="Customer Name" value={report.customerName} />
              <InfoItem icon={Hash} label="Tenant ID" value={report.tenantId} mono />
              <InfoItem icon={Hash} label="Meeting ID" value={report.meetingId} mono />
              <InfoItem icon={Clock} label="Meeting Cycle" value={report.meetingTimeline} />
            </div>
          </div>

          {/* Task Ownership */}
          {Array.isArray(report.taskOwnershipBreakdown) && report.taskOwnershipBreakdown.length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-sky-400" /> Task Ownership
              </h3>
              <div className="space-y-2">
                {report.taskOwnershipBreakdown.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-slate-800/40 last:border-0">
                    <div className="w-7 h-7 rounded-full bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-indigo-400">
                        {item.owner.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-300 truncate">{item.owner}</p>
                      <p className="text-[10px] text-slate-500 truncate">{item.role}</p>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-slate-300 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/50">
                      {item.taskCount}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default ReportDetails;
