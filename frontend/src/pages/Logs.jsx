import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { useTenant } from '../context/TenantContext';
import { TenantSelector } from '../components/TenantSelector';
import MeetingNotesPanel from '../components/MeetingNotesPanel';
import AiTaskRecommendationsPanel from '../components/AiTaskRecommendationsPanel';
import {
  Calendar, Clock, Users, FileText, ShieldAlert, ClipboardList,
  ArrowUpRight, AlertTriangle, CheckCircle2, RefreshCw, GitBranch,
  Info, Hash, Building2, MessageSquare, Activity, Save, Upload,
  Download, Paperclip, PenLine, Link2, Edit2,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────
// Attendees (and similar fields) can arrive as plain strings OR as
// {name, role, email} objects depending on how they were stored.
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

// Generic placeholder names Fireflies/Teams assign when a speaker is unidentified.
// These carry no real identity — filter them out before splitting sides.
const GENERIC_SPEAKER_NAMES = new Set(['speaker', 'unknown', 'participant', 'guest', 'attendee']);

// Split attendees into NxGSecure team vs Customer side.
// Priority order for "is this person internal?":
//   1. a.isInternal flag set by the backend (cross-referenced against users table)
//   2. @nxgsecure.com email domain (fallback for older records without the flag)
//   3. name matches accountManager (dedup — AM is always pinned at top)
const splitAttendees = (attendees = [], accountManager = '') => {
  const nxg = [];
  const customer = [];
  (attendees || []).forEach((a) => {
    const email = getAttendeeEmail(a).toLowerCase();
    const name  = getAttendeeName(a);
    // Drop generic Fireflies placeholder names (unidentified speakers)
    if (GENERIC_SPEAKER_NAMES.has((name || '').toLowerCase().trim())) return;
    // Skip if this is the AM — rendered separately as the pinned top card
    if (name && accountManager && name.toLowerCase() === accountManager.toLowerCase()) return;
    // Determine side
    const isInternal =
      a.isInternal === true ||                    // backend-enriched flag
      email.includes('nxgsecure.com');            // domain fallback
    if (isInternal) {
      nxg.push(a);
    } else {
      customer.push(a);
    }
  });
  return { nxg, customer };
};

// Safely coerce any array item to a display string.
const asString = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.text || v.value || v.name || v.title || JSON.stringify(v);
  return String(v);
};

// ─── Status badge ─────────────────────────────────────────────
const StatusPill = ({ status }) => {
  const styles = {
    completed:        'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    conducted:        'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    scheduled:        'bg-indigo-500/15 text-indigo-400 border-indigo-500/20',
    closed:           'bg-slate-600/30 text-slate-400 border-slate-700/50',
    rescheduled:      'bg-amber-500/15 text-amber-400 border-amber-500/20',
    approval_pending: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
  };
  return (
    <span className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wide ${styles[status] || styles.scheduled}`}>
      {status?.replace(/_/g, ' ') || 'Unknown'}
    </span>
  );
};

// ─── Severity dot ─────────────────────────────────────────────
const SEV_DOT = { critical: 'bg-rose-400', high: 'bg-amber-400', medium: 'bg-indigo-400', low: 'bg-slate-500' };

// ─── Meeting list item ────────────────────────────────────────
const MeetingListItem = ({ log, seqNum, isSelected, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full text-left px-4 py-3 border-b border-slate-800/60 transition-all ${
      isSelected
        ? 'bg-indigo-600/10 border-l-2 border-l-indigo-500'
        : 'hover:bg-slate-800/30 border-l-2 border-l-transparent'
    }`}
  >
    <div className="flex items-center justify-between gap-2 mb-1">
      <div className="flex items-center gap-1.5 min-w-0">
        {seqNum && (
          <span className="text-[9px] font-mono text-indigo-500 shrink-0">#{String(seqNum).padStart(3, '0')}</span>
        )}
        <span className="text-[10px] font-mono text-slate-500 truncate">{log.meetingId || log.id}</span>
      </div>
      <StatusPill status={log.meetingStatus || log.status} />
    </div>
    <p className="text-xs font-semibold text-slate-200 line-clamp-1">{log.customer || 'Unknown Tenant'}</p>
    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500">
      <span className="flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        {new Date(log.meetingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
      </span>
      <span className="flex items-center gap-1">
        <Clock className="w-3 h-3" />
        {log.meetingDuration || 60} min
      </span>
      <span className="flex items-center gap-1">
        <Users className="w-3 h-3" />
        {(log.attendees || []).length + 1}
      </span>
    </div>
  </button>
);

// ─── Section card ─────────────────────────────────────────────
const Section = ({ icon: Icon, iconColor, title, children, badge, action }) => (
  <div className="glass-panel p-5 space-y-3">
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} /> {title}
      </h3>
      <div className="flex items-center gap-2">
        {action}
        {badge !== undefined && (
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-semibold border border-slate-700/50">
            {badge}
          </span>
        )}
      </div>
    </div>
    {children}
  </div>
);

const Empty = ({ message }) => (
  <p className="text-xs text-slate-600 italic py-2">{message}</p>
);

// ─── Notes Editor ─────────────────────────────────────────────
const NotesEditor = ({ meetingId, tenantId, initialNotes, onSaved }) => {
  const [summary,        setSummary]        = useState(asString(initialNotes?.meetingSummary || initialNotes?.summary || ''));
  const [actionItems,    setActionItems]    = useState((initialNotes?.actionItems    || []).map(asString).join('\n'));
  const [followUps,      setFollowUps]      = useState((initialNotes?.followUpActions || []).map(asString).join('\n'));
  const [decisions,      setDecisions]      = useState((initialNotes?.decisionsTaken || []).map(asString).join('\n'));
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState('');

  const parseLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const saved = await api.meetingLogs.save(meetingId, {
        sourceType:      'manual_entry',
        meetingSummary:  summary,
        summary,
        actionItems:     parseLines(actionItems),
        followUpActions: parseLines(followUps),
        decisionsTaken:  parseLines(decisions),
      });
      setSaveMsg('Notes saved.');
      if (onSaved) onSaved(saved);
    } catch (err) {
      setSaveMsg('Save failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Meeting Summary</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          placeholder="Write a summary of what was discussed…"
          className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Action Items (one per line)</label>
          <textarea
            value={actionItems}
            onChange={(e) => setActionItems(e.target.value)}
            rows={4}
            placeholder="Deploy patch to DC-01&#10;Review firewall rules…"
            className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Follow-up Actions</label>
          <textarea
            value={followUps}
            onChange={(e) => setFollowUps(e.target.value)}
            rows={4}
            placeholder="Schedule next review&#10;Send patch report…"
            className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Decisions Taken</label>
          <textarea
            value={decisions}
            onChange={(e) => setDecisions(e.target.value)}
            rows={4}
            placeholder="Approved rollout to prod&#10;Deferred MFA project…"
            className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
          />
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        {saveMsg ? (
          <span className={`text-[11px] font-semibold ${saveMsg.startsWith('Save failed') ? 'text-rose-400' : 'text-emerald-400'}`}>
            {saveMsg}
          </span>
        ) : <span />}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
};

// ─── MOM Upload Panel ─────────────────────────────────────────
const MOMUpload = ({ meetingId, tenantId }) => {
  const fileRef              = useRef(null);
  const [files,   setFiles]  = useState([]);
  const [loading, setLoading]= useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  const loadFiles = useCallback(async () => {
    if (!meetingId || !tenantId) return;
    setLoading(true);
    try {
      const res = await api.meetingLogs.files(meetingId);
      setFiles(res.files || []);
    } catch { setFiles([]); }
    finally { setLoading(false); }
  }, [meetingId, tenantId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.meetingLogs.upload(meetingId, fd);
      setUploadMsg('File uploaded.');
      await loadFiles();
    } catch (err) {
      setUploadMsg('Upload failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      setTimeout(() => setUploadMsg(''), 4000);
    }
  };

  const handleDownload = async (file) => {
    try {
      const blob = await api.meetingLogs.downloadFile(meetingId, file.id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = file.originalName || file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed', err);
    }
  };

  const fmtSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Upload control */}
      <div className="flex items-center gap-3">
        <label className={`flex items-center gap-2 cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold px-4 py-2 rounded-lg transition-colors ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
          <Upload className="w-3.5 h-3.5" />
          {uploading ? 'Uploading…' : 'Upload MOM File'}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
        <span className="text-[10px] text-slate-600">PDF, DOCX, or TXT — max 10 MB</span>
        {uploadMsg && (
          <span className={`text-[11px] font-semibold ${uploadMsg.startsWith('Upload failed') ? 'text-rose-400' : 'text-emerald-400'}`}>
            {uploadMsg}
          </span>
        )}
      </div>

      {/* File list */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading files…
        </div>
      ) : files.length === 0 ? (
        <Empty message="No MOM documents uploaded for this meeting." />
      ) : (
        <div className="space-y-1.5">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 bg-slate-900/40 border border-slate-800/60 rounded-lg px-3 py-2">
              <Paperclip className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{f.originalName || f.fileName}</p>
                <p className="text-[10px] text-slate-500">
                  {f.mimeType?.split('/').pop()?.toUpperCase() || 'FILE'} · {fmtSize(f.fileSizeBytes)} ·{' '}
                  {new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                  {f.uploadedBy && ` · ${f.uploadedBy}`}
                </p>
              </div>
              <button
                onClick={() => handleDownload(f)}
                className="shrink-0 flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold border border-indigo-500/20 hover:border-indigo-500/40 px-2 py-1 rounded-lg transition-colors"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Notes Source Panel ───────────────────────────────────────
const PROVIDER_OPTS = [
  { value: 'MANUAL',          label: 'Manual Notes' },
  { value: 'UPLOAD',          label: 'Manual Upload' },
  { value: 'FIREFLIES',       label: 'Fireflies AI' },
  { value: 'MICROSOFT_TEAMS', label: 'Microsoft Teams' },
];

const BUILTIN_TYPES = new Set(['MANUAL', 'UPLOAD']);

const NotesSourcePanel = ({ meetingId }) => {
  const [selected,       setSelected]       = useState('MANUAL');
  const [mapping,        setMapping]        = useState(null);
  const [providerStatus, setProviderStatus] = useState([]);
  const [saving,         setSaving]         = useState(false);
  const [syncing,        setSyncing]        = useState(false);
  const [msg,            setMsg]            = useState('');
  const [loadedMeetingId, setLoadedMeetingId] = useState(null);

  useEffect(() => {
    if (!meetingId || meetingId === loadedMeetingId) return;
    setLoadedMeetingId(meetingId);
    let cancelled = false;

    (async () => {
      try {
        const [m, s] = await Promise.all([
          api.providers.getMeetingMapping(meetingId),
          api.providers.getStatus(),
        ]);
        if (cancelled) return;
        setMapping(m);
        setProviderStatus(s || []);
        if (m?.providerType) setSelected(m.providerType);
      } catch { /* non-fatal */ }
    })();

    return () => { cancelled = true; };
  }, [meetingId, loadedMeetingId]);

  const flash = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3500);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await api.providers.setMeetingMapping(meetingId, { providerType: selected });
      setMapping(saved);
      flash('Notes source saved.');
    } catch (err) {
      flash('Error: ' + (err?.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const ps = providerStatus.find(p => p.providerType === selected);
      if (ps?.connection?.id) {
        await api.providers.sync(ps.connection.id, meetingId);
        flash('Sync triggered. Check Integrations → Sync Logs for status.');
      }
    } catch (err) {
      flash('Sync failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const currentProvider = providerStatus.find(p => p.providerType === selected);
  const isExternal      = !BUILTIN_TYPES.has(selected);
  const isConnected     = currentProvider?.connection?.connectionStatus === 'connected';
  const conn            = currentProvider?.connection;

  return (
    <div className="glass-panel p-5 space-y-3">
      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
        <Link2 className="w-3.5 h-3.5 text-sky-400" /> Notes Source
      </h3>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-300 outline-none transition-colors"
        >
          {PROVIDER_OPTS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
        >
          <Save className="w-3 h-3" />
          {saving ? 'Saving…' : 'Set Source'}
        </button>

        {isExternal && isConnected && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 bg-sky-600/15 hover:bg-sky-600/25 border border-sky-500/25 text-sky-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        )}

        {isExternal && (
          <span className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase ${
            isConnected
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
              : 'bg-amber-500/15 text-amber-400 border-amber-500/25'
          }`}>
            {isConnected ? 'Connected' : 'Not Configured'}
          </span>
        )}

        {msg && (
          <span className={`text-[11px] font-semibold ${msg.startsWith('Error') || msg.startsWith('Sync failed') ? 'text-rose-400' : 'text-emerald-400'}`}>
            {msg}
          </span>
        )}
      </div>

      {isExternal && conn && (
        <div className="flex items-center gap-4 text-[10px] text-slate-500 pt-1 border-t border-slate-800/50">
          {conn.oauthAccountEmail && (
            <span>Account: <span className="text-slate-300 font-medium">{conn.oauthAccountEmail}</span></span>
          )}
          {conn.lastSyncAt && (
            <span>Last sync: <span className="text-slate-300">
              {new Date(conn.lastSyncAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span></span>
          )}
        </div>
      )}

      {isExternal && !conn && (
        <p className="text-[10px] text-amber-400/80 pt-1 border-t border-slate-800/50">
          {currentProvider?.providerName || selected} is not configured. Go to <span className="font-bold text-amber-400">Integrations → Meeting Notes Providers</span> to connect it.
        </p>
      )}
    </div>
  );
};

// ─── Meeting Detail Panel ─────────────────────────────────────
const MeetingDetail = ({ log, tenantId, onNotesSaved }) => {
  const [aiRefreshTick, setAiRefreshTick] = useState(0);

  // ── MoM inline-edit state ──────────────────────────────────────
  const [momSummary,     setMomSummary]     = useState('');
  const [momDecisions,   setMomDecisions]   = useState('');
  const [momActions,     setMomActions]     = useState('');
  const [momFollowUps,   setMomFollowUps]   = useState('');
  const [momRisks,       setMomRisks]       = useState('');
  const [editingSection, setEditingSection] = useState(null); // 'summary' | 'actions' | 'risks'
  const [savingMoM,      setSavingMoM]      = useState(false);
  const [momSaveMsg,     setMomSaveMsg]     = useState('');

  const handleNotesCompleted = useCallback(() => {
    onNotesSaved?.();
    setAiRefreshTick((n) => n + 1);
  }, [onNotesSaved]);

  // Reset local MoM state whenever a different meeting is selected
  const meetingKey = log?.meetingId ?? log?.id;
  useEffect(() => {
    if (!log) return;
    setMomSummary(asString(log.meetingSummary || log.summary || ''));
    setMomDecisions((log.decisionsTaken  || []).map(asString).join('\n'));
    setMomActions(  (log.actionItems     || []).map(asString).join('\n'));
    setMomFollowUps((log.followUpActions || []).map(asString).join('\n'));
    setMomRisks(    (log.risksDiscussed  || []).map(asString).join('\n'));
    setEditingSection(null);
    setSavingMoM(false);
    setMomSaveMsg('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingKey]);

  const parseMoMLines = (text) => text.split('\n').map(l => l.trim()).filter(Boolean);

  const saveMoMSection = async () => {
    const mid = log.meetingId || log.id;
    setSavingMoM(true);
    setMomSaveMsg('');
    try {
      const saved = await api.meetingLogs.patchNotes(mid, {
        meetingSummary:  momSummary,
        actionItems:     parseMoMLines(momActions),
        followUpActions: parseMoMLines(momFollowUps),
        decisionsTaken:  parseMoMLines(momDecisions),
        risksDiscussed:  parseMoMLines(momRisks),
      });
      setEditingSection(null);
      setMomSaveMsg('Saved successfully.');
      setTimeout(() => setMomSaveMsg(''), 3500);
      onNotesSaved?.(saved);
    } catch (err) {
      setMomSaveMsg('Save failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setSavingMoM(false);
    }
  };

  if (!log) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-slate-600 gap-3">
        <FileText className="w-12 h-12 opacity-30" />
        <p className="text-sm font-semibold text-slate-500">Select a meeting from the list</p>
        <p className="text-xs text-slate-600">Meeting Intelligence details will appear here</p>
      </div>
    );
  }

  const meetingDate     = new Date(log.meetingDate || log.meetingTime);
  const findingsCount   = (log.findingsDiscussed || []).length;
  const tasksCount      = (log.tasksDiscussed    || []).length;
  const cfCount         = (log.carryForward      || []).length;
  const escalationCount = (log.escalations       || []).length;
  const meetingId       = log.meetingId || log.id;

  const timelineEvents = (log.tasksDiscussed || [])
    .flatMap((t) => (t.timeline || []).map((e) => ({ ...e, taskTitle: t.title })))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 12);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-4 border-b border-slate-800/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <StatusPill status={log.meetingStatus || log.status} />
            <span className="text-[10px] font-mono text-slate-500">{meetingId}</span>
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">{log.customer || 'Meeting'}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {log.meetingType?.replace(/_/g, ' ')} · {log.accountManager || 'Account Manager'}
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:text-right shrink-0">
          {[
            { label: 'Findings', value: findingsCount,   color: 'text-rose-400' },
            { label: 'Tasks',    value: tasksCount,      color: 'text-indigo-400' },
            { label: 'CF',       value: cfCount,         color: 'text-amber-400' },
            { label: 'Escalated',value: escalationCount, color: 'text-rose-500' },
          ].map((kpi) => (
            <div key={kpi.label} className="text-center bg-slate-900/40 border border-slate-800/60 rounded-lg px-3 py-2">
              <p className={`text-lg font-extrabold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">{kpi.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Meeting Information */}
        <Section icon={Calendar} iconColor="text-indigo-400" title="Meeting Information">
          <div className="space-y-0">
            {[
              { icon: Hash,      label: 'Meeting ID',  value: meetingId, mono: true },
              { icon: Building2, label: 'Tenant',       value: log.customer },
              { icon: Calendar,  label: 'Date',         value: meetingDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) },
              { icon: Clock,     label: 'Time',         value: meetingDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) },
              { icon: Clock,     label: 'Duration',     value: `${log.meetingDuration || log.meetingDurationMinutes || 60} minutes` },
              { icon: Activity,  label: 'Status',       value: (log.meetingStatus || log.status)?.replace(/_/g, ' ') },
            ].map(({ icon: Icon, label, value, mono }) => (
              <div key={label} className="flex items-center gap-3 py-2 border-b border-slate-800/40 last:border-0">
                <Icon className="w-3 h-3 text-slate-600 shrink-0" />
                <span className="text-[10px] font-semibold text-slate-500 w-24 shrink-0">{label}</span>
                <span className={`text-xs text-slate-200 ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Participants — stacked: NxGSecure Team on top, Customer Side below */}
        <Section icon={Users} iconColor="text-sky-400" title="Participants">
          {(() => {
            const { nxg, customer } = splitAttendees(log.attendees, log.accountManager);

            /* Chip row: avatar + name + optional role badge */
            const renderChip = (a, idx, avatarCls, textCls) => (
              <div key={idx} className="flex items-center gap-1.5 min-w-0 shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${avatarCls}`}>
                  {getAttendeeInitials(a)}
                </div>
                <div className="min-w-0">
                  <p className={`text-[11px] font-semibold truncate max-w-[110px] ${textCls}`}>{getAttendeeName(a)}</p>
                  {a?.email && <p className="text-[9px] text-slate-600 truncate max-w-[110px]">{a.email}</p>}
                </div>
              </div>
            );

            return (
              <div className="space-y-2">
                {/* ── NxGSecure Team ── */}
                <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-2.5">
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider mb-2">🛡 NxGSecure Team</p>
                  <div className="flex flex-wrap gap-2.5">
                    {/* AM always first — pinned with AM Lead badge */}
                    <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                      <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[9px] font-bold text-indigo-400 shrink-0">
                        {(log.accountManager || 'AM').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0,2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-200 truncate max-w-[110px]">{log.accountManager || 'Account Manager'}</p>
                        <span className="text-[8px] px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-bold uppercase tracking-wide">AM Lead</span>
                      </div>
                    </div>
                    {/* Other NxGSecure team members */}
                    {nxg.map((a, idx) => renderChip(a, idx, 'bg-indigo-500/15 border border-indigo-500/25 text-indigo-400', 'text-slate-200'))}
                  </div>
                </div>

                {/* ── Customer Side ── */}
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
              </div>
            );
          })()}
        </Section>

        {/* Findings Reviewed */}
        <Section icon={ShieldAlert} iconColor="text-rose-400" title="Findings Reviewed" badge={findingsCount}>
          {findingsCount === 0 ? (
            <Empty message="No findings recorded for this meeting." />
          ) : (
            <div className="space-y-2">
              {(log.findingsDiscussed || []).map((f) => (
                <div key={f.id} className="bg-slate-900/40 border border-slate-800/60 rounded-lg p-2.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[f.severity] || 'bg-slate-500'}`} />
                    <span className="text-[10px] font-semibold text-slate-300">{f.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-slate-500">
                    <span className="font-mono">{f.sourceFindingId}</span>
                    <span>·</span>
                    <span className="capitalize">{f.severity}</span>
                    {f.category && <><span>·</span><span>{f.category}</span></>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Risks Discussed */}
        <Section
          icon={AlertTriangle} iconColor="text-amber-400" title="Risks Discussed"
          badge={(log.risksDiscussed || []).length}
          action={
            <button
              onClick={() => setEditingSection(editingSection === 'risks' ? null : 'risks')}
              className="flex items-center gap-1 text-[9px] font-bold text-slate-500 hover:text-amber-400 border border-slate-700/50 hover:border-amber-500/30 px-2 py-0.5 rounded-lg transition-colors"
            >
              <Edit2 className="w-2.5 h-2.5" />
              {editingSection === 'risks' ? 'Cancel' : 'Edit'}
            </button>
          }
        >
          {editingSection === 'risks' ? (
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Risks (one per line)</label>
              <textarea
                value={momRisks}
                onChange={(e) => setMomRisks(e.target.value)}
                rows={5}
                placeholder="Email forwarding rule detected&#10;Unpatched endpoints in Pune…"
                className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={saveMoMSection} disabled={savingMoM} className="flex items-center gap-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-400 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  <Save className="w-3 h-3" />{savingMoM ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingSection(null)} className="text-[10px] font-semibold text-slate-500 hover:text-slate-300 px-2 py-1.5">Cancel</button>
                {momSaveMsg && <span className={`text-[10px] font-semibold ${momSaveMsg.startsWith('Save failed') ? 'text-rose-400' : 'text-emerald-400'}`}>{momSaveMsg}</span>}
              </div>
            </div>
          ) : (log.risksDiscussed || []).length === 0 ? (
            <Empty message="No high/critical risks flagged in this session." />
          ) : (
            <div className="space-y-2">
              {(log.risksDiscussed || []).map((r, idx) => {
                const isStr  = typeof r === 'string';
                const text   = isStr ? r : (r.title || r.description || '');
                const sev    = isStr ? null : r.severity;
                const cat    = isStr ? null : r.category;
                return (
                  <div key={(!isStr && r.id) || idx} className="flex items-start gap-2 py-1.5 border-b border-slate-800/40 last:border-0">
                    <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${SEV_DOT[sev] || 'bg-slate-500'}`} />
                    <div>
                      <p className="text-xs text-slate-300 font-medium">{text}</p>
                      {(sev || cat) && (
                        <p className="text-[9px] text-slate-500 capitalize">
                          {sev ? `${sev} severity` : ''}{sev && cat ? ' · ' : ''}{cat || ''}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      {/* Tasks Discussed */}
      <Section icon={ClipboardList} iconColor="text-indigo-400" title="Tasks Discussed" badge={tasksCount}>
        {tasksCount === 0 ? (
          <Empty message="No tasks linked to this meeting." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/60 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-left">
                  <th className="pb-2">Task</th>
                  <th className="pb-2 w-24">Status</th>
                  <th className="pb-2 w-20">Owner</th>
                  <th className="pb-2 w-16">Due</th>
                  <th className="pb-2 w-16">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {(log.tasksDiscussed || []).map((t) => {
                  const isOverdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed';
                  return (
                    <tr key={t.id} className="hover:bg-slate-800/10 transition-colors">
                      <td className="py-2.5 pr-4">
                        <p className="font-semibold text-slate-300 line-clamp-1">{t.title}</p>
                        <span className="text-[9px] text-slate-600 font-mono">{t.sourceFindingId || t.id}</span>
                      </td>
                      <td className="py-2.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${
                          t.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                          t.status === 'in_progress' ? 'bg-blue-500/15 text-blue-400 border-blue-500/20' :
                          t.status === 'escalated' ? 'bg-rose-500/15 text-rose-400 border-rose-500/20' :
                          'bg-slate-700/50 text-slate-400 border-slate-700'
                        }`}>
                          {(t.status || 'open').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-500 text-[10px]">{t.ownerName || t.primaryOwner?.name?.split(' ')[0] || '—'}</td>
                      <td className={`py-2.5 text-[10px] font-semibold ${isOverdue ? 'text-rose-400' : 'text-slate-400'}`}>
                        {t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 bg-slate-800 rounded-full h-1">
                            <div className="bg-indigo-500 h-1 rounded-full" style={{ width: `${t.progressPercentage || 0}%` }} />
                          </div>
                          <span className="text-[9px] text-slate-500">{t.progressPercentage || 0}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Action Items */}
        <Section
          icon={CheckCircle2} iconColor="text-emerald-400" title="Action Items"
          badge={(log.actionItems || []).length}
          action={
            <button
              onClick={() => setEditingSection(editingSection === 'actions' ? null : 'actions')}
              className="flex items-center gap-1 text-[9px] font-bold text-slate-500 hover:text-emerald-400 border border-slate-700/50 hover:border-emerald-500/30 px-2 py-0.5 rounded-lg transition-colors"
            >
              <Edit2 className="w-2.5 h-2.5" />
              {editingSection === 'actions' ? 'Cancel' : 'Edit'}
            </button>
          }
        >
          {editingSection === 'actions' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Action Items (one per line)</label>
                <textarea
                  value={momActions}
                  onChange={(e) => setMomActions(e.target.value)}
                  rows={5}
                  placeholder="Install Check Point on remaining devices&#10;Review JumpCloud licenses…"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500/50 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Follow-up Actions (one per line)</label>
                <textarea
                  value={momFollowUps}
                  onChange={(e) => setMomFollowUps(e.target.value)}
                  rows={3}
                  placeholder="Schedule VAPT on Thursday&#10;Send phishing simulation report…"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500/50 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={saveMoMSection} disabled={savingMoM} className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  <Save className="w-3 h-3" />{savingMoM ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingSection(null)} className="text-[10px] font-semibold text-slate-500 hover:text-slate-300 px-2 py-1.5">Cancel</button>
                {momSaveMsg && <span className={`text-[10px] font-semibold ${momSaveMsg.startsWith('Save failed') ? 'text-rose-400' : 'text-emerald-400'}`}>{momSaveMsg}</span>}
              </div>
            </div>
          ) : (
            <>
              {(log.actionItems || []).length === 0 ? (
                <Empty message="No action items recorded." />
              ) : (
                <ul className="space-y-1.5">
                  {(log.actionItems || []).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                      <ArrowUpRight className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                      {asString(item)}
                    </li>
                  ))}
                </ul>
              )}
              {(log.followUpActions || []).length > 0 && (
                <>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-3 pt-3 border-t border-slate-800/40">Follow-up Actions</p>
                  <ul className="space-y-1.5 mt-2">
                    {(log.followUpActions || []).map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-400">
                        <ArrowUpRight className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" />
                        {asString(item)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Section>

        {/* Carry Forward & Escalations */}
        <Section icon={GitBranch} iconColor="text-orange-400" title="Carry Forward & Escalations">
          {cfCount === 0 && escalationCount === 0 ? (
            <Empty message="No carry-forward tasks or escalations in this meeting." />
          ) : (
            <div className="space-y-3">
              {cfCount > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-2">
                    Carry Forward — {cfCount} task{cfCount !== 1 ? 's' : ''}
                  </p>
                  {(log.carryForward || []).map((t) => (
                    <div key={t.id} className="flex items-start gap-2 mb-1.5 bg-orange-500/5 border border-orange-500/15 rounded-lg px-2.5 py-1.5">
                      <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${SEV_DOT[t.severity] || 'bg-slate-500'}`} />
                      <div>
                        <p className="text-[11px] text-slate-300 font-medium line-clamp-1">{t.title}</p>
                        <p className="text-[9px] text-orange-400">CF ×{t.carryForwardCount}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {escalationCount > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider mb-2">
                    Escalations — {escalationCount} task{escalationCount !== 1 ? 's' : ''}
                  </p>
                  {(log.escalations || []).map((t) => (
                    <div key={t.id} className="flex items-start gap-2 mb-1.5 bg-rose-500/5 border border-rose-500/15 rounded-lg px-2.5 py-1.5">
                      <span className="w-2 h-2 rounded-full mt-1 shrink-0 bg-rose-400" />
                      <div>
                        <p className="text-[11px] text-slate-300 font-medium line-clamp-1">{t.title}</p>
                        <p className="text-[9px] text-rose-400">Escalation count: {t.escalationCount}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Meeting Timeline */}
      {timelineEvents.length > 0 && (
        <Section icon={Activity} iconColor="text-indigo-400" title="Meeting Timeline" badge={`${timelineEvents.length} events`}>
          <div className="relative border-l-2 border-slate-800 ml-2 pl-4 space-y-3">
            {timelineEvents.map((evt, idx) => {
              const typeStyle = {
                created:   'bg-indigo-500/20 text-indigo-400 border-indigo-500/25',
                approved:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/25',
                progress:  'bg-blue-500/20 text-blue-400 border-blue-500/25',
                escalated: 'bg-rose-500/20 text-rose-400 border-rose-500/25',
                completed: 'bg-emerald-600/25 text-emerald-300 border-emerald-500/30',
                update:    'bg-slate-700/50 text-slate-400 border-slate-700',
                review:    'bg-sky-500/20 text-sky-400 border-sky-500/25',
              };
              return (
                <div key={evt.id || idx} className="relative">
                  <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 bg-slate-900 border-slate-700" />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${typeStyle[evt.type] || typeStyle.update}`}>
                        {evt.type?.replace(/_/g, ' ') || 'event'}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(evt.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' · '}{new Date(evt.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">{evt.event}</p>
                    <p className="text-[10px] text-slate-600">
                      {evt.actor}
                      {evt.taskTitle && <span className="text-indigo-400/60"> · {evt.taskTitle.slice(0, 50)}</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Meeting Summary */}
      <Section
        icon={MessageSquare} iconColor="text-sky-400" title="Meeting Summary"
        action={
          <button
            onClick={() => setEditingSection(editingSection === 'summary' ? null : 'summary')}
            className="flex items-center gap-1 text-[9px] font-bold text-slate-500 hover:text-sky-400 border border-slate-700/50 hover:border-sky-500/30 px-2 py-0.5 rounded-lg transition-colors"
          >
            <Edit2 className="w-2.5 h-2.5" />
            {editingSection === 'summary' ? 'Cancel' : 'Edit'}
          </button>
        }
      >
        {editingSection === 'summary' ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Meeting Summary</label>
              <textarea
                value={momSummary}
                onChange={(e) => setMomSummary(e.target.value)}
                rows={4}
                placeholder="Brief summary of what was discussed in this session…"
                className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500/50 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Decisions Taken (one per line)</label>
              <textarea
                value={momDecisions}
                onChange={(e) => setMomDecisions(e.target.value)}
                rows={3}
                placeholder="Approved VAPT schedule for Thursday&#10;Deferred MFA project to Q3…"
                className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500/50 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none transition-colors resize-none"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={saveMoMSection} disabled={savingMoM} className="flex items-center gap-1.5 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-400 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                <Save className="w-3 h-3" />{savingMoM ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingSection(null)} className="text-[10px] font-semibold text-slate-500 hover:text-slate-300 px-2 py-1.5">Cancel</button>
              {momSaveMsg && <span className={`text-[10px] font-semibold ${momSaveMsg.startsWith('Save failed') ? 'text-rose-400' : 'text-emerald-400'}`}>{momSaveMsg}</span>}
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-300 leading-relaxed">
              {asString(log.meetingSummary || log.meetingNotes || log.summary) || (
                <span className="text-slate-600 italic">No summary captured for this meeting.</span>
              )}
            </p>
            {(log.decisionsTaken || []).length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-3 pt-3 border-t border-slate-800/40">
                  Decisions Taken
                </p>
                <ul className="space-y-1.5 mt-2">
                  {(log.decisionsTaken || []).map((d, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                      <Info className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" />
                      {asString(d)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Section>

      {/* ── Notes Source ── */}
      <NotesSourcePanel meetingId={meetingId} />

      {/* ── Meeting Notes / Post-Meeting AI ── */}
      {['conducted', 'closed'].includes(log.meetingStatus || log.status) ? (
        <>
          <MeetingNotesPanel
            meeting={{ id: meetingId, status: log.meetingStatus || log.status }}
            tenantId={tenantId}
            onNotesCompleted={handleNotesCompleted}
          />
          <AiTaskRecommendationsPanel
            meetingId={meetingId}
            tenantId={tenantId}
            refreshTrigger={aiRefreshTick}
          />
        </>
      ) : (
        <div className="glass-panel p-5">
          <div className="flex items-center gap-2 mb-2">
            <PenLine className="w-3.5 h-3.5 text-slate-500" />
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Meeting Notes</h3>
          </div>
          <p className="text-xs text-slate-600 italic">
            Meeting notes and AI analysis will be available after the meeting is conducted.
          </p>
        </div>
      )}

      {/* ── MOM Upload ── */}
      <Section icon={Paperclip} iconColor="text-teal-400" title="Minutes of Meeting (MOM) Documents">
        <MOMUpload meetingId={meetingId} tenantId={tenantId} />
      </Section>
    </div>
  );
};

// ─── Main Logs Page ───────────────────────────────────────────
export const Logs = () => {
  const { selectedTenant, tenantId } = useTenant();
  const [logs,          setLogs]          = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [selectedLog,   setSelectedLog]   = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');

  // Compute sequence numbers (ascending order = oldest is #1)
  const logsWithSeq = logs.map((log, idx) => ({
    ...log,
    seqNum: logs.length - idx,
  }));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.meetingLogs.list({ page: 1, pageSize: 100 });
      const items = response?.items || [];
      setLogs(items);
      if (items.length > 0 && !selectedLog) {
        openLog(items[0]);
      }
    } catch (error) {
      console.error('Unable to load meeting logs', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id]);

  useEffect(() => {
    fetchLogs();
    setSelectedLog(null);
  }, [selectedTenant?.id]); // eslint-disable-line

  const openLog = async (meetingLog) => {
    setLoadingDetail(true);
    try {
      const detail = await api.meetingLogs.getById(meetingLog.meetingId || meetingLog.id);
      setSelectedLog(detail || meetingLog);
    } catch (error) {
      console.error('Unable to load meeting details', error);
      setSelectedLog(meetingLog);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleNotesSaved = (savedNote) => {
    if (selectedLog && savedNote) {
      setSelectedLog((prev) => ({
        ...prev,
        meetingSummary:  savedNote.meetingSummary  ?? prev.meetingSummary,
        summary:         savedNote.summary         ?? prev.summary,
        actionItems:     savedNote.actionItems     ?? prev.actionItems,
        followUpActions: savedNote.followUpActions ?? prev.followUpActions,
        decisionsTaken:  savedNote.decisionsTaken  ?? prev.decisionsTaken,
        risksDiscussed:  savedNote.risksDiscussed  ?? prev.risksDiscussed,
        topics:          savedNote.topics          ?? prev.topics,
      }));
    }
  };

  const filteredLogs = logsWithSeq.filter((log) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (log.customer || '').toLowerCase().includes(q) ||
      (log.meetingId || log.id || '').toLowerCase().includes(q) ||
      (log.meetingStatus || log.status || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-800/80 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Meeting Intelligence</p>
          <h2 className="text-2xl font-extrabold text-white font-sans tracking-tight">Activity</h2>
          <p className="text-xs text-slate-400 mt-1">
            Complete meeting history, structured notes, MOM documents, action items, carry-forward tracking
          </p>
        </div>
        <TenantSelector />
      </div>

      <div className="flex gap-5 h-[calc(100vh-220px)] min-h-[600px]">

        {/* Left: Meeting History List */}
        <div className="w-72 shrink-0 flex flex-col glass-panel overflow-hidden">
          <div className="p-3 border-b border-slate-800/60 shrink-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search meetings..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-colors"
            />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600 gap-2">
                <FileText className="w-8 h-8 opacity-40" />
                <p className="text-xs">No meetings found</p>
              </div>
            ) : (
              filteredLogs.map((log) => (
                <MeetingListItem
                  key={log.id || log.meetingId}
                  log={log}
                  seqNum={log.seqNum}
                  isSelected={(selectedLog?.meetingId || selectedLog?.id) === (log.meetingId || log.id)}
                  onClick={() => openLog(log)}
                />
              ))
            )}
          </div>

          <div className="p-3 border-t border-slate-800/60 text-center text-[10px] text-slate-600 shrink-0">
            {filteredLogs.length} meeting{filteredLogs.length !== 1 ? 's' : ''} · {selectedTenant?.name || 'All Tenants'}
          </div>
        </div>

        {/* Right: Meeting Detail */}
        <div className="flex-1 overflow-y-auto min-h-0 min-w-0">
          {loadingDetail ? (
            <div className="flex items-center justify-center py-24">
              <RefreshCw className="w-7 h-7 text-indigo-400 animate-spin" />
            </div>
          ) : (
            <MeetingDetail
              log={selectedLog}
              tenantId={tenantId}
              onNotesSaved={handleNotesSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Logs;
