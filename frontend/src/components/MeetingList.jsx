import React, { useState } from 'react';
import { Calendar, Play, Check, AlertCircle, RefreshCw, Download, ChevronDown, ChevronUp, Clock, Bot } from 'lucide-react';
import { api } from '../services/api';
import { ReportPreviewModal } from './ReportPreviewModal';

// Closed meetings older than 90 days collapse into a "Show older" toggle.
const HISTORY_CUTOFF_MS = 90 * 24 * 60 * 60 * 1000;
// Conducted meetings more than 14 days past their scheduled date get a stale warning.
const STALE_CONDUCTED_MS = 14 * 24 * 60 * 60 * 1000;

export const MeetingList = ({ meetings = [], onTriggerWorkflow, onReviewMeeting, onConductMeeting, onCloseMeeting, onReviewReschedule, onRequestReschedule, onRefreshMeetings }) => {
  const [triggeringId, setTriggeringId] = useState(null);
  const [retryingTranscriptId, setRetryingTranscriptId] = useState(null);
  const [addingBotId, setAddingBotId] = useState(null);
  const [previewPayload, setPreviewPayload] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const now = Date.now();
  const activeMeetings = meetings.filter(
    (m) => m.status !== 'closed' || now - new Date(m.scheduledStart).getTime() < HISTORY_CUTOFF_MS
  );
  const historyMeetings = meetings.filter(
    (m) => m.status === 'closed' && now - new Date(m.scheduledStart).getTime() >= HISTORY_CUTOFF_MS
  );

  const handleTrigger = async (meetingId) => {
    setTriggeringId(meetingId);
    try {
      await onTriggerWorkflow(meetingId);
    } catch (err) {
      console.error(err);
    } finally {
      setTriggeringId(false);
    }
  };

  const handleRetryTranscript = async (meetingId) => {
    if (!window.confirm('This will clear the existing transcript and re-fetch from Fireflies AI. Continue?')) return;
    setRetryingTranscriptId(meetingId);
    try {
      await api.meetings.retryTranscript(meetingId);
      alert('Transcript re-fetch scheduled. The real Fireflies transcript will arrive within 5–10 minutes.');
      if (onRefreshMeetings) onRefreshMeetings();
    } catch (err) {
      alert(`Failed to retry transcript: ${err?.response?.data?.error || err.message}`);
    } finally {
      setRetryingTranscriptId(null);
    }
  };

  const handleAddBot = async (meetingId) => {
    setAddingBotId(meetingId);
    try {
      const result = await api.meetings.addBot(meetingId);
      alert(result.message || 'Fireflies bot invited successfully.');
      if (onRefreshMeetings) onRefreshMeetings();
    } catch (err) {
      alert(`Failed to add bot: ${err?.response?.data?.error || err.message}`);
    } finally {
      setAddingBotId(null);
    }
  };

  const createReportPayload = (meetingDetails, findings, tasks) => {
    const approvedTasks = tasks.filter((task) => task.approvalStatus === 'approved').length;
    const pendingTasks = tasks.filter((task) => task.approvalStatus === 'pending').length;
    const completedTasks = tasks.filter((task) => task.remediationStatus === 'completed').length;

    return {
      reportId: `monthly-review-${meetingDetails.id}`,
      generatedAt: new Date().toISOString(),
      reportType: 'Monthly Review Journey Sample',
      sampleData: true,
      client: {
        tenantId: meetingDetails.tenantId,
        title: meetingDetails.title,
        provider: meetingDetails.provider,
      },
      meeting: {
        id: meetingDetails.id,
        title: meetingDetails.title,
        status: meetingDetails.status,
        scheduledStart: meetingDetails.scheduledStart,
        scheduledEnd: meetingDetails.scheduledEnd,
        calendarEventId: meetingDetails.calendarEventId,
        triggerDate: meetingDetails.triggerDate,
        provider: meetingDetails.provider,
      },
      executiveSummary: {
        overview: 'This sample monthly review includes the completed journey details, prioritized findings, and remediation tasks generated from the monthly buyer review process.',
        conclusion: 'High-risk findings were identified and matched with remediation actions to reduce exposure ahead of the next monthly meeting.',
        recommendations: [
          'Close critical S3 public exposure and encrypt at rest using KMS.',
          'Enforce MFA for all elevated IAM accounts.',
          'Upgrade public gateway TLS stack and validate certificate chains.',
        ],
      },
      metrics: {
        totalFindings: findings.length,
        totalRemediationTasks: tasks.length,
        approvedTasks,
        pendingTasks,
        completedTasks,
      },
      findings: findings.map((finding) => ({
        id: finding.id,
        sourceFindingId: finding.sourceFindingId,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description,
        systemAffected: finding.systemAffected,
      })),
      remediationTasks: tasks.map((task) => ({
        id: task.id,
        findingId: task.findingId,
        title: task.title,
        actionPlan: task.actionPlan,
        riskReductionScore: task.riskReductionScore,
        approvalStatus: task.approvalStatus,
        remediationStatus: task.remediationStatus,
        createdAt: task.createdAt,
      })),
      metadata: {
        generatedBy: 'NxgSecure Engine',
        description: 'Sample report payload showing the downloaded monthly review structure for a completed journey.',
      },
    };
  };

  const handleOpenPreview = async (meeting) => {
    setLoadingPreview(true);
    try {
      const [meetingDetails, findings, tasks] = await Promise.all([
        api.meetings.getById(meeting.id),
        api.findings.listForMeeting(meeting.id),
        api.tasks.listForMeeting(meeting.id),
      ]);
      setPreviewPayload(createReportPayload(meetingDetails, findings, tasks));
      setShowPreview(true);
    } catch (error) {
      console.error('Unable to load preview data:', error);
      alert('Failed to load report preview.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const getStatusBadge = (status) => {
    const configs = {
      scheduled: { text: 'Scheduled', style: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/20' },
      approval_pending: { text: 'Review Required', style: 'bg-amber-500/20 text-amber-400 border-amber-500/20 pulse-indicator' },
      approved: { text: 'Approved', style: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' },
      conducted: { text: 'Conducted', style: 'bg-violet-500/20 text-violet-400 border-violet-500/20' },
      closed: { text: 'Closed', style: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' },
      reschedule_requested: { text: 'Reschedule Requested', style: 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/20' },
      completed: { text: 'Completed', style: 'bg-slate-500/20 text-slate-400 border-slate-700/50' },
      cancelled: { text: 'Cancelled', style: 'bg-rose-500/20 text-rose-400 border-rose-500/20' },
    };
    const c = configs[status] || configs.scheduled;
    return (
      <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider border ${c.style}`}>
        {c.text}
      </span>
    );
  };

  const renderMeetingRow = (meeting) => {
    const isTriggering = triggeringId === meeting.id;
    const isCancelledInOutlook = !!meeting.calendarCancelledAt;
    const isStale = meeting.status === 'conducted'
      && now - new Date(meeting.scheduledStart).getTime() > STALE_CONDUCTED_MS;

    return (
      <tr key={meeting.id} className={`transition-colors ${isCancelledInOutlook ? 'opacity-50' : 'hover:bg-slate-900/10'}`}>
        <td className="py-3.5 px-4 font-bold text-slate-200 flex items-center gap-2.5">
          <div className={`p-1.5 rounded border ${isStale ? 'bg-amber-900/30 border-amber-700/50' : 'bg-slate-800 border-slate-700/50'}`}>
            {isStale
              ? <Clock className="w-3.5 h-3.5 text-amber-400" title="Conducted but awaiting closure for over 14 days" />
              : <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            }
          </div>
          <div className="min-w-0">
            {meeting.seqNum && (
              <span className="text-[9px] font-mono text-indigo-500 mr-1.5">#{String(meeting.seqNum).padStart(3, '0')}</span>
            )}
            <span>{meeting.title}</span>
            {isStale && (
              <span className="ml-2 text-[9px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                Awaiting Closure
              </span>
            )}
            {isCancelledInOutlook && (
              <span className="ml-2 text-[9px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-1.5 py-0.5">
                Cancelled in Outlook
              </span>
            )}
          </div>
        </td>
        <td className="py-3.5 px-4 font-semibold text-slate-300">
          {new Date(meeting.scheduledStart).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </td>
        <td className="py-3.5 px-4 font-bold text-slate-400 capitalize">
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${meeting.provider === 'microsoft' ? 'bg-sky-500' : 'bg-slate-500'}`} />
            <span>{meeting.provider}</span>
          </span>
        </td>
        <td className="py-3.5 px-4">
          {getStatusBadge(meeting.status)}
        </td>
        <td className="py-3.5 px-4 text-right">
          {isCancelledInOutlook && (
            <span className="text-[10px] text-rose-400 font-semibold flex items-center justify-end gap-1.5">
              <AlertCircle className="w-3 h-3" />
              <span>Cancelled in Outlook</span>
            </span>
          )}
          {!isCancelledInOutlook && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {meeting.status === 'scheduled' && (
              <button
                onClick={() => handleTrigger(meeting.id)}
                disabled={isTriggering}
                className="bg-indigo-650 hover:bg-indigo-600 border border-indigo-500/25 text-white font-semibold text-[10px] px-2.5 py-1.5 rounded transition-all flex items-center gap-1"
                title="Simulate 48h trigger to pull vulnerabilities and generate AI plan"
              >
                {isTriggering ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                <span>Trigger 48h Scan</span>
              </button>
            )}

            {(meeting.status === 'scheduled' || meeting.status === 'approval_pending') && onRequestReschedule && (
              <button
                onClick={() => onRequestReschedule(meeting)}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 font-semibold text-[10px] px-2.5 py-1.5 rounded flex items-center gap-1"
                title="Request a reschedule for this meeting"
              >
                <Calendar className="w-3 h-3" />
                <span>Reschedule</span>
              </button>
            )}

            {meeting.status === 'approval_pending' && (
              <button
                onClick={() => onReviewMeeting(meeting)}
                className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-[10px] px-2.5 py-1.5 rounded flex items-center gap-1 shadow-md shadow-amber-950"
              >
                <AlertCircle className="w-3 h-3" />
                <span>Review AI Plan</span>
              </button>
            )}

            {meeting.status === 'reschedule_requested' && onReviewReschedule && (
              <button
                onClick={() => onReviewReschedule(meeting)}
                className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[10px] px-2.5 py-1.5 rounded flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Review Request</span>
              </button>
            )}

            {(meeting.status === 'scheduled' || meeting.status === 'approval_pending' || meeting.status === 'reschedule_requested') && (
              <button
                onClick={() => handleAddBot(meeting.id)}
                disabled={addingBotId === meeting.id}
                title="Add Fireflies AI bot to this meeting's calendar invite so it joins and records automatically"
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-amber-400 font-semibold text-[10px] border border-slate-700/50 px-2.5 py-1.5 rounded flex items-center gap-1"
              >
                {addingBotId === meeting.id
                  ? <RefreshCw className="w-3 h-3 animate-spin" />
                  : <Bot className="w-3 h-3" />
                }
                <span>{addingBotId === meeting.id ? 'Adding…' : 'Add Bot'}</span>
              </button>
            )}

            {(meeting.status === 'scheduled' || meeting.status === 'approved' || meeting.status === 'approval_pending') && onConductMeeting && (
              <button
                onClick={() => onConductMeeting(meeting.id)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[10px] px-2.5 py-1.5 rounded flex items-center gap-1"
              >
                <Check className="w-3 h-3" />
                <span>Mark Conducted</span>
              </button>
            )}

            {meeting.status === 'conducted' && onCloseMeeting && (
              <button
                onClick={() => onCloseMeeting(meeting.id)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[10px] px-2.5 py-1.5 rounded flex items-center gap-1"
              >
                <Calendar className="w-3 h-3" />
                <span>Close Meeting</span>
              </button>
            )}

            {(meeting.status === 'approval_pending' || meeting.status === 'approved' || meeting.status === 'conducted' || meeting.status === 'closed') && (
              <button
                onClick={() => handleOpenPreview(meeting)}
                disabled={loadingPreview}
                className="bg-slate-800 hover:bg-slate-700 text-indigo-400 font-semibold text-[10px] border border-slate-700/50 px-2.5 py-1.5 rounded flex items-center gap-1"
              >
                {loadingPreview
                  ? <RefreshCw className="w-3 h-3 animate-spin" />
                  : <Download className="w-3 h-3" />
                }
                <span>{loadingPreview ? 'Loading Preview' : 'Preview Report'}</span>
              </button>
            )}

            {meeting.status === 'closed' && (
              <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 px-2.5 py-1.5">
                <Check className="w-3 h-3" />
                <span>Closed</span>
              </span>
            )}
          </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="glass-panel p-6 flex flex-col gap-4 w-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Monthly Review Journeys</h3>
          <p className="text-xs text-slate-400">Manage individual scheduled reviews, calendar syncs, and approval workflows</p>
        </div>
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[480px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-950">
            <tr className="border-b border-slate-800/80 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="py-3 px-4">Journey / Title</th>
              <th className="py-3 px-4">Scheduled Start</th>
              <th className="py-3 px-4">Sync Provider</th>
              <th className="py-3 px-4">Current Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {meetings.length === 0 && (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-500 font-semibold">
                  No active journeys found. Setup customer calendar connections to schedule.
                </td>
              </tr>
            )}
            {activeMeetings.map(renderMeetingRow)}
            {historyMeetings.length > 0 && (
              <tr>
                <td colSpan="5" className="pt-4 pb-1 px-4">
                  <button
                    onClick={() => setShowHistory((v) => !v)}
                    className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showHistory ? 'Hide' : 'Show'} {historyMeetings.length} older closed meeting{historyMeetings.length !== 1 ? 's' : ''}
                  </button>
                </td>
              </tr>
            )}
            {showHistory && historyMeetings.map(renderMeetingRow)}
          </tbody>
        </table>
      </div>
      <ReportPreviewModal
        isOpen={showPreview}
        reportPayload={previewPayload}
        onClose={() => setShowPreview(false)}
      />
    </div>
  );
};
