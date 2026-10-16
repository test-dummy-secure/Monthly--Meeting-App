import React from 'react';
import { CheckCircle2, Clock, ShieldAlert, Cpu, Sparkles, Send, Calendar } from 'lucide-react';

export const TimelineView = ({ meeting, tasks = [] }) => {
  if (!meeting) return null;

  const status = meeting.status;
  const hasReschedule = Boolean(meeting.rescheduleRequest);
  const reschedulePending = hasReschedule && meeting.rescheduleRequest.reviewStatus === 'pending';
  const rescheduleResolved = hasReschedule && ['approved', 'rejected'].includes(meeting.rescheduleRequest.reviewStatus);

  const getStepStatus = (stepName) => {

    switch (stepName) {
      case 'scheduled':
        return 'completed';
      case 'reschedule':
        if (!hasReschedule) return 'pending';
        if (reschedulePending) return 'active';
        return 'completed';
      case 'review':
        if (!hasReschedule) return 'pending';
        if (reschedulePending) return 'active';
        return 'completed';
      case 'approval':
        if (status === 'approval_pending') return 'active';
        if (status === 'approved' || status === 'conducted' || status === 'closed') return 'completed';
        return 'pending';
      case 'conducted':
        if (status === 'conducted' || status === 'closed') return 'completed';
        if (status === 'approved') return 'active';
        return 'pending';
      case 'closed':
        if (status === 'closed') return 'completed';
        if (status === 'conducted') return 'active';
        return 'pending';
      case 'next':
        if (status === 'closed') return 'active';
        return 'pending';
      default:
        return 'pending';
    }
  };

  const steps = [
    {
      id: 'scheduled',
      title: 'Meeting Scheduled',
      description: `Event created and synced with ${meeting.provider} Calendar (${meeting.calendarEventId ? meeting.calendarEventId.substring(0, 12) + '...' : 'pending'})`,
      time: new Date(meeting.scheduledStart).toLocaleDateString(),
      icon: CheckCircle2,
    },
    {
      id: 'reschedule',
      title: 'Reschedule Request Submitted',
      description: hasReschedule
        ? `Customer requested a move to ${new Date(meeting.rescheduleRequest.requestedStart).toLocaleString()}`
        : 'No reschedule request has been submitted.',
      time: hasReschedule ? new Date(meeting.rescheduleRequest.requestedAt).toLocaleDateString() : null,
      icon: Calendar,
    },
    {
      id: 'review',
      title: 'Account Manager Review',
      description: hasReschedule
        ? reschedulePending
          ? 'Account Manager is reviewing the request.'
          : `Reschedule ${meeting.rescheduleRequest.reviewStatus}`
        : 'Ready for review once the meeting is triggered and tasks are generated.',
      time: hasReschedule && meeting.rescheduleRequest.reviewedAt ? new Date(meeting.rescheduleRequest.reviewedAt).toLocaleDateString() : null,
      icon: Cpu,
    },
    {
      id: 'approval',
      title: 'Approval & Remediation Review',
      description: getStepStatus('approval') === 'completed'
        ? 'All remediation tasks are approved and ready to be executed.'
        : 'Approval workflow is pending for generated remediation tasks.',
      time: status === 'approved' || status === 'conducted' || status === 'closed' ? new Date(meeting.triggerDate).toLocaleDateString() : null,
      icon: ShieldAlert,
    },
    {
      id: 'conducted',
      title: 'Meeting Conducted',
      description: getStepStatus('conducted') === 'completed'
        ? 'The monthly review meeting has been conducted.'
        : 'Awaiting scheduled meeting execution.',
      time: meeting.conductedAt ? new Date(meeting.conductedAt).toLocaleDateString() : null,
      icon: Sparkles,
    },
    {
      id: 'closed',
      title: 'Meeting Closed',
      description: getStepStatus('closed') === 'completed'
        ? 'Meeting cycle has been closed and the next month is scheduled automatically.'
        : 'Awaiting closure after conduct.',
      time: meeting.closedAt ? new Date(meeting.closedAt).toLocaleDateString() : null,
      icon: Send,
    },
    {
      id: 'next',
      title: 'Next Month Meeting Scheduled',
      description: getStepStatus('next') === 'active'
        ? 'A follow-up meeting has been created automatically for next month.'
        : 'Will be generated automatically once this meeting closes.',
      time: getStepStatus('next') === 'active' ? new Date().toLocaleDateString() : null,
      icon: Clock,
    }
  ];

  return (
    <div className="glass-panel p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Journey Execution Timeline</h3>
        <p className="text-xs text-slate-400">Chronological pipeline tracker from initial sync to final report compile</p>
      </div>

      <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-800">
        {steps.map((step) => {
          const status = getStepStatus(step.id);
          
          return (
            <div key={step.id} className="relative flex flex-col gap-1 text-xs">
              {/* Timeline dot indicator */}
              <span className={`absolute -left-6 top-1 w-4.5 h-4.5 rounded-full flex items-center justify-center border transition-all duration-300 ${
                status === 'completed' 
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                  : status === 'active'
                  ? 'bg-indigo-600/30 border-indigo-500 text-indigo-400 pulse-indicator'
                  : 'bg-slate-900 border-slate-800 text-slate-600'
              }`}>
                <step.icon className="w-2.5 h-2.5" />
              </span>

              {/* Step info */}
              <div className="flex items-center justify-between gap-4">
                <span className={`font-bold ${status === 'pending' ? 'text-slate-500' : 'text-slate-200'}`}>
                  {step.title}
                </span>
                {step.time && (
                  <span className="text-[10px] font-mono text-indigo-400">{step.time}</span>
                )}
              </div>
              <p className={`text-slate-400 font-medium ${status === 'pending' ? 'opacity-40' : ''}`}>
                {step.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
