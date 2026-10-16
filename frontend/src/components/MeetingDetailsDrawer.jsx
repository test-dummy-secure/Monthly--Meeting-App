import React from 'react';
import { X, Calendar, Clock, Users, ClipboardList, ShieldAlert, Sparkles } from 'lucide-react';

// ─── Attendee helpers ─────────────────────────────────────────────────────────
const getAttendeeName = (a) => {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return a.name || a.email || String(a);
};
const getAttendeeEmail = (a) => {
  if (!a) return '';
  if (typeof a === 'string') return a.includes('@') ? a : '';
  return a.email || '';
};
const getAttendeeInitials = (a) =>
  getAttendeeName(a).split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?';

const GENERIC_SPEAKER_NAMES = new Set(['speaker', 'unknown', 'participant', 'guest', 'attendee']);

const splitAttendees = (attendees = [], accountManager = '') => {
  const nxg = [];
  const customer = [];
  (attendees || []).forEach((a) => {
    const email = getAttendeeEmail(a).toLowerCase();
    const name  = getAttendeeName(a);
    // Drop generic Fireflies placeholder names
    if (GENERIC_SPEAKER_NAMES.has((name || '').toLowerCase().trim())) return;
    if (name && accountManager && name.toLowerCase() === accountManager.toLowerCase()) return;
    const isInternal =
      a.isInternal === true ||         // backend-enriched flag
      email.includes('nxgsecure.com'); // domain fallback
    if (isInternal) nxg.push(a);
    else customer.push(a);
  });
  return { nxg, customer };
};

export const MeetingDetailsDrawer = ({ meetingLog, isOpen, onClose }) => {
  if (!isOpen || !meetingLog) {
    return null;
  }

  const meetingDate = new Date(meetingLog.meetingDate);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#1A1814]/60 backdrop-blur-sm">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close meeting drawer" />
      <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Meeting Log</p>
            <h2 className="mt-1 text-2xl font-extrabold text-white">{meetingLog.customer || 'Meeting'}</h2>
            <p className="mt-1 text-sm text-slate-400">{meetingLog.meetingSummary || meetingLog.meetingNotes || 'Meeting recap unavailable.'}</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-800 p-2 text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="glass-panel p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <Calendar className="h-4 w-4 text-indigo-400" /> Meeting Info
            </div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <p><span className="text-slate-500">Date:</span> {meetingDate.toLocaleDateString()}</p>
              <p><span className="text-slate-500">Time:</span> {meetingDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              <p><span className="text-slate-500">Duration:</span> {meetingLog.meetingDuration || 60} mins</p>
              <p><span className="text-slate-500">Type:</span> {meetingLog.meetingType}</p>
              <p><span className="text-slate-500">Status:</span> {meetingLog.meetingStatus}</p>
            </div>
          </div>

          <div className="glass-panel p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <Users className="h-4 w-4 text-sky-400" /> Participants
            </div>
            <div className="mt-3 space-y-2">
              {(() => {
                const { nxg, customer } = splitAttendees(meetingLog.attendees, meetingLog.accountManager);
                const renderChip = (a, idx, avatarCls, nameCls) => (
                  <div key={idx} className="flex items-center gap-1.5 shrink-0 min-w-0">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${avatarCls}`}>
                      {getAttendeeInitials(a)}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[11px] font-semibold truncate max-w-[120px] ${nameCls}`}>{getAttendeeName(a)}</p>
                      {a?.email && <p className="text-[9px] text-slate-600 truncate max-w-[120px]">{a.email}</p>}
                    </div>
                  </div>
                );
                return (
                  <>
                    {/* ── NxGSecure Team (stacked, full width) ── */}
                    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-2.5">
                      <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider mb-2">🛡 NxGSecure Team</p>
                      <div className="flex flex-wrap gap-2.5">
                        {/* AM pinned first */}
                        <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[9px] font-bold text-indigo-400 shrink-0">
                            {(meetingLog.accountManager || 'AM').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0,2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-slate-200 truncate max-w-[120px]">{meetingLog.accountManager || 'Account Manager'}</p>
                            <span className="text-[8px] px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-bold uppercase tracking-wide">AM Lead</span>
                          </div>
                        </div>
                        {nxg.map((a, idx) => renderChip(a, idx, 'bg-indigo-500/15 border border-indigo-500/25 text-indigo-400', 'text-slate-200'))}
                      </div>
                    </div>
                    {/* ── Customer Side (stacked, full width) ── */}
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5">
                      <p className="text-[9px] font-bold text-sky-400 uppercase tracking-wider mb-2">👥 Customer Side</p>
                      {customer.length === 0 ? (
                        <p className="text-[9px] text-slate-600 italic">No customer attendees captured yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2.5">
                          {customer.map((a, idx) => renderChip(a, idx, 'bg-sky-500/15 border border-sky-500/25 text-sky-400', 'text-slate-200'))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="glass-panel p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <ShieldAlert className="h-4 w-4 text-red-400" /> Findings
            </div>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {(meetingLog.findingsDiscussed || []).map((finding) => (
                <li key={finding.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                  <p className="font-semibold text-white">{finding.title}</p>
                  <p className="text-xs text-slate-500">{finding.severity} · {finding.category}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-panel p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <ClipboardList className="h-4 w-4 text-emerald-400" /> Tasks
            </div>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {(meetingLog.tasksDiscussed || []).map((task) => (
                <li key={task.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                  <p className="font-semibold text-white">{task.title}</p>
                  <p className="text-xs text-slate-500">{task.ownerName || task.owner || 'Unassigned'} · {task.status || task.remediationStatus}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-4 glass-panel p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
            <Sparkles className="h-4 w-4 text-indigo-400" /> Action Items and Follow-Up
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold text-white">Action Items</p>
              <ul className="space-y-2 text-sm text-slate-300">
                {(meetingLog.actionItems || []).map((item, index) => (
                  <li key={index} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-white">Follow-Up</p>
              <ul className="space-y-2 text-sm text-slate-300">
                {(meetingLog.followUpActions || []).map((item, index) => (
                  <li key={index} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
