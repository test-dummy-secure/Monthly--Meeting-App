import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, CheckCircle2, XCircle, MessageSquare, Calendar, Clock, AlertTriangle } from 'lucide-react';

export const RescheduleReviewModal = ({ isOpen, meeting, onClose, onReview }) => {
  const [decision, setDecision] = useState('approved');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [needsMsConnect, setNeedsMsConnect] = useState(false);

  useEffect(() => {
    if (!meeting) return;
    setDecision('approved');
    setNotes('');
    setError('');
    setNeedsMsConnect(false);
  }, [meeting]);

  if (!isOpen || !meeting) return null;
  const request = meeting.rescheduleRequest;
  if (!request) return null;

  const requestedStart = new Date(request.requestedStart);
  const currentStart   = new Date(meeting.scheduledStart);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNeedsMsConnect(false);
    try {
      await onReview(meeting.id, decision === 'approved', notes);
      onClose();
    } catch (err) {
      console.error(err);
      if (err.response?.data?.code === 'MS365_NOT_CONNECTED') {
        setNeedsMsConnect(true);
        setError('Microsoft 365 is not connected for your account. Connect it in Integrations before approving a reschedule.');
      } else {
        setError(err.response?.data?.error || err.message || 'Unable to process the request.');
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#1A1814]/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#D8D2C4] bg-[#FDFAF5] shadow-2xl shadow-black/20 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4DFCF] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
              <Calendar className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1A1814]">Review Reschedule Request</h3>
              <p className="text-[10px] text-[#A89E90] mt-0.5 truncate max-w-[260px]">{meeting.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#A89E90] hover:text-[#4A4239] transition-colors p-1 rounded-lg hover:bg-[#EDE8DC]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body — this app's tailwind.config.js remaps `slate` and
            `indigo` to its own light-cream brand scale with no darkMode
            option, so slate-900/slate-100 previously rendered as
            near-invisible light-on-light. Rebuilt on the app's real cream
            tokens; rose/emerald/amber are untouched by the remap and stay. */}
        <form className="overflow-y-auto flex-1 px-5 py-4 space-y-4" onSubmit={handleSubmit}>

          {/* Current vs Requested time */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E4DFCF] bg-[#F5F1E8] p-4 space-y-2.5">
              <p className="text-[10px] font-bold text-[#A89E90] uppercase tracking-wider">Current Time</p>
              <div className="flex items-center gap-2 text-xs text-[#4A4239]">
                <Calendar className="w-3.5 h-3.5 text-[#A89E90] shrink-0" />
                {currentStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="flex items-center gap-2 text-xs text-[#4A4239]">
                <Clock className="w-3.5 h-3.5 text-[#A89E90] shrink-0" />
                {currentStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div className="rounded-xl border border-[#B8872A]/25 bg-[#FAE8B8]/30 p-4 space-y-2.5">
              <p className="text-[10px] font-bold text-[#9E7123] uppercase tracking-wider">Requested Change</p>
              <div className="flex items-center gap-2 text-xs text-[#4A4239]">
                <Calendar className="w-3.5 h-3.5 text-[#9E7123] shrink-0" />
                {requestedStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="flex items-center gap-2 text-xs text-[#4A4239]">
                <Clock className="w-3.5 h-3.5 text-[#9E7123] shrink-0" />
                {requestedStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>

          {/* Reason */}
          {request.requestedReason && (
            <div className="rounded-xl border border-[#E4DFCF] bg-[#F5F1E8] px-4 py-3 space-y-1">
              <p className="text-[10px] font-bold text-[#A89E90] uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" /> Reason from Requester
              </p>
              <p className="text-xs text-[#4A4239] leading-relaxed">{request.requestedReason}</p>
            </div>
          )}

          {/* Decision toggle */}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setDecision('rejected')}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-bold transition-colors ${
                decision === 'rejected'
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-600'
                  : 'bg-[#F5F1E8] border-[#D8D2C4] text-[#6B6358] hover:border-[#C4BEB0] hover:text-[#4A4239]'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" /> Reject
            </button>
            <button
              type="button"
              onClick={() => setDecision('approved')}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-bold transition-colors ${
                decision === 'approved'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600'
                  : 'bg-[#F5F1E8] border-[#D8D2C4] text-[#6B6358] hover:border-[#C4BEB0] hover:text-[#4A4239]'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Approve
            </button>
          </div>

          {/* Reviewer notes */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#6B6358] uppercase tracking-wide">
              Reviewer Notes <span className="text-[#A89E90] normal-case font-normal">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add context for the customer about this decision."
              className="w-full bg-[#F5F1E8] border border-[#D8D2C4] focus:border-[#B8872A] rounded-lg px-3 py-2.5 text-xs text-[#1A1814] outline-none transition-colors resize-none leading-relaxed"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-[11px] text-rose-700 leading-relaxed">
                {error}
                {needsMsConnect && (
                  <>
                    {' '}
                    <Link to="/integrations" onClick={onClose} className="underline hover:text-rose-800">
                      Go to Integrations →
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#E4DFCF] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-[#6B6358] hover:text-[#1A1814] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#EDE8DC] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            onClick={handleSubmit}
            className={`flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold px-4 py-2 rounded-lg transition-colors ${
              decision === 'approved'
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-rose-600 hover:bg-rose-500 text-white'
            }`}
          >
            {decision === 'approved'
              ? <><CheckCircle2 className="w-3.5 h-3.5" />{saving ? 'Approving…' : 'Approve Request'}</>
              : <><XCircle className="w-3.5 h-3.5" />{saving ? 'Rejecting…' : 'Reject Request'}</>
            }
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
