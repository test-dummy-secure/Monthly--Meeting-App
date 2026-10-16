import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

const STATUS_DOT = {
  scheduled:        'bg-indigo-500',
  approval_pending: 'bg-amber-500',
  approved:         'bg-emerald-500',
  conducted:        'bg-sky-400',
  closed:           'bg-slate-500',
  rescheduled:      'bg-orange-400',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const WEEKDAYS = ['S','M','T','W','T','F','S'];

// `current` (the month being viewed) is a controlled prop, not internal state —
// lets a parent keep other UI (e.g. a header label) in sync with navigation
// if it ever needs to.
// `embedded`: drop the calendar's own card background/border/padding — used
// when a parent composes this inside its own shared container (e.g. side by
// side with another section, split by a single divider line) instead of
// rendering it as its own standalone boxed card.
export const CustomCalendar = ({ meetings = [], onMeetingClick, current, onNavigate, embedded = false }) => {
  // Which day cell's popover is open — index into `cells`, or null. Opens on
  // hover (desktop) and toggles on click/tap (touch, and a click fallback for
  // desktop users who don't hover first). Lives on the wrapper div around
  // each button+popover pair so moving the mouse from the day cell into the
  // popover itself doesn't register as a "leave" and close it.
  const [openDay, setOpenDay] = useState(null);

  const year  = current.getFullYear();
  const month = current.getMonth();
  const today = new Date();

  const isToday = (d) =>
    d.getDate()     === today.getDate()     &&
    d.getMonth()    === today.getMonth()    &&
    d.getFullYear() === today.getFullYear();

  const meetingsOnDay = (d) =>
    meetings.filter((m) => {
      const md = new Date(m.scheduledStart);
      return md.getDate()     === d.getDate()     &&
             md.getMonth()    === d.getMonth()    &&
             md.getFullYear() === d.getFullYear();
    });

  // Build cell array: leading blanks + dates
  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const selectMeeting = (m) => {
    setOpenDay(null);
    onMeetingClick && onMeetingClick(m);
  };

  return (
    <div className={`flex flex-col gap-4 w-full h-full ${embedded ? 'p-4' : 'glass-panel p-5'}`}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-300 tracking-wide">Journey Schedule</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setOpenDay(null); onNavigate(new Date(year, month - 1, 1)); }}
            className="p-1 rounded-md hover:bg-slate-800 text-slate-600 hover:text-slate-300 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-semibold text-slate-400 w-28 text-center select-none">
            {MONTHS[month]} {year}
          </span>
          <button
            onClick={() => { setOpenDay(null); onNavigate(new Date(year, month + 1, 1)); }}
            className="p-1 rounded-md hover:bg-slate-800 text-slate-600 hover:text-slate-300 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Weekday row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
            {d}
          </span>
        ))}
      </div>

      {/* ── Day grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;

          const dayMeetings = meetingsOnDay(date);
          const hasEvent    = dayMeetings.length > 0;
          const isTodayCell = isToday(date);
          const isOpen      = openDay === i;
          // Popover would run off the right edge for the last couple of
          // weekday columns — flip it to hang left instead of right there.
          const dow         = date.getDay();
          const hangLeft    = dow >= 5;

          return (
            <div
              key={i}
              className="relative"
              onMouseEnter={() => hasEvent && setOpenDay(i)}
              onMouseLeave={() => setOpenDay((cur) => (cur === i ? null : cur))}
            >
              <button
                type="button"
                disabled={!hasEvent}
                onClick={() => hasEvent && setOpenDay((cur) => (cur === i ? null : i))}
                aria-expanded={hasEvent ? isOpen : undefined}
                aria-haspopup={hasEvent ? 'true' : undefined}
                className={`
                  w-full flex flex-col items-center gap-0.5 py-0.5 rounded-lg transition-all
                  ${hasEvent ? 'cursor-pointer hover:bg-slate-800/50' : 'cursor-default'}
                  ${isOpen ? 'bg-slate-800/60' : ''}
                `}
              >
                {/* Date number */}
                <span
                  className={`
                    text-[11px] font-semibold w-6 h-6 flex items-center justify-center rounded-full transition-colors
                    ${isTodayCell
                      ? 'bg-indigo-500 text-white'
                      : hasEvent
                      ? 'text-slate-200'
                      : 'text-slate-600'
                    }
                  `}
                >
                  {date.getDate()}
                </span>

                {/* Status dots — up to 3 */}
                <div className="flex gap-0.5 h-1.5 items-center">
                  {dayMeetings.slice(0, 3).map((m) => (
                    <span
                      key={m.id}
                      className={`w-1 h-1 rounded-full ${STATUS_DOT[m.status] || 'bg-indigo-500'}`}
                    />
                  ))}
                </div>
              </button>

              {/* ── Hover/tap popover — lists every meeting on this day ── */}
              {hasEvent && isOpen && (
                <div
                  role="listbox"
                  className={`
                    absolute z-30 top-full mt-1 w-56 max-w-[80vw]
                    rounded-xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60
                    py-1.5 animate-slide-up
                    ${hangLeft ? 'right-0' : 'left-0'}
                  `}
                >
                  <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                    {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </p>
                  {dayMeetings.map((m) => {
                    const t = new Date(m.scheduledStart);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => selectMeeting(m)}
                        className="w-full flex items-start gap-2 text-left px-3 py-1.5 hover:bg-slate-800/60 transition-colors"
                      >
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[m.status] || 'bg-indigo-500'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-semibold text-slate-200 truncate leading-tight">
                            {m.title}
                          </span>
                          <span className="block text-[9px] text-slate-500 capitalize leading-tight mt-0.5">
                            {m.status?.replace(/_/g, ' ')}
                            {' · '}
                            {t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Legend ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-slate-800/40 mt-auto">
        {[
          ['scheduled', 'Scheduled'],
          ['conducted', 'Conducted'],
          ['closed',    'Closed'],
        ].map(([status, label]) => (
          <div key={status} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
            <span className="text-[9px] text-slate-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
