import React from 'react';
import { AlertTriangle, Clock, ShieldAlert, ShieldQuestion } from 'lucide-react';

// Purpose-built for the "what needs my attention right now" scan an AM or
// manager actually does — not a full breakdown (that's the donut next to
// this), just the four signals that mean "look here first." A bar list, not
// a chart of proportions: these four counts are independent of each other
// (a task can be both overdue AND escalated), so they're not parts of a
// whole — same reasoning as the old Task Pipeline view, now scoped to just
// the rows that matter for urgency.
//
// Surface + colors: built on the app's real, literal cream tokens (see
// TaskStatusDonut.jsx for why — this app's `dark:` variants are disconnected
// from its own always-light theme) and its own designated cyber.danger /
// cyber.warning semantic colors, validated against the real card surface.
export default function CriticalAttention({ taskStatusCounts, findingsSeverityCounts }) {
  const ts = taskStatusCounts || {};
  const fs = findingsSeverityCounts || {};

  const rows = [
    { key: 'escalated', label: 'Escalated Tasks',   value: ts.escalated || 0, icon: AlertTriangle, tone: 'critical', hint: 'Has at least one escalation event' },
    { key: 'critical',  label: 'Critical Findings',  value: fs.critical  || 0, icon: ShieldAlert,   tone: 'critical', hint: 'Highest-severity, unresolved' },
    { key: 'overdue',   label: 'Overdue Tasks',      value: ts.overdue   || 0, icon: Clock,         tone: 'warning',  hint: 'Past due date, not yet closed' },
    { key: 'high',      label: 'High Findings',      value: fs.high      || 0, icon: ShieldQuestion, tone: 'warning', hint: 'High-severity, unresolved' },
  ];

  const max = Math.max(1, ...rows.map((r) => r.value));
  const allClear = rows.every((r) => r.value === 0);

  const TONE = {
    critical: { bar: '#dc2626', chip: 'text-[#dc2626]' }, // cyber.danger
    warning:  { bar: '#d97706', chip: 'text-[#d97706]' }, // cyber.warning
  };

  return (
    <div className="bg-[#FDFAF5] border border-[#D8D2C4] rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-semibold mb-1 text-[#1A1814]">Needs Attention</h3>
      <p className="text-xs text-[#6B6358] mb-5">
        The four signals worth checking first for this tenant.
      </p>

      {allClear ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-[#16a34a]/15 flex items-center justify-center mb-2">
            <span className="text-[#16a34a] text-lg">✓</span>
          </div>
          <p className="text-sm font-semibold text-[#1A1814]">Nothing urgent right now</p>
          <p className="text-xs text-[#6B6358] mt-0.5">No overdue, escalated, or high/critical findings.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const Icon = row.icon;
            const pct = Math.round((row.value / max) * 100);
            const tone = TONE[row.tone];
            return (
              <div key={row.key} title={row.hint}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-[#4A4239]">
                    <Icon className={`w-3.5 h-3.5 ${tone.chip}`} />
                    {row.label}
                  </span>
                  <span className={`text-sm font-bold tabular-nums ${row.value > 0 ? tone.chip : 'text-[#A89E90]'}`}>
                    {row.value}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-[#EDE8DC] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: row.value > 0 ? `${Math.max(pct, 6)}%` : '0%', backgroundColor: tone.bar }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
