import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { useTenant } from '../../context/TenantContext';
import { TenantSelector } from '../../components/TenantSelector';
import { jsPDF } from 'jspdf';
import {
  FileText,
  PlusCircle,
  BarChart3,
  Building2,
  Calendar,
  Layers,
  ChevronRight,
  TrendingUp,
  Download,
  Eye,
  CheckCircle2,
  AlertCircle,
  Settings,
} from 'lucide-react';

export const ReportsDashboard = () => {
  const { user } = useAuth();
  const { selectedTenant } = useTenant();
  
  // State for the generator modal/panel
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [reportType, setReportType] = useState('weekly_progress');
  const [weekNumber, setWeekNumber] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch reports lists
  const [reports, setReports] = useState([]);
  const [availableTenants, setAvailableTenants] = useState([]);
  const [availableMeetings, setAvailableMeetings] = useState([]);

  useEffect(() => {
    const loadReports = async () => {
      try {
        const [tenantResponse, reportResponse, meetingResponse] = await Promise.all([
          api.tenants.list(),
          api.reports.list({ page: 1, pageSize: 100 }),
          api.meetings.list()
        ]);

        setAvailableTenants(tenantResponse || []);
        setReports(reportResponse?.items || []);
        setAvailableMeetings(meetingResponse || []);
        const fallbackTenantId = selectedTenant?.id || tenantResponse?.[0]?.id || '';
        setSelectedTenantId(String(fallbackTenantId));
      } catch (error) {
        console.error('Unable to load reports dashboard', error);
        setAvailableTenants([]);
        setAvailableMeetings([]);
        setReports([]);
      }
    };

    loadReports();
  }, [selectedTenant?.id]);

  const tenantsList = useMemo(() => availableTenants || [], [availableTenants]);
  
  const meetingsList = useMemo(() => {
    if (!selectedTenantId) return [];
    return (availableMeetings || []).filter((meeting) => String(meeting.tenantId) === String(selectedTenantId));
  }, [selectedTenantId, availableMeetings]);

  // Aggregates for widgets
  const stats = useMemo(() => {
    const total = reports.length;
    const weeklyCount = reports.filter(r => r.reportType === 'weekly_progress').length;
    const monthlyCount = reports.filter(r => r.reportType === 'monthly_summary').length;
    const avgProg = total > 0 ? Math.round(reports.reduce((s, r) => s + r.progressPercentage, 0) / total) : 0;
    return { total, weeklyCount, monthlyCount, avgProg };
  }, [reports]);

  const handleGenerateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTenantId || !selectedMeetingId) {
      setError('Please select a customer and target meeting cycle.');
      return;
    }

    setGenerating(true);
    setError('');
    setSuccess('');

    try {
      const actorName = `${user?.first_name || 'Sarah'} ${user?.last_name || 'Jenkins'}`;
      const newReport = await api.reports.generate({
        tenantId: selectedTenantId,
        meetingId: selectedMeetingId,
        reportType,
        weekNumber: reportType === 'weekly_progress' ? weekNumber : null,
        generatedBy: actorName
      });

      if (newReport) {
        setReports((currentReports) => [newReport, ...currentReports]);
        setSuccess(`Report "${newReport.title}" generated successfully.`);
      } else {
        setSuccess('Report generated successfully.');
      }

      setSelectedTenantId('');
      setSelectedMeetingId('');
      setTimeout(() => {
        setSuccess('');
        setShowGenerator(false);
      }, 2000);
    } catch (err) {
      setError(err.message || 'Failed to generate report.');
    } finally {
      setGenerating(false);
    }
  };

  const exportReportAsCsv = (report) => {
    const csvLines = [
      ['Report Title', 'Customer', 'Report Type', 'Open Tasks', 'Closed Tasks', 'Escalated Tasks', 'Progress'],
      [
        report.title,
        report.customerName || selectedTenant?.name || '',
        report.reportType,
        report.openTasksCount,
        report.closedTasksCount,
        report.escalatedTasksCount,
        report.progressPercentage
      ]
    ].map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.title}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportReportAsPdf = (report) => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(report.title, 14, 20);
    doc.setFontSize(11);
    doc.text(`Customer: ${report.customerName || selectedTenant?.name || ''}`, 14, 32);
    doc.text(`Type: ${report.reportType}`, 14, 40);
    doc.text(`Open Tasks: ${report.openTasksCount}`, 14, 48);
    doc.text(`Closed Tasks: ${report.closedTasksCount}`, 14, 56);
    doc.text(`Escalated Tasks: ${report.escalatedTasksCount}`, 14, 64);
    doc.text(`Progress: ${report.progressPercentage}%`, 14, 72);
    doc.save(`${report.title}.pdf`);
  };

  return (
    <div className="space-y-6 animate-slide-up font-sans text-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Weekly Reports Engine</h1>
          <p className="text-slate-400 text-sm mt-1">
            Generate and track progress reports between monthly compliance journey reviews
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TenantSelector />
          <button
            onClick={() => setShowGenerator((p) => !p)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-indigo-650/20 transition-all shrink-0"
          >
            <PlusCircle className="w-4 h-4" />
            Generate Progress Report
          </button>
        </div>
      </div>

      {/* Interactive Generator Panel */}
      {showGenerator && (
        <div className="glass-panel p-5 space-y-4 border-indigo-500/25 cyber-glow animate-slide-up">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <h3 className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-400" /> New Report Parameters
            </h3>
            <button
              onClick={() => { setShowGenerator(false); setError(''); }}
              className="text-slate-500 hover:text-slate-350 font-semibold"
            >
              Cancel
            </button>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-rose-400 p-2.5 rounded-md leading-relaxed">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-2.5 rounded-md flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {success}
            </div>
          )}

          <form onSubmit={handleGenerateSubmit} className={`grid grid-cols-1 gap-4 items-end ${reportType === 'weekly_progress' ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Customer Tenant</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 w-4 h-4 text-slate-600" />
                <select
                  value={selectedTenantId}
                  onChange={(e) => { setSelectedTenantId(e.target.value); setSelectedMeetingId(''); }}
                  className="w-full appearance-none bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select Tenant</option>
                  {tenantsList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none rotate-90" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Journey Meeting Cycle</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-3 w-4 h-4 text-slate-600" />
                <select
                  value={selectedMeetingId}
                  onChange={(e) => setSelectedMeetingId(e.target.value)}
                  disabled={!selectedTenantId}
                  className="w-full appearance-none bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <option value="">Select Cycle</option>
                  {meetingsList.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.title.replace('Monthly Review - ', '')} ({new Date(m.scheduledStart).toLocaleDateString(undefined, {month:'short', year:'2-digit'})})
                    </option>
                  ))}
                </select>
                <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none rotate-90" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Report Category</label>
              <div className="relative">
                <Layers className="absolute left-3 top-3 w-4 h-4 text-slate-600" />
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  className="w-full appearance-none bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="weekly_progress">Weekly Progress Report</option>
                  <option value="monthly_summary">Monthly Meeting Summary</option>
                </select>
                <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none rotate-90" />
              </div>
            </div>

            {reportType === 'weekly_progress' && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Report Week</label>
                <div className="relative">
                  <TrendingUp className="absolute left-3 top-3 w-4 h-4 text-slate-600" />
                  <select
                    value={weekNumber}
                    onChange={(e) => setWeekNumber(Number(e.target.value))}
                    className="w-full appearance-none bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value={1}>Week 1 (Days 1–7)</option>
                    <option value={2}>Week 2 (Days 8–14)</option>
                    <option value={3}>Week 3 (Days 15–21)</option>
                    <option value={4}>Week 4 (Days 22–End)</option>
                  </select>
                  <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none rotate-90" />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={generating}
              className="w-full py-2 bg-indigo-650 hover:bg-indigo-600 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-indigo-950 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Compiling...</span>
                </>
              ) : (
                <span>Compile Document</span>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Stat Widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel p-5 flex items-center gap-4 animate-slide-up">
          <div className="p-3 rounded-xl bg-indigo-500/10 shrink-0">
            <FileText className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Total Reports</p>
            <h3 className="text-2xl font-extrabold text-white leading-none">{stats.total}</h3>
            <p className="text-[9px] text-slate-550 mt-1">Archived in-app documents</p>
          </div>
        </div>

        <div className="glass-panel p-5 flex items-center gap-4 animate-slide-up">
          <div className="p-3 rounded-xl bg-sky-500/10 shrink-0">
            <TrendingUp className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Weekly Checkpoints</p>
            <h3 className="text-2xl font-extrabold text-white leading-none">{stats.weeklyCount}</h3>
            <p className="text-[9px] text-slate-550 mt-1">Interim status updates</p>
          </div>
        </div>

        <div className="glass-panel p-5 flex items-center gap-4 animate-slide-up">
          <div className="p-3 rounded-xl bg-emerald-500/10 shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Closing Reviews</p>
            <h3 className="text-2xl font-extrabold text-white leading-none">{stats.monthlyCount}</h3>
            <p className="text-[9px] text-slate-550 mt-1">Monthly cycles summarized</p>
          </div>
        </div>

        <div className="glass-panel p-5 flex items-center gap-4 animate-slide-up">
          <div className="p-3 rounded-xl bg-amber-500/10 shrink-0">
            <BarChart3 className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Avg. Completion</p>
            <h3 className="text-2xl font-extrabold text-white leading-none">{stats.avgProg}%</h3>
            <p className="text-[9px] text-slate-550 mt-1">Overall remediation weight</p>
          </div>
        </div>
      </div>

      {/* Report Timeline */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-400" /> Report Timeline
          </h3>
          <span className="text-[10px] text-slate-500">{reports.length} total documents</span>
        </div>
        {reports.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-4">No reports generated yet. Use Generate Progress Report above.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-slate-800" />
            <div className="space-y-3 ml-6">
              {reports.slice(0, 8).map((rep) => (
                <div key={rep.id} className="relative flex items-start gap-3 group">
                  <div className={`absolute -left-[23px] top-1.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                    rep.reportType === 'weekly_progress'
                      ? 'bg-sky-900 border-sky-500'
                      : 'bg-emerald-900 border-emerald-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${
                        rep.reportType === 'weekly_progress'
                          ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      }`}>
                        {rep.reportType === 'weekly_progress' ? 'Weekly' : 'Monthly'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(rep.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      </span>
                      <span className="text-[9px] font-semibold text-slate-400">{rep.customerName}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[11px] text-slate-300 font-medium truncate max-w-sm group-hover:text-indigo-300 transition-colors">{rep.title}</p>
                      <span className="text-[9px] font-bold text-emerald-400 shrink-0">{rep.progressPercentage}%</span>
                    </div>
                  </div>
                  <Link
                    to={`/reports/${rep.id}`}
                    className="shrink-0 p-1 rounded text-slate-600 hover:text-indigo-400 transition-colors"
                    title="View"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Trends & Recent Reports Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Recent Reports Listing (2/3 width) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" /> Recent Document Ledger
            </h3>
            <Link to="/reports/list" className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1">
              All documents <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px]">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-900/50">
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Document Title</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Customer</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</th>
                    <th className="text-left py-3 px-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Completion</th>
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-805/40">
                  {reports.slice(0, 5).map((rep) => (
                    <tr key={rep.id} className="hover:bg-slate-800/20 transition-all group">
                      <td className="py-3 px-4">
                        <div className="max-w-xs font-semibold">
                          <Link to={`/reports/${rep.id}`} className="text-slate-200 group-hover:text-indigo-400 transition-colors truncate block">
                            {rep.title}
                          </Link>
                          <span className="text-[9px] text-slate-550 block mt-0.5">Generated {new Date(rep.generatedAt).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-350">{rep.customerName}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                          rep.reportType === 'weekly_progress' 
                            ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' 
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                          {rep.reportType === 'weekly_progress' ? 'Weekly Checkpoint' : 'Monthly Summary'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-bold text-slate-300">{rep.progressPercentage}%</td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/reports/${rep.id}`}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Link>
                          <Link
                            to={`/reports/${rep.id}/preview`}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Preview Letterhead"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </Link>
                          <button
                            onClick={() => exportReportAsPdf(rep)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Export PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => exportReportAsCsv(rep)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                            title="Export Excel CSV"
                          >
                            <Layers className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Informational Widget Side Panel (1/3 width) */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" /> System Integration
          </h3>

          <div className="glass-panel p-5 space-y-4">
            <p className="text-slate-400 leading-relaxed font-normal">
              Reports compile in real-time by querying active remediation milestones from the **Remediation Tracker** module.
            </p>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="font-semibold text-slate-300">Live Task Sync</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Any changes made to task progress, resolution checklists, or flags are instantly reflected upon document generation.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                <span className="font-semibold text-slate-300">PDF & CSV Compiled</span>
              </div>
              <p className="text-[10px] text-slate-500">
                PDFs are formatted dynamically using vector grid prints, and Excel datasets format metadata in structured CSV grids.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ReportsDashboard;
