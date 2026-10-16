import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, FileText } from 'lucide-react';
import { jsPDF } from 'jspdf';

export const ReportPreviewModal = ({ isOpen, onClose, reportPayload }) => {
  const [isDownloading, setIsDownloading] = useState(false);

  if (!isOpen || !reportPayload) return null;

  const downloadPdf = async () => {
    setIsDownloading(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const margin = 40;
      const pageWidth = doc.internal.pageSize.width;
      const maxTextWidth = pageWidth - margin * 2;
      let y = 40;

      const addPageIfNeeded = (space = 20) => {
        const pageHeight = doc.internal.pageSize.height;
        if (y + space > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
      };

      doc.setFontSize(18);
      doc.text('Monthly Review Journey', margin, y);
      y += 26;

      doc.setFontSize(10);
      doc.text(`Generated At: ${new Date(reportPayload.generatedAt).toLocaleString()}`, margin, y);
      y += 16;
      doc.text(`Report Type: ${reportPayload.reportType}`, margin, y);
      y += 20;

      doc.setFontSize(12);
      doc.text('Executive Summary', margin, y);
      y += 16;
      const summaryBlocks = [
        `Overview: ${reportPayload.executiveSummary.overview}`,
        `Conclusion: ${reportPayload.executiveSummary.conclusion}`,
        `Recommendations: ${reportPayload.executiveSummary.recommendations.join('; ')}`,
      ];
      summaryBlocks.forEach((block) => {
        const lines = doc.splitTextToSize(block, maxTextWidth);
        addPageIfNeeded(lines.length * 14 + 10);
        doc.text(lines, margin, y);
        y += lines.length * 14 + 10;
      });

      doc.setFontSize(12);
      doc.text('Metrics', margin, y);
      y += 16;
      const metrics = reportPayload.metrics;
      Object.entries(metrics).forEach(([key, value]) => {
        addPageIfNeeded(14);
        doc.text(`${key}: ${value}`, margin, y);
        y += 14;
      });
      y += 10;

      const addSection = (title, items, formatter) => {
        if (!items || items.length === 0) return;
        doc.setFontSize(12);
        addPageIfNeeded(20);
        doc.text(title, margin, y);
        y += 16;
        doc.setFontSize(10);
        items.forEach((item, index) => {
          const lines = doc.splitTextToSize(formatter(item, index), maxTextWidth);
          addPageIfNeeded(lines.length * 14 + 10);
          doc.text(lines, margin, y);
          y += lines.length * 14 + 10;
        });
        y += 6;
      };

      addSection('Findings', reportPayload.findings, (finding, index) => {
        return `${index + 1}. ${finding.severity.toUpperCase()} | ${finding.category} | ${finding.sourceFindingId} - ${finding.title}: ${finding.description}`;
      });

      addSection('Remediation Tasks', reportPayload.remediationTasks, (task, index) => {
        return `${index + 1}. ${task.title} [${task.approvalStatus}] - ${task.remediationStatus}. Risk reduction: ${task.riskReductionScore}%. Plan: ${task.actionPlan}`;
      });

      const filename = `${reportPayload.reportId.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error('PDF generation failed', err);
      alert('Unable to generate PDF at this time.');
    } finally {
      setIsDownloading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#1A1814]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-7xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60 flex flex-col max-h-[90vh]">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-indigo-700 via-slate-950 to-slate-900 px-6 py-4 border-b border-indigo-500/20 flex items-center justify-between gap-4 rounded-t-2xl shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 shrink-0">
                <FileText className="w-4 h-4" />
              </span>
              Monthly Review Report Preview
            </h2>
            <p className="text-[10px] text-slate-400 mt-0.5 ml-10">
              Inspect the report payload and export a formatted PDF version.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={downloadPdf}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-xs font-bold text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {isDownloading ? 'Generating…' : 'Download PDF'}
            </button>
            <button
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Scrollable content ──────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Row 1 — Summary + Meeting info */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Report Summary</h3>
              <div className="text-xs text-slate-300 space-y-1.5">
                <div><span className="font-semibold text-slate-100">Report ID:</span> {reportPayload.reportId}</div>
                <div><span className="font-semibold text-slate-200">Generated At:</span> {new Date(reportPayload.generatedAt).toLocaleString()}</div>
                <div><span className="font-semibold text-slate-200">Type:</span> {reportPayload.reportType}</div>
                <div><span className="font-semibold text-slate-200">Sample Mode:</span> {reportPayload.sampleData ? 'Enabled' : 'Disabled'}</div>
              </div>
            </div>
            <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Meeting Info</h3>
              <div className="text-xs text-slate-300 space-y-1.5">
                <div><span className="font-semibold text-slate-200">Title:</span> {reportPayload.meeting.title}</div>
                <div><span className="font-semibold text-slate-200">Status:</span> {reportPayload.meeting.status}</div>
                <div><span className="font-semibold text-slate-200">Provider:</span> {reportPayload.meeting.provider}</div>
                <div><span className="font-semibold text-slate-200">Scheduled:</span> {new Date(reportPayload.meeting.scheduledStart).toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Row 2 — Metrics */}
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(reportPayload.metrics).map(([key, value]) => (
              <div key={key} className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                  {key.replace(/([A-Z])/g, ' $1')}
                </p>
                <p className="text-2xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>

          {/* Row 3 — Executive summary */}
          <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Executive Summary</h3>
            <div className="text-xs text-slate-300 space-y-2">
              <p><span className="font-semibold text-slate-200">Overview:</span> {reportPayload.executiveSummary.overview}</p>
              <p><span className="font-semibold text-slate-200">Conclusion:</span> {reportPayload.executiveSummary.conclusion}</p>
              <p><span className="font-semibold text-slate-200">Recommendations:</span> {reportPayload.executiveSummary.recommendations.join('; ')}</p>
            </div>
          </div>

          {/* Row 4 — Findings + Tasks */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4 flex flex-col">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 shrink-0">
                Findings <span className="text-slate-600 normal-case font-normal">({reportPayload.findings.length})</span>
              </h3>
              <div className="overflow-y-auto max-h-64 space-y-2 pr-1">
                {reportPayload.findings.map((finding, index) => (
                  <div key={finding.id} className="rounded-lg bg-slate-950/60 p-3 border border-slate-800">
                    <p className="font-semibold text-xs text-slate-200">{index + 1}. {finding.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 font-medium uppercase tracking-wide">
                      {finding.severity} — {finding.category}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{finding.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4 flex flex-col">
              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 shrink-0">
                Remediation Tasks <span className="text-slate-600 normal-case font-normal">({reportPayload.remediationTasks.length})</span>
              </h3>
              <div className="overflow-y-auto max-h-64 space-y-2 pr-1">
                {reportPayload.remediationTasks.map((task, index) => (
                  <div key={task.id} className="rounded-lg bg-slate-950/60 p-3 border border-slate-800">
                    <p className="font-semibold text-xs text-slate-200">{index + 1}. {task.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {task.approvalStatus} / {task.remediationStatus}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{task.actionPlan}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 5 — Raw JSON */}
          <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Raw JSON Payload</h3>
            <pre className="overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap text-[10px] leading-5 text-slate-300 bg-slate-950/60 rounded-lg p-4 border border-slate-800">
              {JSON.stringify(reportPayload, null, 2)}
            </pre>
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
};
