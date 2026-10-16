import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import {
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  X,
  FileText,
  Eye,
  Download,
  Building2,
  Calendar,
  ChevronDown,
} from 'lucide-react';

const PAGE_SIZE = 10;

export const ReportList = () => {
  const [reports, setReports]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType]         = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [sortField, setSortField] = useState('generatedAt');
  const [sortDir, setSortDir]     = useState('desc');
  const [page, setPage]           = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [downloads, setDownloads]     = useState({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const result = await api.reports.list({ pageSize: 500 });
        if (active) setReports(result?.items || []);
      } catch {
        if (active) setReports([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Derive unique customer names from loaded reports for the filter dropdown
  const customersList = useMemo(() => {
    const seen = new Set();
    return reports
      .filter(r => r.customerName && !seen.has(r.customerName) && seen.add(r.customerName))
      .map(r => ({ name: r.customerName }));
  }, [reports]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const filteredReports = useMemo(() => {
    let list = [...reports];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.customerName || '').toLowerCase().includes(q)
      );
    }

    if (selectedType) {
      list = list.filter(r => r.reportType === selectedType);
    }

    if (selectedCustomer) {
      list = list.filter(r => r.customerName === selectedCustomer);
    }

    list.sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'title':
          aVal = (a.title || '').toLowerCase();
          bVal = (b.title || '').toLowerCase();
          break;
        case 'progress':
          aVal = a.progressPercentage || 0;
          bVal = b.progressPercentage || 0;
          break;
        default:
          aVal = new Date(a.generatedAt).getTime();
          bVal = new Date(b.generatedAt).getTime();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [reports, searchQuery, selectedType, selectedCustomer, sortField, sortDir]);

  const totalPages      = Math.ceil(filteredReports.length / PAGE_SIZE) || 1;
  const paginatedReports = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredReports.slice(start, start + PAGE_SIZE);
  }, [filteredReports, page]);

  const handleDownload = (reportId, format) => {
    const key = `${reportId}-${format}`;
    if (downloads[key]) return;
    setDownloads(prev => ({ ...prev, [key]: true }));

    setTimeout(() => {
      const rep = reports.find(r => r.id === reportId);
      if (!rep) return;
      const filename = `${(rep.title || reportId).toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${format === 'excel' ? 'csv' : 'pdf'}`;
      const fileContent = format === 'excel'
        ? `Meeting ID,Customer Name,Open Tasks,Closed Tasks,Escalated Tasks,Carry Forward Tasks,Progress\n${rep.meetingId},"${rep.customerName}",${rep.openTasksCount || 0},${rep.closedTasksCount || 0},${rep.escalatedTasksCount || 0},${rep.carryForwardTasksCount || 0},${rep.progressPercentage || 0}%`
        : `DOCUMENT: ${rep.title}\nTenant: ${rep.customerName}\nProgress: ${rep.progressPercentage || 0}%`;

      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(fileContent));
      element.setAttribute('download', filename);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      setDownloads(p => { const c = { ...p }; delete c[key]; return c; });
    }, 1000);
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedType('');
    setSelectedCustomer('');
    setPage(1);
  };

  const activeFilters = [
    selectedType     && { label: `Type: ${selectedType === 'weekly_progress' ? 'Weekly' : 'Summary'}`, onRemove: () => setSelectedType('') },
    selectedCustomer && { label: `Customer: ${selectedCustomer}`, onRemove: () => setSelectedCustomer('') },
  ].filter(Boolean);

  return (
    <div className="space-y-5 animate-slide-up font-sans text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Weekly Reports Ledger</h1>
          <p className="text-slate-400 text-sm mt-1">
            {loading ? 'Loading...' : `${filteredReports.length} ${filteredReports.length === 1 ? 'document' : 'documents'} generated`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/reports"
            className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-550 rounded-lg transition-all"
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      <div className="glass-panel p-4 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search reports by title or tenant..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-800/60 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-all"
            />
          </div>
          <button
            onClick={() => setShowFilters(p => !p)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
              showFilters || activeFilters.length > 0
                ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400'
                : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-650'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeFilters.length > 0 && (
              <span className="bg-indigo-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {activeFilters.length}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="pt-3 border-t border-slate-850 grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Report Category</label>
              <div className="relative">
                <select
                  value={selectedType}
                  onChange={(e) => { setSelectedType(e.target.value); setPage(1); }}
                  className="w-full appearance-none bg-slate-800/65 border border-slate-700/65 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/65 pr-8"
                >
                  <option value="">All Categories</option>
                  <option value="weekly_progress">Weekly Progress Report</option>
                  <option value="monthly_summary">Monthly Meeting Summary</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Customer Tenant</label>
              <div className="relative">
                <select
                  value={selectedCustomer}
                  onChange={(e) => { setSelectedCustomer(e.target.value); setPage(1); }}
                  className="w-full appearance-none bg-slate-800/65 border border-slate-700/65 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/65 pr-8"
                >
                  <option value="">All Tenants</option>
                  {customersList.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              </div>
            </div>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Active:</span>
            {activeFilters.map((chip, idx) => (
              <span key={idx} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-[11px] font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 rounded-full">
                {chip.label}
                <button onClick={chip.onRemove} className="hover:text-indigo-200 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              onClick={clearAllFilters}
              className="text-[11px] text-slate-550 hover:text-slate-350 hover:underline transition-all ml-1.5"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px]">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-900/50">
                <th className="text-left py-3 px-4">
                  <button onClick={() => handleSort('title')} className="flex items-center gap-1 group text-left">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider group-hover:text-slate-205">Report Document</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
                  </button>
                </th>
                <th className="text-left py-3 px-4 w-44">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Customer Tenant</span>
                </th>
                <th className="text-left py-3 px-4 w-40">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</span>
                </th>
                <th className="text-left py-3 px-4 w-28">
                  <button onClick={() => handleSort('progress')} className="flex items-center gap-1 group text-left">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider group-hover:text-slate-255">Progress</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
                  </button>
                </th>
                <th className="text-left py-3 px-4 w-44">
                  <button onClick={() => handleSort('generatedAt')} className="flex items-center gap-1 group text-left">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider group-hover:text-slate-255">Compiled Date</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
                  </button>
                </th>
                <th className="py-3 px-4 w-40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-805/40">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-500 text-sm">Loading reports...</td>
                </tr>
              ) : paginatedReports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-slate-500 text-sm">
                    No generated reports match the current filter selection.
                  </td>
                </tr>
              ) : (
                paginatedReports.map((rep) => {
                  const isWk    = rep.reportType === 'weekly_progress';
                  const pdfKey  = `${rep.id}-pdf`;
                  const excelKey = `${rep.id}-excel`;

                  return (
                    <tr key={rep.id} className="hover:bg-slate-800/20 group transition-all">
                      <td className="py-3.5 px-4 font-sans text-xs">
                        <div className="flex flex-col gap-0.5 max-w-sm">
                          <Link
                            to={`/reports/${rep.id}`}
                            className="text-sm font-semibold text-slate-205 group-hover:text-indigo-400 hover:text-indigo-400 transition-colors line-clamp-1"
                          >
                            {rep.title}
                          </Link>
                          <span className="text-[10px] text-slate-550 font-mono line-clamp-1">
                            {new Date(rep.generatedAt).toLocaleDateString()}
                          </span>
                          {isWk && rep.weekNumber && (
                            <span className="text-[10px] text-sky-500/80 font-medium">
                              Week {rep.weekNumber}
                              {rep.reportPeriodStart && rep.reportPeriodEnd
                                ? ` · ${new Date(rep.reportPeriodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(rep.reportPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                                : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-sm text-slate-350">{rep.customerName}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase ${
                          isWk
                            ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                          {isWk ? 'Weekly Progress' : 'Monthly Summary'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-extrabold text-slate-200">{rep.progressPercentage ?? 0}%</td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-350">
                          <Calendar className="w-3.5 h-3.5 text-slate-550 shrink-0" />
                          <span>
                            {new Date(rep.generatedAt).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                            })}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link
                            to={`/reports/${rep.id}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-805"
                            title="View Document Details"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                          <Link
                            to={`/reports/${rep.id}/preview`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-805"
                            title="Preview Letterhead Layout"
                          >
                            <FileText className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => handleDownload(rep.id, 'pdf')}
                            disabled={downloads[pdfKey]}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-805 disabled:opacity-40"
                            title="Download PDF Document"
                          >
                            <Download className={`w-4 h-4 ${downloads[pdfKey] ? 'animate-bounce' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleDownload(rep.id, 'excel')}
                            disabled={downloads[excelKey]}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
                            title="Download Excel Spreadsheet (CSV)"
                          >
                            <Download className={`w-4 h-4 text-slate-500 hover:text-emerald-400 ${downloads[excelKey] ? 'animate-bounce' : ''}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-805 bg-slate-900/20">
          <span className="text-[11px] text-slate-550">
            {filteredReports.length === 0
              ? 'No reports'
              : `Showing ${Math.min((page - 1) * PAGE_SIZE + 1, filteredReports.length)} to ${Math.min(page * PAGE_SIZE, filteredReports.length)} of ${filteredReports.length} reports`}
          </span>
          <div className="flex items-center gap-1 font-bold">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] text-slate-300 px-2">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
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

export default ReportList;
