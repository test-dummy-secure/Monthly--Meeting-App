import React from 'react';

// ─── Status Config ────────────────────────────────────────────
const STATUS_CONFIG = {
  open: {
    label: 'Open',
    bg: 'bg-slate-700/60',
    text: 'text-slate-300',
    border: 'border-slate-600/50',
    dot: 'bg-slate-400',
    ring: 'ring-slate-500/30',
  },
  in_progress: {
    label: 'In Progress',
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    dot: 'bg-blue-400',
    ring: 'ring-blue-500/30',
  },
  blocked: {
    label: 'Blocked',
    bg: 'bg-purple-500/15',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    dot: 'bg-purple-400',
    ring: 'ring-purple-500/30',
  },
  awaiting_validation: {
    label: 'Awaiting Validation',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    dot: 'bg-amber-400',
    ring: 'ring-amber-500/30',
  },
  completed: {
    label: 'Completed',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-400',
    ring: 'ring-emerald-500/30',
  },
  escalated: {
    label: 'Escalated',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    border: 'border-red-500/30',
    dot: 'bg-red-400',
    ring: 'ring-red-500/30',
  },
  overdue: {
    label: 'Overdue',
    bg: 'bg-rose-500/15',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    dot: 'bg-rose-500',
    ring: 'ring-rose-500/30',
  },
};

export const StatusBadge = ({ status, size = 'md', showDot = true, className = '' }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open;

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-semibold rounded-full border
        ${config.bg} ${config.text} ${config.border}
        ${sizeClasses[size] || sizeClasses.md}
        ${className}
      `}
    >
      {showDot && (
        <span
          className={`
            rounded-full shrink-0
            ${config.dot}
            ${size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'}
            ${status === 'in_progress' ? 'animate-pulse' : ''}
          `}
        />
      )}
      {config.label}
    </span>
  );
};

// ─── Severity Config ─────────────────────────────────────────
const SEVERITY_CONFIG = {
  critical: {
    label: 'Critical',
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: '◆',
    order: 0,
  },
  high: {
    label: 'High',
    bg: 'bg-orange-500/15',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    icon: '▲',
    order: 1,
  },
  medium: {
    label: 'Medium',
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    icon: '●',
    order: 2,
  },
  low: {
    label: 'Low',
    bg: 'bg-sky-500/15',
    text: 'text-sky-400',
    border: 'border-sky-500/30',
    icon: '▼',
    order: 3,
  },
  informational: {
    label: 'Info',
    bg: 'bg-slate-500/15',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
    icon: 'ℹ',
    order: 4,
  },
};

export const SeverityBadge = ({ severity, size = 'md', showIcon = true, className = '' }) => {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.low;

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1 font-bold rounded-full border uppercase tracking-wide
        ${config.bg} ${config.text} ${config.border}
        ${sizeClasses[size] || sizeClasses.md}
        ${className}
      `}
    >
      {showIcon && <span className="text-[9px]">{config.icon}</span>}
      {config.label}
    </span>
  );
};

export { STATUS_CONFIG, SEVERITY_CONFIG };
