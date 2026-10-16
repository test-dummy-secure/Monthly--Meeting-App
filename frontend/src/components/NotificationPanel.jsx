import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, AlertTriangle, AlertCircle, FileText, CheckCheck } from 'lucide-react';
import { api } from '../services/api';

// ── Type metadata ─────────────────────────────────────────────────────────────
const TYPE_CFG = {
  carry_forward_warning:    { Icon: AlertTriangle, color: 'text-amber-400',  bg: 'bg-amber-500/10',   label: 'Warning' },
  carry_forward_alert:      { Icon: AlertCircle,   color: 'text-red-400',    bg: 'bg-red-500/10',     label: 'Alert' },
  auto_escalation_assigned: { Icon: AlertCircle,   color: 'text-red-400',    bg: 'bg-red-500/10',     label: 'Escalation' },
  auto_escalation_notice:   { Icon: AlertCircle,   color: 'text-orange-400', bg: 'bg-orange-500/10',  label: 'Escalation' },
  weekly_report_generated:  { Icon: FileText,      color: 'text-sky-400',    bg: 'bg-sky-500/10',     label: 'Report' },
  monthly_report_generated: { Icon: FileText,      color: 'text-indigo-400', bg: 'bg-indigo-500/10',  label: 'Report' },
};

const DEFAULT_CFG = { Icon: Bell, color: 'text-slate-400', bg: 'bg-slate-700/40', label: 'Notice' };

// localStorage key for tracking when the user last opened the panel
const SEEN_KEY = 'nxg_notif_seen_at';

function getSeenAt() {
  const v = localStorage.getItem(SEEN_KEY);
  return v ? new Date(v) : null;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export const NotificationPanel = () => {
  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [unread,        setUnread]        = useState(0);
  const panelRef = useRef(null);

  // Count notifications newer than the last-seen timestamp
  const computeUnread = useCallback((notifs) => {
    const seenAt = getSeenAt();
    if (!seenAt) return Math.min(notifs.length, 9);
    return notifs.filter((n) => new Date(n.createdAt) > seenAt).length;
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.notifications.getMyNotifications();
      const list = data.notifications || [];
      setNotifications(list);
      setUnread(computeUnread(list));
    } catch {
      // bell stays visible; unread count stays as-is
    } finally {
      setLoading(false);
    }
  }, [computeUnread]);

  // Initial load + 60-second poll
  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      // Refresh on open + mark all as seen
      fetchNotifications().then(() => {
        localStorage.setItem(SEEN_KEY, new Date().toISOString());
        setUnread(0);
      });
    }
  };

  const markAllRead = () => {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
    setUnread(0);
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* ── Bell button ───────────────────────────────────────────── */}
      <button
        onClick={handleToggle}
        title="Notifications"
        className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* ── Floating panel ───────────────────────────────────────── */}
      {open && (
        <div className="absolute bottom-12 left-0 w-[22rem] glass-panel border border-slate-700/60 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-bold text-slate-200">Notifications</span>
              {notifications.length > 0 && (
                <span className="text-[10px] text-slate-500 font-medium">
                  ({notifications.length})
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-600 hover:text-slate-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto max-h-80 divide-y divide-slate-800/40 flex-1">
            {loading ? (
              <div className="py-8 flex flex-col items-center gap-2">
                <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] text-slate-500">Loading…</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2 text-slate-500">
                <Bell className="w-8 h-8 opacity-30" />
                <span className="text-xs">No notifications</span>
              </div>
            ) : (
              notifications.map((n) => {
                const cfg  = TYPE_CFG[n.type] || DEFAULT_CFG;
                const Icon = cfg.Icon;
                const seenAt = getSeenAt();
                const isNew = seenAt ? new Date(n.createdAt) > seenAt : false;

                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 px-4 py-3 transition-colors hover:bg-slate-800/30 ${
                      isNew ? 'bg-indigo-950/10' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className={`mt-0.5 p-1.5 rounded-lg ${cfg.bg} shrink-0`}>
                      <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                    </div>

                    {/* Content */}
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-slate-200 leading-snug line-clamp-2">
                        {n.title}
                      </p>
                      <p className="text-[10px] text-slate-500 leading-snug line-clamp-2">
                        {n.body}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        {n.tenantName && (
                          <span className="text-[9px] text-slate-600 truncate max-w-[90px]">
                            {n.tenantName}
                          </span>
                        )}
                        <span className="text-[9px] text-slate-600 ml-auto shrink-0 whitespace-nowrap">
                          {fmtDate(n.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* New indicator */}
                    {isNew && (
                      <div className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-slate-800/80 flex items-center justify-between shrink-0">
            <span className="text-[10px] text-slate-600">
              {notifications.length} total
            </span>
            {unread > 0 ? (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </button>
            ) : (
              <span className="text-[10px] text-slate-600 flex items-center gap-1">
                <CheckCheck className="w-3 h-3 text-emerald-600" />
                All caught up
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
