import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useTenant } from '../context/TenantContext';
import { getMeetingPlatformLabel } from '../services/mockData';
import { CustomCalendar } from '../components/CustomCalendar';
import { MeetingList } from '../components/MeetingList';
import { ApprovalWorkflowModal } from '../components/ApprovalWorkflowModal';
import { RescheduleReviewModal } from '../components/RescheduleReviewModal';
import { RescheduleRequestForm } from '../components/RescheduleRequestForm';
import { TrackerTaskList } from './tracker/TrackerTaskList';
import MeetingNotesPanel from '../components/MeetingNotesPanel';
import {
  CalendarRange, ChevronRight, ShieldCheck, HelpCircle,
  Monitor, ClipboardList, AlertTriangle, CheckCircle2, X,
  RefreshCw, Sparkles, ThumbsUp, ThumbsDown,
  ChevronDown, ChevronUp, Cpu, Mail, Users, UserPlus, FileDown, Upload, Pencil,
  Send, Loader2, Zap,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────
const TIMEZONES = [
  { value: 'America/New_York',   label: 'America/New_York (EST/EDT)' },
  { value: 'America/Chicago',    label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Los_Angeles',label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'Europe/London',      label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Berlin',      label: 'Europe/Berlin (CET/CEST)' },
  { value: 'Asia/Kolkata',       label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Singapore',     label: 'Asia/Singapore (SGT)' },
  { value: 'UTC',                label: 'Coordinated Universal Time (UTC)' },
];

const PHASE1_STATUS_STYLE = {
  Scheduled:   'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  Rescheduled: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  Completed:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};


const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';

// ─── Main Page ─────────────────────────────────────────────────────────────
export const MeetingSchedule = () => {
  const { selectedTenant, tenantId, loading: tenantLoading } = useTenant();

  const [meetings, setMeetings] = useState([]);
  const [activeMeeting, setActiveMeeting] = useState(null);
  // Lifted out of CustomCalendar so the "This Month" list (now a sibling,
  // not a child) stays in sync with prev/next month navigation.
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [actionItemsRefreshKey, setActionItemsRefreshKey] = useState(0);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleMeeting, setRescheduleMeeting] = useState(null);
  const [showRescheduleRequestForm, setShowRescheduleRequestForm] = useState(false);
  const [rescheduleRequestMeeting, setRescheduleRequestMeeting] = useState(null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);

  // Send action points email state (Action Points tab header)
  const [showEmailForm,   setShowEmailForm]   = useState(false);
  const [emailInput,      setEmailInput]      = useState('');
  const [emailSending,    setEmailSending]    = useState(false);
  const [emailResult,     setEmailResult]     = useState(null);
  const [emailError,      setEmailError]      = useState('');

  // New Meeting direct-creation state
  const [showNewMeetingForm,  setShowNewMeetingForm]  = useState(false);
  const [newMeetingTitle,     setNewMeetingTitle]     = useState('');
  const [newMeetingDate,      setNewMeetingDate]      = useState('');
  const [newMeetingDateError, setNewMeetingDateError] = useState('');
  const [newMeetingSubmitError, setNewMeetingSubmitError] = useState('');
  const [newMeetingTime,      setNewMeetingTime]      = useState('10:00');
  const [newMeetingDuration,  setNewMeetingDuration]  = useState(60);
  const [newMeetingTimezone,  setNewMeetingTimezone]  = useState('America/New_York');
  const [newMeetingTeamsUrl,  setNewMeetingTeamsUrl]  = useState('');
  const [newMeetingAttendees, setNewMeetingAttendees] = useState([]);
  const [newAttendeeEmail,    setNewAttendeeEmail]    = useState('');
  const [newAttendeeName,     setNewAttendeeName]     = useState('');
  const [savingNewMeeting,    setSavingNewMeeting]    = useState(false);

  // Microsoft 365 connection gate — scheduling requires the logged-in AM's
  // own M365 connection (checked again server-side; this is just so the New
  // Meeting button doesn't open a form the AM would only get blocked on
  // after filling it out).
  const [msConnected, setMsConnected] = useState(true); // optimistic until checked, avoids a flash of the warning on load
  const [msStatusChecked, setMsStatusChecked] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await api.microsoft.getStatus();
        if (active) setMsConnected(status?.status === 'connected');
      } catch {
        if (active) setMsConnected(false);
      } finally {
        if (active) setMsStatusChecked(true);
      }
    })();
    return () => { active = false; };
  }, []);

  // Today's date in YYYY-MM-DD (local timezone) — used as the `min` for the meeting date picker.
  // Recomputed each time the component mounts so the modal always reflects the actual current day.
  const todayStr = useMemo(() => {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }, []);

  // Invitations panel state
  const [showInvitePanel,    setShowInvitePanel]    = useState(false);
  const [invitations,        setInvitations]        = useState([]);
  const [inviteCounts,       setInviteCounts]       = useState({});
  const [inviteEmail,        setInviteEmail]        = useState('');
  const [inviteName,         setInviteName]         = useState('');
  const [inviteSending,      setInviteSending]      = useState(false);
  const [inviteError,        setInviteError]        = useState('');
  const [rescheduleNotice,   setRescheduleNotice]   = useState('');

  // Booking link modal state
  const [showBookingLinkModal,    setShowBookingLinkModal]    = useState(false);
  const [bookingRecipientEmail,   setBookingRecipientEmail]   = useState('');
  const [bookingRecipientName,    setBookingRecipientName]    = useState('');
  const [bookingMeetingTitle,     setBookingMeetingTitle]     = useState('');
  const [bookingDuration,         setBookingDuration]         = useState(60);
  const [bookingCalendlyUrl,      setBookingCalendlyUrl]      = useState('');
  const [blParticipants,          setBlParticipants]          = useState([]);
  const [blParticipantEmail,      setBlParticipantEmail]      = useState('');
  const [blParticipantName,       setBlParticipantName]       = useState('');
  const [blSending,               setBlSending]               = useState(false);
  const [bookingMsg,              setBookingMsg]              = useState(null);

  // Pre-Meeting Brief state (approval_pending meetings only)
  const [briefData,         setBriefData]         = useState(null);
  const [briefLoading,      setBriefLoading]      = useState(false);
  const [pdfExportLoading,  setPdfExportLoading]  = useState(false);
  const [reAnalyzeLoading,  setReAnalyzeLoading]  = useState(false);
  const [reAnalyzeMsg,      setReAnalyzeMsg]      = useState('');

  // Test findings upload (dev/testing bypass for NXG360)
  const [testUploadLoading, setTestUploadLoading] = useState(false);
  const [testUploadMsg,     setTestUploadMsg]     = useState(null);
  const testFindingsInputRef = useRef(null);

  // AI Recommendation Engine state
  const [aiMeetingId, setAiMeetingId] = useState('');
  const [aiRecommendations, setAiRecommendations] = useState([]);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiPolling, setAiPolling] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('meetings'); // 'meetings' | 'tracker'
  const [agendaTasks, setAgendaTasks] = useState([]);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [aiActionLoading, setAiActionLoading] = useState({});
  const [cuPushLoading,   setCuPushLoading]   = useState({});
  const [cuPushed,        setCuPushed]        = useState({});
  const [rejectModal, setRejectModal] = useState(null); // { id, tenantId }
  const [editModal,   setEditModal]   = useState(null); // { id, title, actionPlan, businessImpact }
  const [editSaving,  setEditSaving]  = useState(false);
  const [editError,   setEditError]   = useState('');
  const aiPollTimer      = useRef(null);
  const isAnalyzingRef   = useRef(false);
  const [rejectReason, setRejectReason] = useState('');
  // Model selector
  const [aiProviderConfig, setAiProviderConfig] = useState(null);
  const [aiSelectedModel, setAiSelectedModel] = useState('');

  // Recurrence — now set directly in the New Meeting form (Journey
  // Configuration used to own this separately; folded in since every new
  // meeting seeds its own recurring cadence at creation time now).
  const [recurrencePattern, setRecurrencePattern] = useState('monthly_day_of_month');

  const loadMeetings = useCallback(async () => {
    if (!tenantId) return;
    setLoadingMeetings(true);
    try {
      const all = await api.meetings.list();
      const tenantMeetings = all.filter((m) => m.tenantId === tenantId);
      // Sort ascending by date, attach sequence numbers
      const sorted = [...tenantMeetings].sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
      const withSeq = sorted.map((m, idx) => ({ ...m, seqNum: idx + 1 }));
      // Display order: most recent first
      const displayOrder = [...withSeq].reverse();
      setMeetings(displayOrder);
      const pending  = displayOrder.find((m) => m.status === 'approval_pending');
      const upcoming = displayOrder.find((m) => m.status === 'scheduled');
      const activeM  = pending || upcoming || displayOrder[0] || null;
      setActiveMeeting(activeM);
      if (activeM) setAiMeetingId((prev) => prev || activeM.id);
    } catch (err) { console.error(err); }
    finally { setLoadingMeetings(false); }
  }, [tenantId]);

  const bumpActionItems = () => setActionItemsRefreshKey((k) => k + 1);

  const handleExportBriefPDF = async () => {
    if (!activeMeeting || pdfExportLoading) return;
    setPdfExportLoading(true);
    try {
      await api.meetings.exportBrief(activeMeeting.id);
    } catch (err) {
      console.error('PDF export failed', err);
    } finally {
      setPdfExportLoading(false);
    }
  };

  // ── Shared polling helper ────────────────────────────────────────────────────
  // Called by both handleReAnalyze and handleAnalyzeAI after triggering analysis.
  // Polls every 10 s, updates the task list progressively, and stops when the
  // count has been stable for 60 s (6 polls) or after 5 min (30 attempts).
  const startAiPolling = (meetingId) => {
    if (aiPollTimer.current) clearTimeout(aiPollTimer.current);
    setAiPolling(true);
    let attempts   = 0;
    let lastCount  = 0;
    let stableRuns = 0;
    const poll = async () => {
      attempts++;
      try {
        const result = await api.ai.listRecommendations({ tenantId, meetingId });
        const recs = result.recommendations || [];
        if (recs.length > 0) { setAiRecommendations(recs); setAiPanelOpen(true); }
        if (recs.length === lastCount) {
          stableRuns++;
          if (recs.length > 0 && stableRuns >= 6) { setAiPolling(false); return; }
        } else {
          stableRuns = 0;
        }
        lastCount = recs.length;
      } catch { /* ignore transient poll errors */ }
      if (attempts < 30) {
        aiPollTimer.current = setTimeout(poll, 10000);
      } else {
        setAiPolling(false);
        if (lastCount === 0) setAiError('AI analysis is taking longer than expected. Try Re-run AI and wait 60 s.');
      }
    };
    aiPollTimer.current = setTimeout(poll, 15000);
  };

  const handleReAnalyze = async () => {
    if (!activeMeeting || reAnalyzeLoading) return;

    // If an analysis is already running, don't start another — just surface it.
    if (aiPolling || aiAnalyzing) {
      setReAnalyzeMsg('AI analysis is already running — see the AI Tasks panel below for live progress.');
      setTimeout(() => setReAnalyzeMsg(''), 5000);
      return;
    }

    setReAnalyzeLoading(true);
    setReAnalyzeMsg('');
    try {
      // Always use findings-based analysis for Re-run AI / Analyze buttons.
      // Transcript-based analysis is triggered only via "Submit & Analyse" in Meeting Notes.
      await api.meetings.reAnalyze(activeMeeting.id, aiSelectedModel || undefined);
      setReAnalyzeMsg('AI analysis started — tasks are generating in the AI Tasks panel below.');

      // Sync the AI tasks panel so it shows tasks from this meeting as they arrive.
      setAiMeetingId(activeMeeting.id);
      setAiRecommendations([]);
      setAiError('');
      setAiPanelOpen(true);
      startAiPolling(activeMeeting.id);

      // Also refresh the brief panel once analysis has had time to complete.
      setTimeout(() => {
        api.meetings.preMeetingBrief(activeMeeting.id)
          .then((data) => { setBriefData(data); setReAnalyzeMsg(''); })
          .catch(() => setReAnalyzeMsg(''));
      }, 40000);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409) {
        // Notes are currently processing — poll for live results instead of retrying.
        setReAnalyzeMsg('AI analysis is already in progress. Tracking progress in AI Tasks panel…');
        setAiMeetingId(activeMeeting.id);
        setAiPanelOpen(true);
        startAiPolling(activeMeeting.id);
      } else {
        setReAnalyzeMsg(err?.response?.data?.error || 'Re-analysis failed. Check Ollama is running.');
      }
    } finally {
      setReAnalyzeLoading(false);
    }
  };

  const handleUploadTestFindings = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeMeeting || testUploadLoading) return;
    const meetingId   = activeMeeting.id;
    const wasScheduled = activeMeeting.status === 'scheduled';
    setTestUploadLoading(true);
    setTestUploadMsg(null);
    try {
      const res = await api.meetings.uploadTestFindings(meetingId, file);
      if (wasScheduled) {
        await api.meetings.triggerWorkflow(meetingId).catch(() => {});
      }
      await loadMeetings();
      setTestUploadMsg({
        type: 'success',
        text: `${res.findingCount ?? '?'} finding(s) from "${res.fileName}" uploaded — AI analyzing. Brief will auto-refresh in ~30 seconds.`,
      });
      // Auto-refresh brief after AI pipeline completes
      setTimeout(() => {
        setBriefLoading(true);
        api.meetings.preMeetingBrief(meetingId)
          .then((data) => setBriefData(data))
          .catch(() => {})
          .finally(() => setBriefLoading(false));
      }, 32000);
    } catch (err) {
      setTestUploadMsg({
        type: 'error',
        text: err?.response?.data?.error || err?.message || 'Upload failed.',
      });
    } finally {
      setTestUploadLoading(false);
      if (testFindingsInputRef.current) testFindingsInputRef.current.value = '';
    }
  };

  // Fetch brief whenever the active meeting is approval_pending or conducted.
  useEffect(() => {
    if (!activeMeeting || !['approval_pending', 'conducted'].includes(activeMeeting.status)) {
      setBriefData(null);
      return;
    }
    setBriefLoading(true);
    api.meetings.preMeetingBrief(activeMeeting.id)
      .then((data) => setBriefData(data))
      .catch(() => setBriefData(null))
      .finally(() => setBriefLoading(false));
  }, [activeMeeting?.id, activeMeeting?.status]);

  // Load Ollama provider config + installed model list once on mount
  useEffect(() => {
    api.ai.getProviders().then((cfg) => {
      setAiProviderConfig(cfg);
      // Pre-select the configured primary model. cfg.primaryModel comes from
      // OLLAMA_MODEL (bare, e.g. "llama3.1"), but cfg.availableModels comes
      // from Ollama's own /api/tags and lists fully-qualified names (e.g.
      // "llama3.1:latest") — those never matched, so the <select>'s value
      // matched no <option> and the browser silently fell back to showing
      // whichever model happened to be first in the list (most recently
      // pulled locally — e.g. a model only ever pulled for a one-off test),
      // not the model actually configured for real processing. Match by the
      // part before ':' so the dropdown reflects reality.
      if (cfg?.primaryModel) {
        const match = (cfg.availableModels || []).find(
          (m) => m.name === cfg.primaryModel || m.name.split(':')[0] === cfg.primaryModel
        );
        setAiSelectedModel(match ? match.name : cfg.primaryModel);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // Auto-select and open the AI panel when the active meeting is approval_pending.
  useEffect(() => {
    if (activeMeeting?.id && activeMeeting.status === 'approval_pending') {
      setAiMeetingId((prev) => (prev === activeMeeting.id ? prev : activeMeeting.id));
      setAiPanelOpen(true);
    }
  }, [activeMeeting?.id, activeMeeting?.status]);

  // Cleanup polling timer on unmount.
  useEffect(() => () => { if (aiPollTimer.current) clearTimeout(aiPollTimer.current); }, []);

  // Fetch existing recommendations whenever the selected meeting changes.
  // Surfaces T-48 / re-analyze results without requiring a manual Analyze click.
  useEffect(() => {
    if (!aiMeetingId || !tenantId) return;
    let cancelled = false;
    api.ai.listRecommendations({ tenantId, meetingId: aiMeetingId })
      .then((result) => {
        if (!cancelled) setAiRecommendations(result.recommendations || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [aiMeetingId, tenantId]);

  // Load all open tenant tasks for the Action Points tab whenever the active meeting changes.
  useEffect(() => {
    if (!activeMeeting?.id || !tenantId) { setAgendaTasks([]); return; }
    setAgendaLoading(true);
    api.tasks.listOpenForTenant()
      .then((data) => setAgendaTasks(Array.isArray(data) ? data : (data.tasks || [])))
      .catch(() => setAgendaTasks([]))
      .finally(() => setAgendaLoading(false));
  }, [activeMeeting?.id, tenantId, actionItemsRefreshKey]);

  const handleTriggerScan = async (meetingId) => {
    try { await api.meetings.triggerWorkflow(meetingId); await loadMeetings(); bumpActionItems(); }
    catch (err) { console.error(err); }
  };
  const handleReviewMeeting = (meeting) => { setActiveMeeting(meeting); setShowApprovalModal(true); };
  const handleWorkflowSaved = async () => { await loadMeetings(); bumpActionItems(); };
  const handleRequestReschedule = (meeting) => { setRescheduleRequestMeeting(meeting); setShowRescheduleRequestForm(true); };
  const handleRequestRescheduleSave = async (meetingId, requestedDate, requestedTime, reason) => {
    await api.meetings.requestReschedule(meetingId, requestedDate, requestedTime, reason);
    await loadMeetings();
  };
  const handleReviewReschedule = (meeting) => { setRescheduleMeeting(meeting); setShowRescheduleModal(true); };
  const handleReviewRescheduleSave = async (meetingId, approved, notes) => {
    try {
      const result = await api.meetings.reviewReschedule(meetingId, approved, notes);
      await loadMeetings();
      if (approved) {
        const count = result?.invitesRegenerated ?? 0;
        const msg = count > 0
          ? `Reschedule approved — ${count} invitation${count !== 1 ? 's' : ''} resent automatically.`
          : 'Reschedule approved — invitations will be resent shortly.';
        setRescheduleNotice(msg);
        setTimeout(() => setRescheduleNotice(''), 6000);
      }
    } catch (err) { console.error(err); }
  };
  const handleConductMeeting = async (meetingId) => {
    try { await api.meetings.conductMeeting(meetingId); await loadMeetings(); }
    catch (err) { console.error(err); }
  };
  const handleCloseMeeting = async (meetingId) => {
    try { await api.meetings.closeMeeting(meetingId); await loadMeetings(); bumpActionItems(); }
    catch (err) { console.error(err); }
  };

  // ── Meeting Participants management ───────────────────────────────────────
  const [addParticipantEmail, setAddParticipantEmail] = useState('');
  const [addParticipantName,  setAddParticipantName]  = useState('');
  const [savingParticipants,  setSavingParticipants]  = useState(false);

  const _persistAttendees = async (meetingId, updatedList) => {
    setSavingParticipants(true);
    try {
      await api.meetings.updateAttendees(meetingId, updatedList);
      await loadMeetings();
    } catch (err) { console.error(err); }
    finally { setSavingParticipants(false); }
  };

  const handleAddParticipant = async (e) => {
    e.preventDefault();
    const email = addParticipantEmail.trim().toLowerCase();
    if (!email || !activeMeeting) return;
    const current = activeMeeting.attendees || [];
    if (current.some((a) => a.email === email)) {
      setAddParticipantEmail(''); setAddParticipantName(''); return;
    }
    const updated = [...current, { email, name: addParticipantName.trim(), role: 'participant' }];
    setAddParticipantEmail(''); setAddParticipantName('');
    await _persistAttendees(activeMeeting.id, updated);
  };

  const handleRemoveParticipant = async (email) => {
    if (!activeMeeting) return;
    const updated = (activeMeeting.attendees || []).filter((a) => a.email !== email);
    await _persistAttendees(activeMeeting.id, updated);
  };

  const loadInvitations = async (meetingId) => {
    try {
      const data = await api.meetings.getInvitations(meetingId);
      setInvitations(data.invitations || []);
      setInviteCounts(data.counts || {});
    } catch (err) { console.error(err); }
  };

  const handleOpenInvitePanel = async (meetingId) => {
    setShowInvitePanel(true);
    setInviteError('');
    await loadInvitations(meetingId);
  };

  const handleSendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail || !activeMeeting) return;
    setInviteSending(true);
    setInviteError('');
    try {
      await api.meetings.sendInvitations(activeMeeting.id, [
        { recipientEmail: inviteEmail, recipientName: inviteName || null, recipientType: 'attendee' },
      ]);
      setInviteEmail('');
      setInviteName('');
      await loadInvitations(activeMeeting.id);
    } catch (err) {
      setInviteError(err?.response?.data?.error || 'Failed to send invitation.');
    } finally {
      setInviteSending(false);
    }
  };

  const handleSendEmail = async () => {
    if (!activeMeeting || emailSending) return;
    setEmailError('');
    setEmailResult(null);
    const emails = emailInput
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) { setEmailError('Enter at least one email address.'); return; }
    if (emails.length > 10)  { setEmailError('Maximum 10 recipients.'); return; }
    const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad.length) { setEmailError(`Invalid address(es): ${bad.join(', ')}`); return; }
    setEmailSending(true);
    try {
      const result = await api.actionItems.sendEmail(activeMeeting.id, emails);
      setEmailResult(result);
      setEmailInput('');
    } catch (err) {
      setEmailError(err?.response?.data?.error || 'Failed to send email. Please try again.');
    } finally {
      setEmailSending(false);
    }
  };

  // Lock body scroll whenever any full-screen modal is open — placed here so all
  // state variables above are already initialised before this effect references them.
  useEffect(() => {
    const anyModalOpen = showNewMeetingForm || showApprovalModal
      || showRescheduleModal || showRescheduleRequestForm || showInvitePanel
      || showBookingLinkModal || !!rejectModal || !!editModal;
    document.body.style.overflow = anyModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showNewMeetingForm, showApprovalModal, showRescheduleModal,
      showRescheduleRequestForm, showInvitePanel, showBookingLinkModal, rejectModal, editModal]);

  // Pre-fill Calendly URL from stored connection when connections load
  const handleAddBookingParticipant = () => {
    const email = blParticipantEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (blParticipants.some((p) => p.email === email)) return;
    setBlParticipants((prev) => [...prev, { email, name: blParticipantName.trim() }]);
    setBlParticipantEmail('');
    setBlParticipantName('');
  };

  const handleSendBL = async () => {
    if (!bookingRecipientEmail || !bookingRecipientEmail.includes('@')) return;
    setBlSending(true);
    setBookingMsg(null);
    try {
      await api.microsoft.sendBookingLink({
        recipientEmail:  bookingRecipientEmail.trim(),
        recipientName:   bookingRecipientName.trim() || bookingRecipientEmail.trim(),
        participants:    blParticipants,
        meetingTitle:    bookingMeetingTitle.trim() || 'Security Review Meeting',
        durationMinutes: bookingDuration,
        calendlyUrl:     bookingCalendlyUrl.trim(),
      });
      setBookingMsg({ type: 'success', text: `Booking link sent to ${bookingRecipientEmail}` });
      setTimeout(() => {
        setShowBookingLinkModal(false);
        setBookingRecipientEmail('');
        setBookingRecipientName('');
        setBookingMeetingTitle('');
        setBlParticipants([]);
        setBookingMsg(null);
      }, 2000);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to send booking link';
      const needsUrl = err.response?.data?.code === 'CALENDLY_URL_MISSING';
      setBookingMsg({ type: 'error', text: msg, needsUrl });
    } finally {
      setBlSending(false);
    }
  };


  const handleCloseNewMeetingForm = () => {
    setShowNewMeetingForm(false);
    setNewMeetingTitle('');
    setNewMeetingDate('');
    setNewMeetingDateError('');
    setNewMeetingSubmitError('');
    setNewMeetingTime('10:00');
    setNewMeetingAttendees([]);
    setNewAttendeeEmail('');
    setNewAttendeeName('');
    setNewMeetingTeamsUrl('');
  };

  const handleAddAttendee = () => {
    const email = newAttendeeEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (newMeetingAttendees.some((a) => a.email === email)) return;
    const role = newMeetingAttendees.length === 0 ? 'primary' : 'participant';
    setNewMeetingAttendees((prev) => [...prev, { email, name: newAttendeeName.trim(), role }]);
    setNewAttendeeEmail('');
    setNewAttendeeName('');
  };

  const handleRemoveAttendee = (email) => {
    setNewMeetingAttendees((prev) => {
      const filtered = prev.filter((a) => a.email !== email);
      // Re-assign roles: first remaining becomes primary
      return filtered.map((a, i) => ({ ...a, role: i === 0 ? 'primary' : 'participant' }));
    });
  };

  const handleCreateMeeting = async (e) => {
    e.preventDefault();
    if (!newMeetingTitle || !newMeetingDate || !tenantId) return;

    if (newMeetingDate < todayStr) {
      setNewMeetingDateError('Meeting date cannot be in the past. Please select today or a future date.');
      return;
    }
    setNewMeetingDateError('');
    setNewMeetingSubmitError('');
    setSavingNewMeeting(true);
    try {
      const scheduledStart = new Date(`${newMeetingDate}T${newMeetingTime}:00`).toISOString();
      await api.meetings.create({
        tenantId,
        title:           newMeetingTitle,
        scheduledStart,
        durationMinutes: Number(newMeetingDuration) || 60,
        meetingType:     'monthly_review',
        attendees:       newMeetingAttendees,
        timezone:        newMeetingTimezone,
        meetingTime:     newMeetingTime,
        recurrencePattern,
        ...(newMeetingTeamsUrl.trim() ? { teamsJoinUrl: newMeetingTeamsUrl.trim() } : {}),
      });
      handleCloseNewMeetingForm();
      await loadMeetings(); bumpActionItems();
    } catch (err) {
      console.error('Create meeting failed', err);
      if (err.response?.data?.code === 'MS365_NOT_CONNECTED') {
        setMsConnected(false);
        setNewMeetingSubmitError('Microsoft 365 is not connected for your account. Connect it in Integrations, then try again.');
      } else {
        setNewMeetingSubmitError(err.response?.data?.error || err.message || 'Failed to schedule the meeting.');
      }
    } finally {
      setSavingNewMeeting(false);
    }
  };

  const handleAnalyzeAI = async () => {
    if (!aiMeetingId || !tenantId) return;
    // isAnalyzingRef is a synchronous guard — catches rapid double-clicks before
    // React has a chance to re-render and update aiAnalyzing state.
    if (aiPolling || aiAnalyzing || isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;

    setAiAnalyzing(true);
    setAiPolling(false);
    setAiError('');
    setAiRecommendations([]); // clear stale tasks so UI shows fresh generation

    try {
      // Route to the correct endpoint based on meeting lifecycle:
      // conducted/closed → post-meeting analysis (uses transcript + structured notes)
      // Always use findings-based analysis for the Analyze button.
      // Transcript-based analysis is triggered only via "Submit & Analyse" in Meeting Notes.
      await api.meetings.reAnalyze(aiMeetingId, aiSelectedModel || undefined);
      setAiAnalyzing(false);
      startAiPolling(aiMeetingId);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409) {
        // Backend lock: already running. Switch straight to polling for results.
        setAiError('');
        setAiAnalyzing(false);
        startAiPolling(aiMeetingId);
      } else {
        setAiError(err?.response?.data?.error || err.message || 'AI analysis failed');
        setAiAnalyzing(false);
      }
    } finally {
      isAnalyzingRef.current = false;
    }
  };

  const handleLoadRecommendations = async (meetingId) => {
    if (!meetingId || !tenantId) return;
    try {
      const result = await api.ai.listRecommendations({ tenantId, meetingId });
      setAiRecommendations(result.recommendations || []);
      setAiPanelOpen(true);
    } catch (err) { console.error(err); }
  };

  const handleApproveRec = async (rec) => {
    setAiActionLoading((prev) => ({ ...prev, [rec.id]: 'approving' }));
    try {
      await api.ai.approve(rec.id, { tenantId });
      const storedUser = (() => { try { return JSON.parse(localStorage.getItem('nxg_user') || '{}'); } catch { return {}; } })();
      const approvedByName = [storedUser.first_name, storedUser.last_name].filter(Boolean).join(' ') || storedUser.email || 'You';
      setAiRecommendations((prev) =>
        prev.map((r) => r.id === rec.id ? { ...r, approvalStatus: 'approved', approvedBy: approvedByName } : r)
      );
      bumpActionItems();
    } catch (err) {
      console.error('Approve failed:', err);
    } finally {
      setAiActionLoading((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  };

  const handlePushClickUp = async (rec) => {
    if (!rec.taskId) return;
    setCuPushLoading((prev) => ({ ...prev, [rec.id]: true }));
    try {
      await api.ai.pushClickUp(rec.taskId);
      setCuPushed((prev) => ({ ...prev, [rec.id]: true }));
    } catch (err) {
      console.error('ClickUp push failed:', err);
    } finally {
      setCuPushLoading((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectModal) return;
    const { id } = rejectModal;
    setAiActionLoading((prev) => ({ ...prev, [id]: 'rejecting' }));
    try {
      await api.ai.reject(id, { tenantId, reason: rejectReason || 'Rejected by account manager' });
      setAiRecommendations((prev) =>
        prev.map((r) => r.id === id ? { ...r, approvalStatus: 'rejected', rejectedReason: rejectReason } : r)
      );
    } catch (err) {
      console.error('Reject failed:', err);
    } finally {
      setAiActionLoading((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setRejectModal(null);
      setRejectReason('');
    }
  };

  const handleSaveEdit = async () => {
    if (!editModal || editSaving) return;
    setEditSaving(true);
    setEditError('');
    try {
      const result = await api.ai.update(editModal.id, {
        tenantId,
        title:             editModal.title,
        actionPlan:        editModal.actionPlan,
        businessImpact:    editModal.businessImpact,
        recommendedOwner:  editModal.recommendedOwner,
        dueDateSuggestion: editModal.dueDateSuggestion,
      });
      await api.ai.approve(editModal.id, { tenantId });
      const storedUser = (() => { try { return JSON.parse(localStorage.getItem('nxg_user') || '{}'); } catch { return {}; } })();
      const approvedByName = [storedUser.first_name, storedUser.last_name].filter(Boolean).join(' ') || storedUser.email || 'You';
      setAiRecommendations((prev) =>
        prev.map((r) => r.id === editModal.id
          ? { ...r, ...(result.recommendation || {}), approvalStatus: 'approved', approvedBy: approvedByName }
          : r)
      );
      setEditModal(null);
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Save failed. Try again.');
    } finally {
      setEditSaving(false);
    }
  };

  if (tenantLoading || loadingMeetings) {
    return (
      <div className="flex-grow flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!selectedTenant) {
    return (
      <div className="glass-panel p-8 text-center max-w-md mx-auto">
        <HelpCircle className="w-12 h-12 text-slate-500 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-white mb-2">No Tenant Selected</h3>
        <p className="text-xs text-slate-400">Select a tenant from the sidebar to view the meetings and tracker.</p>
      </div>
    );
  }

  const platformLabel = getMeetingPlatformLabel(selectedTenant?.connectedCalendars?.[0], selectedTenant?.meetingPlatform);

  return (
    <div className="space-y-3">

      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Meetings &amp; Tracker</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            <span className="text-indigo-400 font-semibold">{selectedTenant.name}</span>
            {' '}· Journey management &amp; remediation tracking
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {msStatusChecked && !msConnected ? (
            <Link
              to="/integrations"
              title="Connect Microsoft 365 in Integrations before scheduling a meeting"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0 border border-amber-500/30"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Connect Microsoft 365 to Schedule
            </Link>
          ) : (
            <button
              onClick={() => setShowNewMeetingForm(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0"
            >
              <CalendarRange className="w-3.5 h-3.5" />
              New Meeting
            </button>
          )}
          <button
            onClick={() => { setShowBookingLinkModal(true); setBookingMsg(null); }}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0"
          >
            <Mail className="w-3.5 h-3.5 text-indigo-400" />
            Send Booking Link
          </button>
          <div className="flex items-center gap-1.5 text-[10px] bg-slate-900/50 border border-slate-800 rounded-lg px-2.5 py-1.5 shrink-0">
            <Monitor className="w-3 h-3 text-indigo-400" />
            <span className="text-slate-400 font-medium">{platformLabel}</span>
          </div>
        </div>
      </div>

      {/* ── Notices ── */}
      {rescheduleNotice && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-xs text-emerald-400 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          {rescheduleNotice}
        </div>
      )}

      {/* ── Active Meeting compact bar ── */}
      {activeMeeting && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-slate-800 bg-slate-900/40">
          <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold shrink-0">Active</span>
          <span className="font-semibold text-slate-200 text-xs truncate max-w-[220px]">{activeMeeting.title}</span>
          <span className="text-[11px] text-slate-500 shrink-0">{fmtDate(activeMeeting.scheduledStart)} · {fmtTime(activeMeeting.scheduledStart)}</span>
          <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border shrink-0 ${PHASE1_STATUS_STYLE[activeMeeting.phase1Status] || PHASE1_STATUS_STYLE.Scheduled}`}>
            {activeMeeting.phase1Status}
          </span>
          {activeMeeting.rescheduleRequest?.reviewStatus === 'pending' && (
            <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5 font-medium shrink-0">
              Reschedule pending · {new Date(activeMeeting.rescheduleRequest.requestedStart).toLocaleDateString()}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => handleOpenInvitePanel(activeMeeting.id)}
              className="flex items-center gap-1 bg-sky-600/15 hover:bg-sky-600/25 border border-sky-500/25 text-sky-400 text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors"
            >
              <Mail className="w-3 h-3" />
              Invitations
              {(inviteCounts.sent || 0) > 0 && (
                <span className="bg-sky-500/20 text-sky-300 text-[9px] font-bold px-1 py-0.5 rounded-full ml-0.5">{inviteCounts.sent}</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab navigation ── */}
      <div className="flex items-center border-b border-slate-800/80">
        <button
          onClick={() => setActiveTab('meetings')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors ${activeTab === 'meetings' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
        >
          <CalendarRange className="w-3.5 h-3.5" />
          Meetings
        </button>
        <button
          onClick={() => setActiveTab('action_points')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors ${activeTab === 'action_points' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
        >
          <Zap className="w-3.5 h-3.5" />
          Action Points
        </button>
        <button
          onClick={() => setActiveTab('tracker')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors ${activeTab === 'tracker' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
        >
          <ClipboardList className="w-3.5 h-3.5" />
          Tracker
        </button>
      </div>

      {/* ══════════════ MEETINGS TAB ══════════════ */}
      {activeTab === 'meetings' && (
      <div className="space-y-3 pt-1">

          {/* Calendar + Meeting Participants, side by side. Picking a meeting
              now happens directly on the calendar — hover (or tap) a day
              with events to see all of that day's meetings and click the
              one you want, instead of a separate list underneath. Also
              fixes a real bug the old click-to-select had: clicking a day
              with more than one meeting always jumped to the first one,
              with no way to reach the second. */}
          {(() => {
            const showParticipants = activeMeeting && (activeMeeting.status === 'scheduled' || activeMeeting.status === 'approval_pending');
            const handleCalendarMeetingClick = (m) => {
              setActiveMeeting(m);
              if (aiPollTimer.current) clearTimeout(aiPollTimer.current);
              setAiMeetingId(m.id);
              setAiRecommendations([]);
              setAiError('');
              setAiPolling(false);
            };
            return (
              <div className="glass-panel border border-slate-700/40 grid lg:grid-cols-[minmax(380px,480px)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-slate-700/70">
                <CustomCalendar
                  embedded
                  meetings={meetings}
                  current={calendarMonth}
                  onNavigate={setCalendarMonth}
                  onMeetingClick={handleCalendarMeetingClick}
                />

                <div className="p-4 flex flex-col">
                  {/* ── Meeting Participants ────────────────────────────── */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs font-bold text-slate-200">Meeting Participants</span>
                      {showParticipants && (
                        <span className="ml-auto text-[10px] text-slate-600">
                          {(activeMeeting.attendees || []).length} person{(activeMeeting.attendees || []).length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {!showParticipants ? (
                      <p className="text-[10px] text-slate-600 italic">Select a scheduled meeting above to view or manage its participants.</p>
                    ) : (
                      <div className="space-y-3">
                        {/* Participants list */}
                        {(activeMeeting.attendees || []).length === 0 ? (
                          <p className="text-[10px] text-slate-600 italic">No participants yet — add someone below or send a booking invite.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {(activeMeeting.attendees || []).map((a) => (
                              <li key={a.email} className="flex items-center gap-2 group">
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs text-slate-200 truncate block">{a.email}</span>
                                  {a.name && <span className="text-[10px] text-slate-500 truncate block">{a.name}</span>}
                                </div>
                                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                                  a.role === 'primary'
                                    ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25'
                                    : 'bg-slate-700/40 text-slate-400 border-slate-700/60'
                                }`}>
                                  {a.role === 'primary' ? 'Customer' : 'CC'}
                                </span>
                                {a.role !== 'primary' && (
                                  <button
                                    onClick={() => handleRemoveParticipant(a.email)}
                                    disabled={savingParticipants}
                                    className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 disabled:opacity-30 transition-all"
                                    title="Remove participant"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Add participant form */}
                        <form onSubmit={handleAddParticipant} className="pt-1 border-t border-slate-800/60 space-y-2">
                          <p className="text-[10px] text-slate-600">Add someone — they'll receive all future meeting emails (reminders, brief).</p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="email"
                              required
                              placeholder="participant@company.com"
                              value={addParticipantEmail}
                              onChange={(e) => setAddParticipantEmail(e.target.value)}
                              className="flex-1 min-w-0 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none transition-colors"
                            />
                            <input
                              type="text"
                              placeholder="Name (opt.)"
                              value={addParticipantName}
                              onChange={(e) => setAddParticipantName(e.target.value)}
                              className="sm:w-32 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none transition-colors"
                            />
                            <button
                              type="submit"
                              disabled={savingParticipants || !addParticipantEmail}
                              className="shrink-0 flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              Add
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Meeting List */}
          <MeetingList
            meetings={meetings}
            onTriggerWorkflow={handleTriggerScan}
            onReviewMeeting={handleReviewMeeting}
            onReviewReschedule={handleReviewReschedule}
            onRequestReschedule={handleRequestReschedule}
            onConductMeeting={handleConductMeeting}
            onCloseMeeting={handleCloseMeeting}
          />

          {/* ── Test NXG360 Findings Upload — scheduled or approval_pending ── */}
          {(activeMeeting?.status === 'scheduled' || activeMeeting?.status === 'approval_pending' || activeMeeting?.status === 'conducted') && (
            <div className="glass-panel overflow-hidden border border-amber-500/20">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/60 bg-amber-500/5">
                <Upload className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">Upload Test NXG360 Findings</span>
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 font-bold uppercase tracking-wide">Dev</span>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                <p className="text-[10px] text-slate-500">
                  Bypass live NXG360 for testing — upload Critical &amp; Medium findings. Immediately runs AI analysis.
                  {activeMeeting?.status === 'scheduled' && <span className="text-amber-500/80"> Also triggers the T-48 workflow.</span>}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <label
                    htmlFor="test-findings-input"
                    className={`inline-flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer px-3 py-1.5 rounded-lg border transition-colors
                      ${testUploadLoading
                        ? 'opacity-50 pointer-events-none border-slate-700 text-slate-500'
                        : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:border-amber-400/60'}`}
                  >
                    {testUploadLoading
                      ? <RefreshCw className="w-3 h-3 animate-spin" />
                      : <Upload className="w-3 h-3" />}
                    {testUploadLoading ? 'Uploading…' : 'Choose file (CSV / XLSX / DOCX)'}
                  </label>
                  <input
                    id="test-findings-input"
                    ref={testFindingsInputRef}
                    type="file"
                    accept=".csv,.xlsx,.docx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={handleUploadTestFindings}
                    disabled={testUploadLoading}
                  />
                </div>
                {testUploadMsg ? (
                  <p className={`text-[10px] flex items-start gap-1.5 ${testUploadMsg.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {testUploadMsg.type === 'success'
                      ? <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                      : <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />}
                    {testUploadMsg.text}
                  </p>
                ) : briefData?.findings?.length > 0 ? (
                  <p className="text-[10px] flex items-start gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                    {briefData.findings.length} findings already loaded — use <span className="font-semibold text-violet-400 mx-0.5">Re-run AI</span> in the Brief above to regenerate tasks.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {/* Brief — shown for approval_pending and conducted */}
          {(activeMeeting?.status === 'approval_pending' || activeMeeting?.status === 'conducted') && (
            <div className="glass-panel overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">
                    {activeMeeting?.status === 'conducted' ? 'Findings Brief' : 'Pre-Meeting Brief'}
                  </span>
                  {activeMeeting?.status !== 'conducted' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold uppercase">T-48</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {(briefLoading || reAnalyzeLoading) && <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />}
                  {briefData && !briefLoading && (
                    <>
                      <button
                        onClick={handleReAnalyze}
                        disabled={reAnalyzeLoading || aiPolling || aiAnalyzing}
                        title={aiPolling || aiAnalyzing ? 'AI analysis is already running' : 'Re-run AI analysis on saved findings'}
                        className="flex items-center gap-1 text-[10px] font-semibold text-violet-400 hover:text-violet-300 border border-violet-500/30 hover:border-violet-500/60 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {reAnalyzeLoading
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <Sparkles className="w-3 h-3" />}
                        {reAnalyzeLoading ? 'Analyzing…' : 'Re-run AI'}
                      </button>
                      <button
                        onClick={handleExportBriefPDF}
                        disabled={pdfExportLoading}
                        className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-600 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {pdfExportLoading
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <FileDown className="w-3 h-3" />}
                        {pdfExportLoading ? 'Exporting…' : 'Export PDF'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="p-4 space-y-3">
                {briefLoading && <p className="text-xs text-slate-500">Loading brief…</p>}
                {reAnalyzeMsg && (
                  <p className="text-[11px] text-violet-400 flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 animate-spin shrink-0" />{reAnalyzeMsg}
                  </p>
                )}
                {!briefLoading && briefData && (
                  <>
                    {/* Severity count summary bar */}
                    {briefData.findings.length > 0 && (() => {
                      const sc = { critical: 0, high: 0, medium: 0, low: 0 };
                      briefData.findings.forEach((f) => { if (sc[f.severity] !== undefined) sc[f.severity]++; });
                      return (
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            NXG360 Findings ({briefData.findings.length})
                          </span>
                          <div className="flex items-center gap-2 flex-wrap">
                            {sc.critical > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">● Critical {sc.critical}</span>}
                            {sc.high     > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">● High {sc.high}</span>}
                            {sc.medium   > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">● Medium {sc.medium}</span>}
                            {sc.low      > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600">● Low {sc.low}</span>}
                          </div>
                        </div>
                      );
                    })()}
                    {briefData.findings.length === 0 ? (
                      <p className="text-xs text-slate-600 italic">No findings for this meeting yet.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {briefData.findings.map((f) => {
                          const sevColor = { critical: 'border-rose-500/30 bg-rose-500/5', high: 'border-amber-500/30 bg-amber-500/5', medium: 'border-indigo-500/30 bg-indigo-500/5', low: 'border-slate-600 bg-slate-800/40' }[f.severity] || 'border-slate-600 bg-slate-800/40';
                          const sevText  = { critical: 'text-rose-400 border-rose-500/30 bg-rose-500/5', high: 'text-amber-400 border-amber-500/30 bg-amber-500/5', medium: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/5', low: 'text-slate-400 border-slate-600 bg-slate-800/40' }[f.severity] || 'text-slate-400 border-slate-600 bg-slate-800/40';
                          return (
                            <div key={f.id} className={`rounded-lg border px-3 py-2 ${sevColor}`}>
                              <div className="flex items-center gap-2">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase shrink-0 ${sevText}`}>{f.severity}</span>
                                <p className="text-xs font-semibold text-slate-200 leading-tight">{f.title}</p>
                              </div>
                              {f.description && (
                                <p className="text-[10px] text-slate-400 mt-1 pl-0.5 leading-relaxed">{f.description}</p>
                              )}
                              {(f.category || f.systemAffected) && (
                                <p className="text-[10px] text-slate-500 mt-0.5 pl-0.5">{[f.category, f.systemAffected].filter(Boolean).join(' · ')}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                      {briefData.recommendations.length > 0 ? (
                        <>
                          <Sparkles className="w-3 h-3 text-violet-400 shrink-0" />
                          <span className="text-[11px] text-slate-400">
                            <span className="font-semibold text-violet-400">{briefData.recommendations.length}</span> AI rec{briefData.recommendations.length !== 1 ? 's' : ''} generated — review in <span className="text-violet-300 font-semibold">AI Tasks</span> below.
                          </span>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Cpu className="w-3 h-3 text-slate-600 shrink-0" />
                          <span className="text-[11px] text-slate-500">AI analysis pending — click <span className="text-violet-400 font-semibold">Re-run AI</span> above to generate tasks.</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {!briefLoading && !briefData && (
                  <p className="text-xs text-slate-600 italic">Brief unavailable — trigger the workflow to generate findings.</p>
                )}
              </div>
            </div>
          )}

          {/* AI Generated Tasks — collapsible — moved directly below Findings Brief */}
          <div className="glass-panel overflow-hidden">
            <button
              type="button"
              onClick={() => setAiPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-xs font-semibold text-slate-300">AI Generated Tasks</span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${!aiProviderConfig ? 'bg-slate-600 animate-pulse' : aiProviderConfig.online ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  title={!aiProviderConfig ? 'Checking…' : aiProviderConfig.online ? 'Ollama online' : aiProviderConfig.configured ? 'Ollama unreachable' : 'Not configured'} />
                {aiRecommendations.filter((r) => r.approvalStatus === 'pending').length > 0 && (
                  <span className="bg-violet-500/20 text-violet-300 border border-violet-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {aiRecommendations.filter((r) => r.approvalStatus === 'pending').length} pending
                  </span>
                )}
              </div>
              {aiPanelOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
            </button>

            {aiPanelOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-slate-800/60 space-y-3">
                {aiProviderConfig && !aiProviderConfig.online && (
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${!aiProviderConfig.configured ? 'bg-slate-800/60 border-slate-700/50 text-slate-400' : 'bg-amber-500/5 border-amber-500/20 text-amber-300'}`}>
                    <WifiOff className="w-3.5 h-3.5 shrink-0" />
                    {!aiProviderConfig.configured ? 'Ollama not configured — set OLLAMA_BASE_URL in backend/.env.' : 'Ollama unreachable. Make sure Ollama is running.'}
                  </div>
                )}
                <div className="flex gap-2">
                  <select
                    value={aiMeetingId}
                    onChange={(e) => {
                      if (aiPollTimer.current) clearTimeout(aiPollTimer.current);
                      setAiMeetingId(e.target.value);
                      setAiRecommendations([]);
                      setAiError('');
                      setAiPolling(false);
                    }}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-violet-500 transition-colors">
                    <option value="">Select a meeting…</option>
                    {meetings.map((m) => <option key={m.id} value={m.id}>{m.title || m.id} — {m.status}</option>)}
                  </select>
                  <button onClick={handleAnalyzeAI}
                    disabled={!aiMeetingId || aiAnalyzing || aiPolling || (aiProviderConfig != null && !aiProviderConfig.online)}
                    title={aiProviderConfig && !aiProviderConfig.online ? 'Ollama is offline' : undefined}
                    className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0">
                    {aiAnalyzing
                      ? <><Cpu className="w-3.5 h-3.5 animate-pulse" /><span>Starting…</span></>
                      : aiPolling
                        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>Checking…</span></>
                        : aiRecommendations.length > 0
                          ? <><Sparkles className="w-3.5 h-3.5" /><span>Re-Analyze</span></>
                          : <><Sparkles className="w-3.5 h-3.5" /><span>Analyze</span></>
                    }
                  </button>
                  <button onClick={() => handleLoadRecommendations(aiMeetingId)} title="Reload recommendations"
                    disabled={!aiMeetingId}
                    className="p-2 text-slate-500 hover:text-slate-300 border border-slate-800 rounded-lg transition-colors disabled:opacity-40">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                {aiPolling && (
                  <p className="text-[10px] text-violet-400 flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                    AI is generating tasks — checking every 10 s, up to 5 min. Tasks will appear as they are generated.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider shrink-0">Model</span>
                  {aiProviderConfig?.availableModels?.length > 0 ? (
                    <select value={aiSelectedModel} onChange={(e) => setAiSelectedModel(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 outline-none focus:border-violet-500 transition-colors">
                      {aiProviderConfig.availableModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-slate-500 font-mono">
                      {aiProviderConfig?.primaryModel || 'llama3.2'}
                      {aiProviderConfig && !aiProviderConfig.configured && <span className="ml-2 text-amber-500">(not connected)</span>}
                    </span>
                  )}
                  {aiProviderConfig?.fallbackModel && (
                    <span className="text-[9px] text-slate-600 shrink-0">fallback: <span className="text-slate-500">{aiProviderConfig.fallbackModel}</span></span>
                  )}
                </div>
                {aiError && (
                  <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg px-3 py-2.5 text-xs text-rose-300">
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />{aiError}
                  </div>
                )}
                {activeMeeting?.notesStatus === 'processing' && aiRecommendations.every((r) => r.approvalStatus === 'pending') ? (
                  <div className="flex items-center gap-2 rounded-lg bg-violet-500/5 border border-violet-500/20 px-3 py-3 text-xs text-violet-300">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                    AI is generating new tasks from the meeting transcript. Previous suggestions are being replaced — they will appear here when ready.
                  </div>
                ) : aiRecommendations.length > 0 ? (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    {aiRecommendations.map((rec) => {
                      const isPending  = rec.approvalStatus === 'pending';
                      const isApproved = rec.approvalStatus === 'approved';
                      const isRejected = rec.approvalStatus === 'rejected';
                      const loading    = aiActionLoading[rec.id];
                      const sevColor   = { critical: 'text-rose-400 border-rose-500/30 bg-rose-500/5', high: 'text-amber-400 border-amber-500/30 bg-amber-500/5', medium: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/5', low: 'text-slate-400 border-slate-600 bg-slate-800/40' }[rec.severity] || 'text-slate-400 border-slate-600 bg-slate-800/40';
                      return (
                        <div key={rec.id} className={`rounded-xl border p-3 space-y-2 transition-all ${isApproved ? 'border-emerald-500/30 bg-emerald-500/5 opacity-75' : isRejected ? 'border-slate-700/50 bg-slate-900/40 opacity-50' : 'border-slate-800/60 bg-slate-900/30'}`}>
                          <div className="flex items-start gap-2">
                            <p className={`flex-1 text-xs font-semibold leading-tight ${isRejected ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{rec.title}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${sevColor}`}>{rec.severity}</span>
                              {rec.analysisType === 'post_meeting' && <span className="text-[9px] px-1.5 py-0.5 rounded border border-teal-500/30 bg-teal-500/10 text-teal-400 font-bold">Post</span>}
                              {isApproved && <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold">Approved</span>}
                              {isRejected && <span className="text-[9px] px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-500 font-bold">Rejected</span>}
                            </div>
                          </div>
                          {!isRejected && (
                            <div className="space-y-1">
                              {rec.actionPlan && <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">{rec.actionPlan}</p>}
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                                {rec.category && <span>Category: <span className="text-slate-400">{rec.category}</span></span>}
                                {rec.recommendedOwner && <span>Owner: <span className="text-slate-400">{rec.recommendedOwner}</span></span>}
                                {rec.dueDateSuggestion && <span>Due: <span className="text-slate-400">{rec.dueDateSuggestion.slice(0, 10)}</span></span>}
                              </div>
                            </div>
                          )}
                          {isPending && (
                            <div className="flex gap-2 pt-1 flex-wrap">
                              <button onClick={() => handleApproveRec(rec)} disabled={!!loading}
                                className="flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                <ThumbsUp className="w-3 h-3" />
                                {loading === 'approving' ? 'Approving…' : 'Approve → Task'}
                              </button>
                              <button
                                onClick={() => setEditModal({ id: rec.id, title: rec.title || '', actionPlan: rec.actionPlan || '', businessImpact: rec.businessImpact || '', recommendedOwner: rec.recommendedOwner || '', dueDateSuggestion: rec.dueDateSuggestion ? rec.dueDateSuggestion.slice(0, 10) : '' })}
                                disabled={!!loading}
                                className="flex items-center gap-1 bg-slate-800/60 hover:bg-indigo-500/10 border border-slate-700 hover:border-indigo-500/30 text-slate-400 hover:text-indigo-400 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                              <button onClick={() => { setRejectModal({ id: rec.id, tenantId }); setRejectReason(''); }} disabled={!!loading}
                                className="flex items-center gap-1 bg-slate-800/60 hover:bg-rose-500/10 border border-slate-700 hover:border-rose-500/30 text-slate-400 hover:text-rose-400 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                <ThumbsDown className="w-3 h-3" />
                                {loading === 'rejecting' ? 'Rejecting…' : 'Reject'}
                              </button>
                            </div>
                          )}
                          {isApproved && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[10px] text-emerald-400"><CheckCircle2 className="w-3 h-3 inline mr-1" />Task created — approved by {rec.approvedBy}</p>
                              {rec.taskId && (
                                cuPushed[rec.id] || rec.clickupTaskId ? (
                                  rec.clickupUrl ? (
                                    <a href={rec.clickupUrl} target="_blank" rel="noreferrer"
                                      className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-400 font-bold flex items-center gap-0.5">
                                      <CheckCircle2 className="w-2.5 h-2.5" /> In ClickUp ↗
                                    </a>
                                  ) : (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-400 font-bold flex items-center gap-0.5">
                                      <CheckCircle2 className="w-2.5 h-2.5" /> In ClickUp
                                    </span>
                                  )
                                ) : (
                                  <button type="button" onClick={() => handlePushClickUp(rec)} disabled={!!cuPushLoading[rec.id]}
                                    className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 font-bold flex items-center gap-0.5 transition-colors disabled:opacity-50">
                                    {cuPushLoading[rec.id] ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Upload className="w-2.5 h-2.5" />}
                                    Push to ClickUp
                                  </button>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  !aiAnalyzing && !aiError && !aiPolling && (
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {aiMeetingId
                        ? <>No tasks yet — click <span className="text-violet-400 font-semibold">Analyze</span> to generate AI recommendations, or use <span className="text-violet-400 font-semibold">Re-run AI</span> in the Pre-Meeting Brief above.</>
                        : <>Select a meeting to load existing tasks, or click <span className="text-violet-400 font-semibold">Analyze</span> to generate new ones.</>
                      }
                    </p>
                  )
                )}
              </div>
            )}
          </div>

          {/* Meeting Notes — conducted / closed only */}
          {(activeMeeting?.status === 'conducted' || activeMeeting?.status === 'closed') && (
            <MeetingNotesPanel
              meeting={activeMeeting}
              tenantId={tenantId}
              selectedModel={aiSelectedModel || undefined}
              onNotesCompleted={() => handleLoadRecommendations(activeMeeting.id)}
            />
          )}

          {/* ── Phase 11: Transcript Status — conducted / closed only — moved to the very bottom, after Meeting Notes ── */}
          {(activeMeeting?.status === 'conducted' || activeMeeting?.status === 'closed') && activeMeeting?.transcriptStatus && activeMeeting.transcriptStatus !== 'not_started' && (
            <div className="glass-panel p-4 border border-slate-700/30 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-bold text-slate-300">Meeting Transcript</span>
                </div>
                {activeMeeting.transcriptStatus === 'fetching' && (
                  <span className="text-[9px] px-2 py-0.5 rounded border font-bold uppercase bg-blue-500/15 text-blue-400 border-blue-500/25 flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />Fetching…
                  </span>
                )}
                {activeMeeting.transcriptStatus === 'captured' && (
                  <span className="text-[9px] px-2 py-0.5 rounded border font-bold uppercase bg-emerald-500/15 text-emerald-400 border-emerald-500/25">Captured</span>
                )}
                {activeMeeting.transcriptStatus === 'unavailable' && (
                  <span className="text-[9px] px-2 py-0.5 rounded border font-bold uppercase bg-slate-500/15 text-slate-400 border-slate-500/25">Unavailable</span>
                )}
                {activeMeeting.transcriptStatus === 'skipped' && (
                  <span className="text-[9px] px-2 py-0.5 rounded border font-bold uppercase bg-slate-500/15 text-slate-500 border-slate-600/25">No Teams Link</span>
                )}
              </div>
              {activeMeeting.transcriptStatus === 'fetching' && (
                <p className="text-[10px] text-slate-500">
                  {activeMeeting.teamsJoinUrl
                    ? 'Polling Microsoft Teams for transcript — checks every 15 min, up to 2 hours after meeting ended.'
                    : 'Polling Fireflies AI for transcript — checks every 15 min, up to 2 hours after meeting ended.'}
                </p>
              )}
              {activeMeeting.transcriptStatus === 'captured' && activeMeeting.transcriptText && (
                <pre className="text-[10px] text-slate-400 bg-slate-900/60 rounded-lg p-3 max-h-48 sm:max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words leading-relaxed border border-slate-800/50">
                  {activeMeeting.transcriptText}
                </pre>
              )}
              {activeMeeting.transcriptStatus === 'captured' && !activeMeeting.transcriptText && (
                <p className="text-[10px] text-slate-500">Transcript captured but content is empty.</p>
              )}
              {activeMeeting.transcriptStatus === 'unavailable' && (
                <p className="text-[10px] text-slate-500">No transcript was available from Microsoft Teams after 2 hours of polling.</p>
              )}
              {activeMeeting.transcriptFetchedAt && activeMeeting.transcriptStatus === 'captured' && (
                <p className="text-[10px] text-slate-600">
                  Fetched: {new Date(activeMeeting.transcriptFetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          )}
      </div>
      )} {/* end Meetings tab */}

      {/* ══════════════ TRACKER TAB ══════════════ */}
      {activeTab === 'tracker' && (
        <div className="pt-3">
          <TrackerTaskList embedded />
        </div>
      )}

      {/* ══════════════ ACTION POINTS TAB ══════════════ */}
      {activeTab === 'action_points' && (
        <div className="space-y-3 pt-1">

          {/* Meeting context header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Action Points</h3>
            </div>
            <div className="flex items-center gap-2">
              {activeMeeting && (
                <button
                  type="button"
                  onClick={() => { setShowEmailForm((v) => !v); setEmailResult(null); setEmailError(''); }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-colors ${showEmailForm ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-amber-500/40 hover:text-amber-300'}`}
                >
                  <Send className="w-3 h-3" />
                  Send Email
                </button>
              )}
              {activeMeeting ? (
                <span className="text-[10px] text-amber-400/80 font-medium truncate max-w-[160px]">{activeMeeting.title}</span>
              ) : (
                <span className="text-[10px] text-slate-600 font-medium">No meeting selected</span>
              )}
            </div>
          </div>

          {/* Inline send-email form */}
          {showEmailForm && activeMeeting && (
            <div className="glass-panel px-4 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <Send className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">Send Post-Meeting Action Points</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Approved post-meeting tasks will be attached as a PDF. Each task includes a secure link for the customer to confirm completion (valid 30 days).
              </p>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Recipient Email(s) <span className="text-slate-600 normal-case font-normal">— comma-separated, max 10</span>
                </label>
                <textarea
                  rows={2}
                  value={emailInput}
                  onChange={(e) => { setEmailInput(e.target.value); setEmailError(''); setEmailResult(null); }}
                  placeholder="customer@company.com, ciso@company.com"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/60 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors resize-none placeholder-slate-600"
                />
              </div>
              {emailError && (
                <p className="text-[11px] text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />{emailError}
                </p>
              )}
              {emailResult && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-[11px] font-bold text-emerald-400">Email sent successfully</p>
                  <p className="text-[10px] text-emerald-400/70">
                    {emailResult.taskCount} task{emailResult.taskCount !== 1 ? 's' : ''} · {emailResult.sent} recipient{emailResult.sent !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowEmailForm(false); setEmailInput(''); setEmailResult(null); setEmailError(''); }}
                  className="px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={emailSending || !emailInput.trim()}
                  onClick={handleSendEmail}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-[11px] font-bold rounded-lg transition-colors"
                >
                  {emailSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  {emailSending ? 'Sending…' : 'Send Email'}
                </button>
              </div>
            </div>
          )}

          {!activeMeeting ? (
            <div className="glass-panel px-4 py-10 flex flex-col items-center gap-2 text-center">
              <Zap className="w-6 h-6 text-slate-700" />
              <p className="text-xs font-semibold text-slate-500">No meeting selected</p>
              <p className="text-[11px] text-slate-600 max-w-[260px] leading-relaxed">
                Select a meeting from the calendar or the Meetings tab to view its open action points.
              </p>
            </div>
          ) : (
            <div className="glass-panel overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-slate-200">Tasks to Discuss in Meeting</span>
                  {agendaTasks.length > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
                      {agendaTasks.length}
                    </span>
                  )}
                </div>
                {agendaLoading && <RefreshCw className="w-3 h-3 text-slate-500 animate-spin" />}
              </div>
              {agendaLoading && agendaTasks.length === 0 ? (
                <p className="px-4 py-3 text-[11px] text-slate-500">Loading agenda…</p>
              ) : agendaTasks.length === 0 ? (
                <div className="px-4 py-8 flex flex-col items-center gap-1.5 text-center">
                  <ClipboardList className="w-5 h-5 text-slate-700" />
                  <p className="text-[11px] text-slate-600 font-medium">No open tasks for this meeting yet.</p>
                  <p className="text-[10px] text-slate-700 max-w-[240px] leading-relaxed mt-0.5">Tasks appear here after AI analysis runs or when tasks are manually created in the Tracker.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/40">
                  {agendaTasks.map((task) => {
                    const isExpanded = expandedTaskId === task.id;
                    const statusStyle = {
                      open:          'bg-slate-700/50 text-slate-400 border-slate-600/50',
                      in_progress:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
                      completed:     'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                      closed:        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                      carry_forward: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                      overdue:       'bg-rose-500/10 text-rose-400 border-rose-500/20',
                      blocked:       'bg-orange-500/10 text-orange-400 border-orange-500/20',
                    }[task.remediationStatus || 'open'] || 'bg-slate-700/50 text-slate-400 border-slate-600/50';
                    const priorityColor = { critical: 'text-rose-400', high: 'text-amber-400', medium: 'text-blue-400', low: 'text-slate-500' }[task.priority] || 'text-slate-500';
                    return (
                      <div key={task.id}>
                        <button
                          type="button"
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
                          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                        >
                          <ChevronRight className={`w-3 h-3 text-slate-600 shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
                          <span className={`text-[9px] font-bold uppercase shrink-0 w-10 ${priorityColor}`}>{task.priority || '—'}</span>
                          <span className="flex-1 text-xs text-slate-200 text-left truncate">{task.title}</span>
                          {(task.progressPercentage > 0) && (
                            <span className="text-[10px] text-slate-500 shrink-0">{task.progressPercentage}%</span>
                          )}
                          <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border shrink-0 ${statusStyle}`}>
                            {(task.remediationStatus || 'open').replace(/_/g, ' ')}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="pl-12 pr-4 pb-4 space-y-3 bg-slate-900/20 border-t border-slate-800/40">
                            {task.actionPlan && (
                              <div className="pt-3 space-y-1">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Action Plan</p>
                                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{task.actionPlan}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[10px]">
                              {task.ownerName && (
                                <span><span className="text-slate-600">Owner:</span> <span className="text-slate-400">{task.ownerName}</span></span>
                              )}
                              {task.dueDate && (
                                <span><span className="text-slate-600">Due:</span> <span className="text-slate-400">{new Date(task.dueDate).toLocaleDateString()}</span></span>
                              )}
                              {(task.carryForwardCount > 0) && (
                                <span><span className="text-slate-600">Carried:</span> <span className="text-amber-400">{task.carryForwardCount}×</span></span>
                              )}
                              {(task.escalationCount > 0) && (
                                <span><span className="text-slate-600">Escalations:</span> <span className="text-rose-400">{task.escalationCount}</span></span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )} {/* end Action Points tab */}

      {/* ══ Invitation Modal ══ */}
      {showInvitePanel && activeMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#1A1814]/60 backdrop-blur-sm" onClick={() => setShowInvitePanel(false)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl shadow-black/50 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-200">Meeting Invitations</h3>
                <span className="text-[10px] text-slate-500 truncate max-w-[180px]">{activeMeeting.title}</span>
              </div>
              <button onClick={() => setShowInvitePanel(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSendInvite} className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Email</label>
                <input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@company.com"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Name (opt.)</label>
                <input type="text" value={inviteName} onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Contact Name"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors" />
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={inviteSending}
                  className="w-full flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                  <Mail className="w-3 h-3" />
                  {inviteSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
            {inviteError && (
              <p className="text-xs text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{inviteError}</p>
            )}
            {invitations.length > 0 ? (
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg border border-slate-800/50 bg-slate-900/30">
                    <div>
                      <span className="text-slate-200 font-medium">{inv.recipientEmail}</span>
                      {inv.recipientName && <span className="text-slate-500 ml-2">({inv.recipientName})</span>}
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase ${inv.status === 'sent' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : inv.status === 'pending' ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' : inv.status === 'cancelled' ? 'bg-slate-700/40 text-slate-500 border-slate-600/50' : 'bg-rose-500/15 text-rose-400 border-rose-500/25'}`}>
                      {inv.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic">No invitations sent yet for this meeting.</p>
            )}
          </div>
        </div>
      )}

      {/* ══ Send Booking Link Modal ══ */}
      {showBookingLinkModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#1A1814]/60 backdrop-blur-sm" onClick={() => setShowBookingLinkModal(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60 overflow-y-auto max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white leading-tight">Send Booking Link</p>
                  <p className="text-[10px] text-slate-500 leading-tight">{selectedTenant?.name}</p>
                </div>
              </div>
              <button onClick={() => setShowBookingLinkModal(false)} className="p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 overflow-y-auto max-h-[calc(90vh-64px)]">

              {/* ── Calendly URL ── */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Your Calendly Link <span className="text-rose-400">*</span>
                </label>
                <input
                  type="url"
                  placeholder="https://calendly.com/your-name/security-review"
                  value={bookingCalendlyUrl}
                  onChange={(e) => setBookingCalendlyUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <p className="text-[10px] text-slate-600 mt-1">Saved automatically after first send — won't need to re-enter next time.</p>
              </div>

              {/* ── Meeting context ── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Meeting Title</label>
                  <input
                    type="text"
                    placeholder="Security Review Meeting"
                    value={bookingMeetingTitle}
                    onChange={(e) => setBookingMeetingTitle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Duration</label>
                  <select
                    value={bookingDuration}
                    onChange={(e) => setBookingDuration(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    {[30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} minutes</option>)}
                  </select>
                </div>
              </div>

              {/* ── Participants section ── */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">

                {/* Section header */}
                <div className="flex items-center justify-between bg-slate-900/80 px-3.5 py-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Participants</span>
                  </div>
                  {(bookingRecipientEmail || blParticipants.length > 0) && (
                    <span className="text-[10px] text-slate-500">
                      {[bookingRecipientEmail, ...blParticipants.map(p => p.email)].filter(Boolean).length} added
                    </span>
                  )}
                </div>

                <div className="divide-y divide-slate-800/60">

                  {/* Primary contact row — always shown */}
                  <div className="px-3.5 py-3 bg-slate-900/40">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">Primary</span>
                      <span className="text-[10px] text-slate-500">Receives the Calendly booking link</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Full name"
                        value={bookingRecipientName}
                        onChange={(e) => setBookingRecipientName(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <input
                        type="email"
                        placeholder="email@company.com"
                        value={bookingRecipientEmail}
                        onChange={(e) => setBookingRecipientEmail(e.target.value)}
                        required
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Added other participants list */}
                  {blParticipants.map((p, idx) => (
                    <div key={p.email} className="flex items-center gap-3 px-3.5 py-2.5 bg-slate-900/20 group">
                      <div className="w-6 h-6 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-slate-300 uppercase">
                          {(p.name || p.email).charAt(0)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        {p.name && <p className="text-xs text-slate-200 font-medium truncate">{p.name}</p>}
                        <p className="text-[10px] text-slate-500 truncate">{p.email}</p>
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full shrink-0">Attendee</span>
                      <button
                        type="button"
                        onClick={() => setBlParticipants((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  {/* Add participant row */}
                  <div className="px-3.5 py-3 bg-slate-900/20">
                    <p className="text-[10px] text-slate-500 mb-2 flex items-center gap-1">
                      <UserPlus className="w-3 h-3" /> Add attendees <span className="text-slate-600">(optional — they just join, don't book)</span>
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Name"
                        value={blParticipantName}
                        onChange={(e) => setBlParticipantName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddBookingParticipant(); } }}
                        className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <input
                        type="email"
                        placeholder="email@company.com"
                        value={blParticipantEmail}
                        onChange={(e) => setBlParticipantEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddBookingParticipant(); } }}
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={handleAddBookingParticipant}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-xs text-slate-200 font-medium transition-colors shrink-0"
                      >
                        <UserPlus className="w-3 h-3" /> Add
                      </button>
                    </div>
                  </div>

                </div>
              </div>

              {/* ── Status message ── */}
              {bookingMsg && (
                <div className={`flex items-start gap-2 text-xs px-3.5 py-2.5 rounded-lg border ${bookingMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                  {bookingMsg.type === 'success'
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                  {bookingMsg.text}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="flex justify-end gap-2 pt-1 pb-1">
                <button
                  type="button"
                  onClick={() => setShowBookingLinkModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendBL}
                  disabled={blSending || !bookingRecipientEmail || !bookingCalendlyUrl}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {blSending ? 'Sending…' : 'Send Booking Link'}
                </button>
              </div>

            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══ New Meeting Modal ══ */}
      {showNewMeetingForm && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#1A1814]/60 backdrop-blur-sm" onClick={handleCloseNewMeetingForm} />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
                  <CalendarRange className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white leading-tight">New Meeting</p>
                  <p className="text-[10px] text-slate-500 leading-tight">{selectedTenant.name}</p>
                </div>
              </div>
              <button onClick={handleCloseNewMeetingForm} className="p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form body */}
            <form onSubmit={handleCreateMeeting} className="px-5 py-4 space-y-3">

              {/* Title */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Meeting Title <span className="text-indigo-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newMeetingTitle}
                  onChange={(e) => setNewMeetingTitle(e.target.value)}
                  placeholder={`Monthly Review — ${selectedTenant.name}`}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none transition-colors"
                />
              </div>

              {/* Date · Time · Duration — single row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    Date <span className="text-indigo-400">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    min={todayStr}
                    value={newMeetingDate}
                    onChange={(e) => {
                      setNewMeetingDate(e.target.value);
                      if (newMeetingDateError) setNewMeetingDateError('');
                    }}
                    className={`w-full bg-slate-900 border rounded-lg px-2.5 py-2 text-xs text-slate-100 outline-none transition-colors ${
                      newMeetingDateError ? 'border-rose-500 focus:border-rose-400' : 'border-slate-800 focus:border-indigo-500'
                    }`}
                  />
                  {newMeetingDateError && (
                    <p className="text-[10px] text-rose-400 leading-tight mt-0.5">{newMeetingDateError}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    Time <span className="text-indigo-400">*</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={newMeetingTime}
                    onChange={(e) => setNewMeetingTime(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-2.5 py-2 text-xs text-slate-100 outline-none transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Duration</label>
                  <select
                    value={newMeetingDuration}
                    onChange={(e) => setNewMeetingDuration(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-2.5 py-2 text-xs text-slate-100 outline-none transition-colors cursor-pointer"
                  >
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>60 min</option>
                    <option value={90}>90 min</option>
                    <option value={120}>2 hrs</option>
                  </select>
                </div>
              </div>

              {/* Timezone — full width, compact */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Timezone</label>
                <select
                  value={newMeetingTimezone}
                  onChange={(e) => setNewMeetingTimezone(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors cursor-pointer"
                >
                  {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>

              {/* Recurrence — sets up this tenant's ongoing cadence. Once this
                  meeting is closed (AI tasks generated + approved), the next
                  occurrence auto-schedules on this pattern automatically. */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Recurrence</label>
                <select
                  value={recurrencePattern}
                  onChange={(e) => setRecurrencePattern(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors cursor-pointer"
                >
                  <option value="monthly_day_of_month">Monthly (Same Date)</option>
                  <option value="monthly_day_of_week">Monthly (Same Weekday)</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="biweekly">Bi-Weekly</option>
                  <option value="weekly">Weekly</option>
                </select>
                <p className="text-[10px] text-slate-600">Once this meeting is closed, the next one auto-schedules on this pattern.</p>
              </div>

              {/* External Teams URL — for meetings already scheduled in Teams/Calendly */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Teams Meeting URL <span className="font-normal normal-case text-slate-600">— optional, if already scheduled in Teams</span>
                </label>
                <input
                  type="url"
                  value={newMeetingTeamsUrl}
                  onChange={(e) => setNewMeetingTeamsUrl(e.target.value)}
                  placeholder="https://teams.microsoft.com/l/meetup-join/..."
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none transition-colors"
                />
              </div>

              {/* Participants */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Participants <span className="font-normal normal-case text-slate-600">— optional, receives invitation</span>
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newAttendeeName}
                    onChange={(e) => setNewAttendeeName(e.target.value)}
                    placeholder="Name"
                    className="w-28 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none transition-colors"
                  />
                  <input
                    type="email"
                    value={newAttendeeEmail}
                    onChange={(e) => setNewAttendeeEmail(e.target.value)}
                    placeholder="email@company.com"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAttendee(); } }}
                    className="flex-1 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleAddAttendee}
                    title="Add participant"
                    className="shrink-0 flex items-center justify-center w-8 h-[30px] bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {newMeetingAttendees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {newMeetingAttendees.map((a) => (
                      <span key={a.email} className="flex items-center gap-1 bg-slate-800/80 border border-slate-700 rounded-full pl-2 pr-1 py-0.5 text-[10px] text-slate-300">
                        {a.role === 'primary' && <span className="text-indigo-400 font-bold text-[9px]">★</span>}
                        <span className="max-w-[110px] truncate">{a.name || a.email}</span>
                        <button type="button" onClick={() => handleRemoveAttendee(a.email)}
                          className="text-slate-500 hover:text-rose-400 transition-colors p-0.5 rounded-full">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Teams auto-create hint */}
              <div className="flex items-center gap-2 rounded-lg bg-indigo-500/5 border border-indigo-500/15 px-3 py-2">
                <Zap className="w-3 h-3 text-indigo-400 shrink-0" />
                <p className="text-[10px] text-slate-400">
                  {newMeetingTeamsUrl.trim()
                    ? 'Your Teams URL will be used — no new calendar event will be created.'
                    : 'A Teams meeting will be created automatically on save.'}
                </p>
              </div>

              {newMeetingSubmitError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-rose-300 leading-relaxed">
                    {newMeetingSubmitError}
                    {!msConnected && (
                      <>
                        {' '}
                        <Link to="/integrations" onClick={handleCloseNewMeetingForm} className="underline hover:text-rose-200">
                          Go to Integrations →
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Footer actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCloseNewMeetingForm}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-200 px-3 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNewMeeting || !newMeetingTitle.trim() || !newMeetingDate}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white text-xs font-semibold px-5 py-2 rounded-lg transition-colors"
                >
                  {savingNewMeeting
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Creating…</>
                    : <><CalendarRange className="w-3.5 h-3.5" /> Create Meeting</>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ══ Workflow modals ══ */}
      <ApprovalWorkflowModal
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        meeting={activeMeeting}
        onWorkflowSaved={handleWorkflowSaved}
      />
      <RescheduleReviewModal
        isOpen={showRescheduleModal}
        meeting={rescheduleMeeting}
        onClose={() => setShowRescheduleModal(false)}
        onReview={handleReviewRescheduleSave}
      />
      <RescheduleRequestForm
        isOpen={showRescheduleRequestForm}
        meeting={rescheduleRequestMeeting}
        onClose={() => setShowRescheduleRequestForm(false)}
        onSubmit={handleRequestRescheduleSave}
      />

      {/* Edit task modal */}
      {editModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#1A1814]/60 backdrop-blur-sm" onClick={() => { setEditModal(null); setEditError(''); }} />
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60 flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
                  <Pencil className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Edit Task</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Review and adjust before approving</p>
                </div>
              </div>
              <button onClick={() => { setEditModal(null); setEditError(''); }} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Title</label>
                <input
                  type="text"
                  value={editModal.title}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Action Plan</label>
                <textarea
                  value={editModal.actionPlan}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, actionPlan: e.target.value }))}
                  rows={5}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors resize-none leading-relaxed"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Business Impact</label>
                <textarea
                  value={editModal.businessImpact}
                  onChange={(e) => setEditModal((prev) => ({ ...prev, businessImpact: e.target.value }))}
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors resize-none leading-relaxed"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Owner</label>
                  <input
                    type="text"
                    value={editModal.recommendedOwner}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, recommendedOwner: e.target.value }))}
                    placeholder="Role or person name"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Due Date</label>
                  <input
                    type="date"
                    value={editModal.dueDateSuggestion}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, dueDateSuggestion: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors"
                  />
                </div>
              </div>
              {editError && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{editError}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-800/80 shrink-0">
              <button onClick={() => { setEditModal(null); setEditError(''); }}
                className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={editSaving || !editModal.title.trim()}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">
                {editSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                {editSaving ? 'Saving…' : 'Save & Approve'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Reject reason modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-panel p-5 w-full max-w-sm space-y-4 mx-4">
            <h3 className="text-sm font-bold text-white">Reject Recommendation</h3>
            <p className="text-xs text-slate-400">Provide a reason (optional). Rejected recommendations are stored for audit history.</p>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection…" rows={3}
              className="w-full bg-slate-900 border border-slate-800 focus:border-rose-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors resize-none" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }}
                className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-3 py-2">Cancel</button>
              <button onClick={handleRejectSubmit}
                className="bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
