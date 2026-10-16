import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import {
  FileText, Upload, CheckCircle2, AlertTriangle, RefreshCw, X, Sparkles,
} from 'lucide-react';

const POLL_INTERVAL_MS = 3000;

const STATUS_BADGE = {
  pending: {
    label: 'Processing Notes',
    cls:   'bg-amber-500/10 border-amber-500/30 text-amber-400',
    spin:  true,
  },
  processing: {
    label: 'AI Analysis Running',
    cls:   'bg-violet-500/10 border-violet-500/30 text-violet-400',
    spin:  true,
  },
  completed: {
    label: 'Analysis Complete',
    cls:   'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    spin:  false,
  },
  failed: {
    label: 'Analysis Failed',
    cls:   'bg-rose-500/10 border-rose-500/30 text-rose-400',
    spin:  false,
  },
};

export default function MeetingNotesPanel({ meeting, tenantId, onNotesCompleted, selectedModel }) {
  const [activeTab,      setActiveTab]      = useState('text');
  const [transcriptText, setTranscriptText] = useState('');
  const [selectedFile,   setSelectedFile]   = useState(null);
  const [submitting,     setSubmitting]      = useState(false);
  const [submitError,    setSubmitError]     = useState('');
  const [noteStatus,     setNoteStatus]      = useState(null);
  const [noteData,       setNoteData]        = useState(null);

  const pollRef      = useRef(null);
  const notifiedRef  = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const note   = await api.meetingLogs.getById(meeting.id);
        const status = note?.aiStatus ?? note?.ai_status ?? null;
        if (!status) return;
        setNoteStatus(status);
        setNoteData(note);
        if (status === 'completed') {
          stopPolling();
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            onNotesCompleted?.();
          }
        } else if (status === 'failed') {
          stopPolling();
        }
      } catch {
        // Transient network error — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [meeting.id, onNotesCompleted, stopPolling]);

  // On mount: check for an existing notes record
  useEffect(() => {
    let active = true;
    api.meetingLogs.getById(meeting.id)
      .then((note) => {
        if (!active) return;
        const status = note?.aiStatus ?? note?.ai_status ?? null;
        if (!status) return;
        setNoteStatus(status);
        setNoteData(note);
        if (status === 'pending' || status === 'processing') {
          startPolling();
        } else if (status === 'completed') {
          notifiedRef.current = true;
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      stopPolling();
    };
  }, [meeting.id, startPolling, stopPolling]);

  const handleTextSubmit = async (e) => {
    e.preventDefault();
    if (!transcriptText.trim()) {
      setSubmitError('Please enter meeting notes before submitting.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    notifiedRef.current = false;

    try {
      await api.meetingLogs.save(meeting.id, {
        transcriptText: transcriptText.trim(),
        summary:        '',
        actionItems:    [],
        decisionsTaken: [],
        risksDiscussed: [],
        followUpActions:[],
      });
      setNoteStatus('pending');
      setTranscriptText('');
      startPolling();
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to save notes.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    setSubmitting(true);
    setSubmitError('');
    notifiedRef.current = false;

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      await api.meetingLogs.upload(meeting.id, formData);
      setNoteStatus('pending');
      setSelectedFile(null);
      startPolling();
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Upload failed.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async () => {
    setSubmitError('');
    notifiedRef.current = false;
    setSubmitting(true);
    try {
      await api.meetingLogs.reanalyze(meeting.id, selectedModel);
      setNoteStatus('pending');
      startPolling();
    } catch (err) {
      setSubmitError(err?.response?.data?.error || 'Re-analysis failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasContent = noteStatus === 'completed' && noteData && (
    (noteData.summary          && noteData.summary.trim())          ||
    (noteData.meetingSummary   && noteData.meetingSummary.trim())   ||
    (noteData.actionItems      && noteData.actionItems.length  > 0) ||
    (noteData.decisionsTaken   && noteData.decisionsTaken.length > 0)
  );

  const badge = noteStatus === 'completed' && !hasContent
    ? { label: 'No Content Extracted', cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400', spin: false }
    : noteStatus ? STATUS_BADGE[noteStatus] : null;

  const isActive = noteStatus === 'pending' || noteStatus === 'processing';

  return (
    <div className="glass-panel p-5 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Meeting Notes</h3>
          <span className="text-[9px] px-1.5 py-0.5 rounded border border-teal-500/30 bg-teal-500/10 text-teal-400 font-bold uppercase tracking-wide">
            Post-Meeting AI
          </span>
        </div>
        {badge && (
          <span className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border font-bold ${badge.cls}`}>
            {badge.spin
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : noteStatus === 'completed'
                ? <CheckCircle2 className="w-3 h-3" />
                : <AlertTriangle className="w-3 h-3" />
            }
            {badge.label}
          </span>
        )}
      </div>

      {/* ── Completed state — has content ── */}
      {noteStatus === 'completed' && hasContent && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Notes processed — post-meeting AI recommendations generated
          </p>
          <p className="text-[11px] text-slate-400">
            Post-meeting tasks are ready in the{' '}
            <span className="text-violet-300 font-semibold">AI Generated Tasks</span> panel below — approve to create tracker tasks.
          </p>
        </div>
      )}

      {/* ── Completed state — empty result ── */}
      {noteStatus === 'completed' && !hasContent && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Analysis ran — no structured content extracted
          </p>
          <p className="text-[11px] text-slate-400">
            The AI could not extract action items or decisions from this transcript. Use <span className="text-violet-300 font-semibold">Re-run AI</span> to try again, or check that the meeting had substantive discussion.
          </p>
        </div>
      )}

      {/* ── Active processing ── */}
      {isActive && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <p className="text-xs text-violet-300 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 animate-pulse shrink-0" />
            AI is analysing the meeting notes and generating task recommendations. This takes a moment…
          </p>
        </div>
      )}

      {/* ── Failed state ── */}
      {noteStatus === 'failed' && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 space-y-2">
          <p className="text-xs text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Analysis failed — re-submit the notes to retry.
          </p>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 border border-rose-500/30 hover:border-rose-400/50 px-2.5 py-1 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* ── Input form — always visible unless actively processing ── */}
      {!isActive && (
        <>
          {noteStatus === 'completed' && (
            <div className="flex items-center gap-2 pt-1">
              <div className="h-px flex-1 bg-slate-800" />
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Update Notes</span>
              <div className="h-px flex-1 bg-slate-800" />
            </div>
          )}
          {/* Tab bar */}
          <div className="flex gap-1 bg-slate-900/60 p-1 rounded-lg border border-slate-800">
            {[
              { id: 'text',   Icon: FileText, label: 'Text / Paste'  },
              { id: 'upload', Icon: Upload,   label: 'Upload File'   },
            ].map(({ id, Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => { setActiveTab(id); setSubmitError(''); }}
                className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-bold py-1.5 rounded-md transition-colors ${
                  activeTab === id
                    ? 'bg-teal-600/20 text-teal-300 border border-teal-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          {/* Text tab */}
          {activeTab === 'text' && (
            <form onSubmit={handleTextSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Meeting Notes
                </label>
                <textarea
                  value={transcriptText}
                  onChange={(e) => setTranscriptText(e.target.value)}
                  placeholder="Paste or type the meeting notes, minutes, or transcript here…"
                  rows={6}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-teal-500 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none transition-colors resize-none leading-relaxed"
                />
                <p className="text-[10px] text-slate-600">
                  {transcriptText.length} chars
                  {transcriptText.length > 0 && transcriptText.length < 200 && (
                    <span className="text-amber-600"> · Add more detail for AI-powered structuring (200+ chars recommended).</span>
                  )}
                </p>
              </div>
              {submitError && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> {submitError}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !transcriptText.trim()}
                  className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  {submitting
                    ? <><RefreshCw className="w-3 h-3 animate-spin" /><span>Submitting…</span></>
                    : noteStatus === 'completed'
                      ? <><RefreshCw className="w-3 h-3" /><span>Update &amp; Re-analyse</span></>
                      : <><Sparkles className="w-3 h-3" /><span>Submit &amp; Analyse</span></>
                  }
                </button>
              </div>
            </form>
          )}

          {/* Upload tab */}
          {activeTab === 'upload' && (
            <form onSubmit={handleFileSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  Notes Document
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  className="border-2 border-dashed border-slate-700 hover:border-teal-500/50 rounded-lg p-6 text-center transition-colors cursor-pointer focus:outline-none focus:border-teal-500/50"
                  onClick={() => document.getElementById(`notes-file-${meeting.id}`).click()}
                  onKeyDown={(e) => e.key === 'Enter' && document.getElementById(`notes-file-${meeting.id}`).click()}
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="w-4 h-4 text-teal-400 shrink-0" />
                      <span className="text-xs text-slate-200 font-medium truncate max-w-[200px]">
                        {selectedFile.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                        className="text-slate-500 hover:text-slate-300 ml-1 shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-slate-500">Click to select a file</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">PDF, DOCX, or TXT · Max 10 MB</p>
                    </>
                  )}
                  <input
                    id={`notes-file-${meeting.id}`}
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    className="hidden"
                    onChange={(e) => { setSelectedFile(e.target.files?.[0] ?? null); setSubmitError(''); }}
                  />
                </div>
              </div>
              {submitError && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> {submitError}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !selectedFile}
                  className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                >
                  {submitting
                    ? <><RefreshCw className="w-3 h-3 animate-spin" /><span>Uploading…</span></>
                    : <><Upload className="w-3 h-3" /><span>Upload &amp; Analyse</span></>
                  }
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
