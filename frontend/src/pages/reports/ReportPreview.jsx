import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../services/api';
import {
  ArrowLeft, Printer, ShieldCheck, AlertTriangle, RefreshCw,
  CheckCircle2, XCircle, Clock, RotateCcw, ArrowUpRight,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEV_COLOR = {
  critical: { dot: 'bg-rose-500',   text: 'text-rose-700',   label: 'CRITICAL' },
  high:     { dot: 'bg-amber-500',  text: 'text-amber-700',  label: 'HIGH'     },
  medium:   { dot: 'bg-indigo-500', text: 'text-indigo-700', label: 'MEDIUM'   },
  low:      { dot: 'bg-slate-400',  text: 'text-slate-600',  label: 'LOW'      },
};

const STATUS_COLOR = {
  completed:           'text-emerald-700 bg-emerald-50  border-emerald-200',
  closed:              'text-emerald-700 bg-emerald-50  border-emerald-200',
  in_progress:         'text-blue-700    bg-blue-50     border-blue-200',
  awaiting_validation: 'text-amber-700   bg-amber-50    border-amber-200',
  open:                'text-slate-700   bg-slate-50    border-slate-300',
  escalated:           'text-rose-700    bg-rose-50     border-rose-200',
  overdue:             'text-red-700     bg-red-50      border-red-200',
  carry_forward:       'text-orange-700  bg-orange-50   border-orange-200',
  blocked:             'text-orange-700  bg-orange-50   border-orange-200',
  cancelled:           'text-slate-500   bg-slate-50    border-slate-200',
};

const PRIORITY_DOT = { critical: 'bg-rose-500', high: 'bg-amber-400', medium: 'bg-sky-400', low: 'bg-slate-400' };

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const fmtShort = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};

const isOverdue = (due, status) =>
  due && new Date(due) < new Date() && !['completed', 'closed', 'cancelled'].includes(status);

// ─── Section heading ──────────────────────────────────────────────────────────

const SectionHeading = ({ num, title }) => (
  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 pb-1.5 mb-3 flex items-center gap-2">
    <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[8px] font-black shrink-0">
      {num}
    </span>
    {title}
  </h3>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const ReportPreview = () => {
  const { reportId } = useParams();
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const data = await api.reports.getById(reportId);
        if (active) setReport(data);
      } catch (err) {
        if (active) setError(err?.response?.data?.error || err.message || 'Failed to load report');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [reportId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading report…</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500">
        <AlertTriangle className="w-10 h-10 mb-3 text-amber-500" />
        <p className="text-sm font-semibold text-slate-300">{error || 'Report not found'}</p>
        <Link to="/reports" className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm font-semibold">
          ← Back to Reports
        </Link>
      </div>
    );
  }

  const tasks    = report.tasks    || [];
  const findings = report.findings || [];
  const isMonthly = report.reportType === 'monthly_summary';

  const completedTasks   = tasks.filter(t => ['completed', 'closed'].includes(t.remediationStatus));
  const openTasks        = tasks.filter(t => !['completed', 'closed', 'cancelled'].includes(t.remediationStatus));
  const escalatedTasks   = tasks.filter(t => t.escalationCount > 0 || t.remediationStatus === 'escalated');
  const carryForwardTasks = tasks.filter(t => t.carryForwardCount > 0 || t.remediationStatus === 'carry_forward');
  const overdueTasks     = tasks.filter(t => isOverdue(t.dueDate, t.remediationStatus));

  const progress = tasks.length > 0
    ? Math.round((completedTasks.length / tasks.length) * 100)
    : (report.progressPercentage ?? 0);

  const generatedDate = new Date(report.generatedAt || Date.now());

  return (
    <div className="space-y-6 font-sans text-xs max-w-4xl mx-auto pb-16 animate-slide-up">

      {/* Action bar (hidden on print) */}
      <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 p-3 rounded-xl print:hidden">
        <div className="flex items-center gap-2">
          <Link
            to={`/reports/${report.id}`}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Back to Details"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="text-slate-300 font-semibold text-sm">Document Preview</span>
          <span className="text-slate-600 text-[10px]">
            {isMonthly ? 'Monthly Meeting Summary' : 'Weekly Progress Report'}
          </span>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs transition-colors"
        >
          <Printer className="w-3.5 h-3.5" /> Print / Save PDF
        </button>
      </div>

      {/* ── Printable document ── */}
      <div className="bg-white text-slate-900 px-10 py-10 shadow-xl border border-slate-200 print:border-0 print:shadow-none print:p-0">

        {/* Document header */}
        <div className="flex items-start justify-between border-b-2 border-indigo-600 pb-5 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="p-1.5 bg-indigo-600 rounded text-white shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-black text-slate-950 tracking-tight uppercase">NxgSecure Security Engine</h1>
            </div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Enterprise Security Journey Documentation</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] px-2.5 py-1 rounded font-extrabold bg-slate-100 border border-slate-200 text-slate-700 uppercase">
              {isMonthly ? 'Monthly Summary' : 'Weekly Progress'}
            </span>
            <p className="text-[9px] font-mono text-slate-500 mt-1.5">ID: {report.id}</p>
          </div>
        </div>

        {/* ─── 1. Document Information ─────────────────────────────── */}
        <div className="mb-6">
          <SectionHeading num="1" title="Document Information" />
          <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-100 rounded-lg p-4 text-xs">
            <div className="space-y-1.5">
              {[
                { label: 'Tenant',       value: report.customerName },
                { label: 'Tenant ID',    value: report.tenantId,  mono: true },
                { label: 'Meeting ID',   value: report.meetingId, mono: true },
                { label: 'Report Type',  value: isMonthly ? 'Monthly Meeting Summary' : 'Weekly Progress Report' },
                ...(!isMonthly && report.weekNumber ? [
                  { label: 'Week No.',     value: `Week ${report.weekNumber}` },
                  { label: 'Period',       value: `${fmtShort(report.reportPeriodStart)} – ${fmtShort(report.reportPeriodEnd)}` },
                ] : []),
              ].map(({ label, value, mono }) => (
                <div key={label} className="flex gap-2">
                  <span className="w-24 text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">{label}</span>
                  <span className={`text-slate-800 ${mono ? 'font-mono text-[10px]' : 'font-semibold'}`}>{value || '—'}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 text-right">
              {[
                { label: 'Generated',   value: generatedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
                { label: 'Generated By', value: report.generatedBy },
                { label: 'Report Title', value: report.title },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-2 justify-end">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
                  <span className="font-semibold text-slate-800">{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── 2. Executive Summary ────────────────────────────────── */}
        <div className="mb-6">
          <SectionHeading num="2" title="Executive Summary" />
          <p className="text-xs text-slate-700 leading-relaxed">
            {report.summary || 'No summary available for this report.'}
          </p>
        </div>

        {/* ─── 3. Remediation Statistics ───────────────────────────── */}
        <div className="mb-6">
          <SectionHeading num="3" title="Remediation Statistics" />
          <div className="grid grid-cols-6 gap-2 text-center">
            {[
              { label: 'Overall Progress', value: `${progress}%`,               color: 'text-indigo-700 text-lg font-black' },
              { label: 'Total Tasks',      value: tasks.length || report.openTasksCount + report.closedTasksCount, color: 'text-slate-700 text-lg font-black' },
              { label: 'Open',             value: report.openTasksCount,         color: 'text-sky-700 text-lg font-black' },
              { label: 'Closed',           value: report.closedTasksCount,       color: 'text-emerald-700 text-lg font-black' },
              { label: 'Escalated',        value: report.escalatedTasksCount,    color: `${report.escalatedTasksCount > 0 ? 'text-rose-700' : 'text-slate-500'} text-lg font-black` },
              { label: 'Carry Fwd',        value: report.carryForwardTasksCount, color: `${report.carryForwardTasksCount > 0 ? 'text-orange-700' : 'text-slate-500'} text-lg font-black` },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-50 border border-slate-200 rounded p-2.5 text-center">
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{label}</p>
                <p className={`mt-1 ${color}`}>{value ?? 0}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
              <span>Completion</span>
              <span className="font-bold text-slate-700">{progress}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        </div>

        {/* ─── 4. Security Findings Reviewed ───────────────────────── */}
        {findings.length > 0 && (
          <div className="mb-6">
            <SectionHeading num="4" title={`Security Findings Reviewed (${findings.length})`} />
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-left">
                  <th className="py-2 px-2">Finding ID</th>
                  <th className="py-2 px-2">Title</th>
                  <th className="py-2 px-2 w-20">Severity</th>
                  <th className="py-2 px-2 w-28">Category</th>
                  <th className="py-2 px-2 w-32">System</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {findings.map((f) => {
                  const sev = SEV_COLOR[f.severity] || SEV_COLOR.low;
                  return (
                    <tr key={f.id}>
                      <td className="py-2 px-2 font-mono text-[9px] text-slate-500">{f.sourceFindingId || f.id?.slice(0, 8)}</td>
                      <td className="py-2 px-2 font-semibold text-slate-800">{f.title}</td>
                      <td className="py-2 px-2">
                        <span className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sev.dot}`} />
                          <span className={`text-[9px] font-bold uppercase ${sev.text}`}>{sev.label}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2 text-[10px] text-slate-600">{f.category || '—'}</td>
                      <td className="py-2 px-2 text-[10px] text-slate-600">{f.systemAffected || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── 5. Remediation Task Ledger ──────────────────────────── */}
        <div className="mb-6">
          <SectionHeading num={findings.length > 0 ? '5' : '4'} title={`Remediation Task Ledger (${tasks.length} tasks)`} />
          {tasks.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">No tasks linked to this meeting.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-bold text-slate-500 uppercase tracking-wider text-left">
                  <th className="py-2 px-2">Task</th>
                  <th className="py-2 px-2 w-20">Priority</th>
                  <th className="py-2 px-2 w-28">Status</th>
                  <th className="py-2 px-2 w-28">Owner</th>
                  <th className="py-2 px-2 w-20">Due Date</th>
                  <th className="py-2 px-2 w-16 text-right">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((t) => {
                  const od = isOverdue(t.dueDate, t.remediationStatus);
                  const statusKey = t.remediationStatus || 'open';
                  return (
                    <tr key={t.id} className={od ? 'bg-red-50/40' : ''}>
                      <td className="py-2 px-2">
                        <p className="font-semibold text-slate-800 leading-snug">{t.title}</p>
                        <span className="text-[9px] font-mono text-slate-400">{t.sourceFindingId || ''}</span>
                        {t.escalationCount > 0 && (
                          <span className="ml-1 text-[8px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1 py-0.5 rounded">ESC</span>
                        )}
                        {t.carryForwardCount > 0 && (
                          <span className="ml-1 text-[8px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-1 py-0.5 rounded">CF×{t.carryForwardCount}</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <span className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-slate-400'}`} />
                          <span className="text-[9px] font-semibold capitalize text-slate-600">{t.priority || 'medium'}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${STATUS_COLOR[statusKey] || STATUS_COLOR.open}`}>
                          {statusKey.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-[10px] text-slate-600">{t.ownerName || '—'}</td>
                      <td className={`py-2 px-2 text-[10px] font-semibold ${od ? 'text-red-600' : 'text-slate-600'}`}>
                        {fmtShort(t.dueDate)}
                        {od && <span className="block text-[8px] text-red-500 font-bold">OVERDUE</span>}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className="text-[10px] font-bold text-slate-800">{t.progressPercentage ?? 0}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ─── 6. Carry-Forward Items ───────────────────────────────── */}
        {carryForwardTasks.length > 0 && (
          <div className="mb-6">
            <SectionHeading num={findings.length > 0 ? '6' : '5'} title={`Carry-Forward Items (${carryForwardTasks.length})`} />
            <div className="space-y-1.5">
              {carryForwardTasks.map((t) => (
                <div key={t.id} className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded px-3 py-2">
                  <RotateCcw className="w-3 h-3 text-orange-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-orange-900 leading-snug">{t.title}</p>
                    <p className="text-[9px] text-orange-600">
                      Carried forward {t.carryForwardCount}×{t.ownerName ? ` · Owner: ${t.ownerName}` : ''}{t.dueDate ? ` · Due: ${fmtShort(t.dueDate)}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── 7. Escalations ──────────────────────────────────────── */}
        {escalatedTasks.length > 0 && (
          <div className="mb-6">
            <SectionHeading num={findings.length > 0 ? '7' : '6'} title={`Escalations (${escalatedTasks.length})`} />
            <div className="space-y-1.5">
              {escalatedTasks.map((t) => (
                <div key={t.id} className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  <ArrowUpRight className="w-3 h-3 text-rose-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-rose-900 leading-snug">{t.title}</p>
                    <p className="text-[9px] text-rose-600">
                      Escalation count: {t.escalationCount}{t.ownerName ? ` · Owner: ${t.ownerName}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Completion summary row ───────────────────────────────── */}
        {tasks.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Completed ({completedTasks.length})
              </p>
              <div className="space-y-1">
                {completedTasks.slice(0, 6).map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                    <span className="truncate">{t.title}</span>
                  </div>
                ))}
                {completedTasks.length > 6 && (
                  <p className="text-[9px] text-slate-400">+{completedTasks.length - 6} more</p>
                )}
              </div>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Clock className="w-3 h-3 text-sky-500" /> Still Open ({openTasks.length})
              </p>
              <div className="space-y-1">
                {openTasks.slice(0, 6).map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                    <XCircle className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                    <span className="truncate">{t.title}</span>
                    {isOverdue(t.dueDate, t.remediationStatus) && (
                      <span className="text-[8px] font-bold text-red-500 shrink-0">OD</span>
                    )}
                  </div>
                ))}
                {openTasks.length > 6 && (
                  <p className="text-[9px] text-slate-400">+{openTasks.length - 6} more</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Document footer / sign-off ───────────────────────────── */}
        <div className="border-t-2 border-slate-200 pt-6 space-y-6">
          <div className="grid grid-cols-2 gap-12">
            <div className="space-y-1 border-t border-slate-300 pt-3">
              <p className="text-[9px] text-slate-500 font-bold uppercase">Security Team Sign-off</p>
              <div className="h-6" />
              <p className="text-xs font-extrabold text-slate-800">{report.generatedBy || 'Account Manager'}</p>
              <p className="text-[10px] text-slate-500">Security Delivery Lead</p>
            </div>
            <div className="space-y-1 border-t border-slate-300 pt-3 text-right">
              <p className="text-[9px] text-slate-500 font-bold uppercase">Client Verification</p>
              <div className="h-6" />
              <p className="text-xs font-extrabold text-slate-800">Authorised Client Signatory</p>
              <p className="text-[10px] text-slate-500">{report.customerName} Representative</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-[9px] text-slate-500 font-semibold border-t border-slate-100 pt-3">
            <span>
              Generated {generatedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {' · '}By {report.generatedBy || '—'}
            </span>
            <span>NxgSecure Platform · Confidential</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ReportPreview;
