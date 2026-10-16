import React, { useState } from 'react';

// Unlike the overlapping flags in CriticalAttention, every task has exactly
// ONE remediation_status value — these counts genuinely sum to the total, so
// a donut is honest here.
//
// Colors + surface, corrected: this app's tailwind.config.js remaps `slate`
// and `indigo` entirely to its own warm-cream brand scale, and sets no
// darkMode option — so a generic `bg-white dark:bg-gray-800` card (what this
// component used before) never actually matches the app's real surface
// (always light cream, `cyber.card` #FDFAF5) and can render as a jarring
// dark card on a light page for any viewer whose OS is set to dark mode.
// Rebuilt on the app's real, literal cream tokens (matching Sidebar.jsx's
// own convention of arbitrary-value hex rather than the remapped names).
//
// Status colors are this app's own designated semantic tokens
// (cyber.success/danger/warning/info) — re-validated against the real card
// surface (#FDFAF5, light mode) rather than the dark reference surface used
// during earlier iteration. "Carried Forward" uses info-blue rather than a
// gold/orange shade — on this light surface, every gold/orange candidate
// either failed contrast (too pale) or collided with warning-amber; blue
// was the only role-appropriate hue that passed cleanly.
const STATUS_META = {
  completed:            { label: 'Completed',        color: '#16a34a', group: 'completed' }, // cyber.success
  closed:               { label: 'Closed',            color: '#16a34a', group: 'completed' }, // cyber.success
  escalated:            { label: 'Escalated',         color: '#dc2626', group: 'escalated'  }, // cyber.danger
  overdue:              { label: 'Overdue',           color: '#d97706', group: 'overdue'    }, // cyber.warning
  carry_forward:        { label: 'Carried Forward',    color: '#0284c7', group: 'carry_forward' }, // cyber.info
  open:                 { label: 'Other',              color: '#6B6358', group: 'other' }, // cyber.muted
  in_progress:          { label: 'Other',              color: '#6B6358', group: 'other' },
  awaiting_validation:  { label: 'Other',              color: '#6B6358', group: 'other' },
  blocked:              { label: 'Other',              color: '#6B6358', group: 'other' },
  cancelled:            { label: 'Other',              color: '#6B6358', group: 'other' },
};

const R = 70;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * R;

export default function TaskStatusDonut({ remediationStatusCounts, taskList }) {
  const [hovered, setHovered] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

  const counts = remediationStatusCounts || {};
  const tasks = taskList || [];

  // Merge into display groups (the 6 distinct colors above) before drawing —
  // "Other" combines whichever of awaiting_validation/blocked/cancelled
  // actually have tasks, as one slice, one legend row, one color.
  const grouped = Object.entries(counts).reduce((acc, [status, value]) => {
    const meta = STATUS_META[status] || { label: status, color: '#6B6358', group: status };
    if (!acc[meta.group]) acc[meta.group] = { ...meta, value: 0, statuses: [] };
    acc[meta.group].value += value;
    acc[meta.group].statuses.push(status);
    return acc;
  }, {});

  const entries = Object.values(grouped).filter((g) => g.value > 0);
  const total = entries.reduce((sum, g) => sum + g.value, 0);

  if (total === 0) {
    return (
      <div className="bg-[#FDFAF5] border border-[#D8D2C4] rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-1 text-[#1A1814]">Task Status Distribution</h3>
        <p className="text-sm text-[#6B6358] text-center py-10">No tasks tracked yet for this tenant.</p>
      </div>
    );
  }

  let cumulative = 0;
  const segments = entries.map((g) => {
    const pct = g.value / total;
    const segLen = pct * CIRCUMFERENCE;
    const seg = { ...g, pct, dasharray: `${segLen} ${CIRCUMFERENCE - segLen}`, dashoffset: -cumulative };
    cumulative += segLen;
    return seg;
  });

  const selected = entries.find((g) => g.group === selectedGroup) || null;
  const selectedTasks = selected
    ? tasks.filter((t) => selected.statuses.includes(t.remediationStatus))
    : [];

  const handleActivate = (group) => setSelectedGroup((cur) => (cur === group ? null : group));

  return (
    <div className="bg-[#FDFAF5] border border-[#D8D2C4] rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-semibold mb-1 text-[#1A1814]">Task Status Distribution</h3>
      <p className="text-xs text-[#6B6358] mb-5">
        Every task counted once, by its current stage — click a slice or legend row to see which tasks it covers.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="relative shrink-0" style={{ width: 200, height: 200 }}>
          <svg width="200" height="200" viewBox="0 0 200 200">
            <g transform="rotate(-90 100 100)">
              <circle cx="100" cy="100" r={R} fill="none" stroke="#EDE8DC" strokeWidth={STROKE} />
              {segments.map((seg) => {
                const isActive = hovered === seg.group || selectedGroup === seg.group;
                return (
                  <circle
                    key={seg.group}
                    cx="100" cy="100" r={R}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={isActive ? STROKE + 4 : STROKE}
                    strokeDasharray={seg.dasharray}
                    strokeDashoffset={seg.dashoffset}
                    opacity={selectedGroup && selectedGroup !== seg.group ? 0.35 : 1}
                    onMouseEnter={() => setHovered(seg.group)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => handleActivate(seg.group)}
                    className="transition-[stroke-width,opacity] duration-150 cursor-pointer"
                    style={{ strokeLinecap: 'butt' }}
                  >
                    <title>{seg.label}: {seg.value} ({Math.round(seg.pct * 100)}%) — click for task list</title>
                  </circle>
                );
              })}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-3xl font-bold text-[#1A1814] tabular-nums">
              {hovered ? entries.find((g) => g.group === hovered)?.value : (selected ? selected.value : total)}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[#6B6358] font-semibold">
              {hovered ? (entries.find((g) => g.group === hovered)?.label) : (selected ? selected.label : 'Total Tasks')}
            </span>
          </div>
        </div>

        {/* Legend — the dependable identity channel, present for every slice.
            Each row is itself a click target, same as the ring segment. */}
        <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {segments.map((seg) => (
            <button
              key={seg.group}
              type="button"
              onMouseEnter={() => setHovered(seg.group)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => handleActivate(seg.group)}
              aria-pressed={selectedGroup === seg.group}
              className={`flex items-center gap-2 text-left px-2 py-1.5 rounded-lg transition-colors ${
                selectedGroup === seg.group ? 'bg-[#FAE8B8]/50 ring-1 ring-[#B8872A]/50' : hovered === seg.group ? 'bg-[#F5F1E8]' : ''
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="text-xs text-[#4A4239] flex-1 truncate">{seg.label}</span>
              <span className="text-xs font-bold text-[#1A1814] tabular-nums">{seg.value}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Drill-down — the actual tasks behind the selected slice */}
      {selected && (
        <div className="mt-5 pt-4 border-t border-[#E4DFCF]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[#4A4239]">
              {selected.label} <span className="text-[#A89E90] font-normal">({selected.value} task{selected.value === 1 ? '' : 's'})</span>
            </p>
            <button
              type="button"
              onClick={() => setSelectedGroup(null)}
              className="text-[11px] font-medium text-[#A89E90] hover:text-[#4A4239]"
            >
              Close
            </button>
          </div>
          {selectedTasks.length > 0 ? (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {selectedTasks.slice(0, 8).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#F5F1E8]">
                  <span className="text-xs font-medium text-[#1A1814] truncate">{t.title || 'Untitled task'}</span>
                  <span className="text-[11px] text-[#A89E90] shrink-0">{t.ownerName || 'Unassigned'}</span>
                </div>
              ))}
              {selectedTasks.length > 8 && (
                <p className="text-[11px] text-[#A89E90] text-center pt-1">+{selectedTasks.length - 8} more not shown</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-[#A89E90]">Task-level detail isn&rsquo;t loaded for this view.</p>
          )}
        </div>
      )}
    </div>
  );
}
