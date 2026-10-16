import React from 'react';
import { CalendarClock, CheckCircle2, ShieldAlert, ClipboardList, ArrowRight } from 'lucide-react';

const EVENT_ICONS = {
  meeting: CalendarClock,
  summary: CheckCircle2,
  finding: ShieldAlert,
  task: ClipboardList
};

export const MeetingTimelineView = ({ meetingLog }) => {
  if (!meetingLog) {
    return null;
  }

  const stages = [
    {
      key: 'meeting',
      label: 'Meeting Held',
      detail: `${meetingLog.meetingType} with ${meetingLog.customer || 'selected tenant'}`,
    },
    {
      key: 'summary',
      label: 'AI / Human Summary',
      detail: meetingLog.meetingSummary || meetingLog.meetingNotes || 'Summary unavailable',
    },
    {
      key: 'finding',
      label: 'Findings Discussed',
      detail: `${(meetingLog.findingsDiscussed || []).length} findings reviewed`,
    },
    {
      key: 'task',
      label: 'Tasks and Follow-Up',
      detail: `${(meetingLog.tasksDiscussed || []).length} tasks captured`,
    },
  ];

  return (
    <div className="glass-panel p-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Timeline</p>
          <h3 className="text-lg font-bold text-white">Meeting Intelligence Flow</h3>
        </div>
      </div>
      <div className="mt-5 space-y-4">
        {stages.map((stage, index) => {
          const Icon = EVENT_ICONS[stage.key] || CalendarClock;
          return (
            <div key={stage.key} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-indigo-400">
                  <Icon className="h-4 w-4" />
                </div>
                {index < stages.length - 1 && <div className="h-10 w-px bg-slate-800" />}
              </div>
              <div className="flex-1 pb-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">{stage.label}</h4>
                  <ArrowRight className="h-3 w-3 text-slate-600" />
                </div>
                <p className="mt-1 text-sm text-slate-400">{stage.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
