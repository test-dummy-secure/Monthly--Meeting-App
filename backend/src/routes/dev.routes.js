'use strict';

// Developer-only routes — mounted only when NODE_ENV=development.
// Provides test endpoints so you can exercise full pipelines without live integrations.

const express             = require('express');
const router              = express.Router();
const auth                = require('../middleware/auth.middleware');
const tenantMiddleware    = require('../middleware/tenant.middleware');
const emailService        = require('../services/email.service');
const meetingRepository   = require('../repositories/meeting.repository');
const MeetingNotesService = require('../services/meetingNotes.service');
const logger              = require('../utils/logger');

// POST /api/dev/test-email
// Body: { to: "recipient@example.com" }
// Requires: super_admin JWT (so this is not publicly callable even in dev)
router.post('/test-email', auth, auth.requireRole(['super_admin']), async (req, res, next) => {
  try {
    const { to } = req.body;
    if (!to || !String(to).includes('@')) {
      return res.status(400).json({ error: 'A valid "to" email address is required' });
    }

    const now    = new Date();
    const sample = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 hours from now
    const fmt    = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const tFmt   = { hour: '2-digit', minute: '2-digit' };

    await emailService.send({
      to,
      subject: 'BMMJ Platform — Email Delivery Test',
      templateName: 'meeting-invitation',
      vars: {
        recipientName: 'Test Recipient',
        meetingTitle:  'Q3 Security Review — Test Meeting',
        meetingDate:   sample.toLocaleDateString('en-US', fmt),
        meetingTime:   sample.toLocaleTimeString('en-US', tFmt),
        tenantName:    'Acme Corporation (Test)',
        organizerName: req.user.email,
      },
      rawVars: {
        meetingLinkButton: emailService.buildMeetingLinkButton('https://teams.microsoft.com/meet/test-link-placeholder'),
      },
    });

    logger.info('Dev test email sent', { to, by: req.user.email });
    res.json({ success: true, message: `Test email successfully sent to ${to}` });
  } catch (err) {
    logger.error('Dev test email failed', { error: err.message });
    next(err);
  }
});

// ── POST /api/dev/meetings/:id/inject-transcript ──────────────────────────────
// Simulates the full Teams transcript → AI tasks → AM approval pipeline
// WITHOUT needing a real Teams meeting or Microsoft auth.
//
// Body: { transcriptText: "..." }   (plain text, no VTT required)
// Optional body: { useBuiltIn: true } — uses a realistic built-in security
//   meeting script so you can test with zero setup.
//
// What it does:
//   1. Marks the meeting as 'conducted' if it's still in 'approval_pending'
//   2. Saves the transcript text to meetings.transcript_text
//   3. Triggers the full notes pipeline (preprocess → structure → AI → recs)
//   4. Returns immediately; AI runs in background (~30-60 sec via Ollama)
//
// After calling this, poll GET /api/ai/recommendations?meetingId=<id> every
// few seconds — recommendations will appear as Ollama finishes each task.
router.post(
  '/meetings/:id/inject-transcript',
  auth,
  tenantMiddleware,
  async (req, res, next) => {
    try {
      const meetingId = req.params.id;
      const tenantId  = req.tenantId;

      const BUILT_IN_TRANSCRIPT = `
John (Account Manager):
  Good morning everyone. Let's start the July security review for Acme Corp.
  I've reviewed the NXG360 dashboard and there are a few critical items we need to address.

Sarah (Customer - IT Lead):
  Thanks John. We've been working on the MFA rollout but only about 30 percent of users are enrolled.

John (Account Manager):
  That's progress from last month's 4 percent, but we still need to reach at least 95 percent.
  Sarah, can your team commit to enabling MFA for all remaining users by July 31st?

Sarah (Customer - IT Lead):
  Yes, we can do that. I'll assign it to the IT helpdesk team.

John (Account Manager):
  Great. I'm also seeing 53 unpatched devices on the dashboard. That's a critical risk.
  The patch compliance needs to be resolved within the next two weeks.

Sarah (Customer - IT Lead):
  Understood. We've had delays with the patch management tool but we'll prioritise this.

John (Account Manager):
  The firewall coverage is also very low — only 2 percent of devices have host-based firewall enabled.
  We need to deploy that via MDM across all 63 devices. Can we target completion by end of July?

Sarah (Customer - IT Lead):
  We'll need BMMJ to provide the MDM configuration template. Can your team send that over?

John (Account Manager):
  Yes, I'll have that to you by Friday. We also need to address the 831 open security alerts.
  I'd like your team to review and close at least the high-priority alerts this month.

Sarah (Customer - IT Lead):
  Agreed. We'll triage and resolve the high alerts first.

John (Account Manager):
  One more item — security awareness training is at zero percent coverage.
  We need to get all 484 users enrolled in the training program by end of Q3.

Sarah (Customer - IT Lead):
  We'll kick that off next week.

John (Account Manager):
  Perfect. Let me summarise the action items before we close:
  One: Acme IT to complete MFA rollout for all users by July 31st.
  Two: Acme IT to patch all 53 non-compliant devices within 14 days.
  Three: BMMJ to send MDM firewall configuration template by this Friday.
  Four: Acme IT to deploy host-based firewall on all 63 devices by end of July.
  Five: Acme IT to triage and resolve all high-priority security alerts this month.
  Six: Acme IT to enrol all users in security awareness training by end of Q3.

Sarah (Customer - IT Lead):
  Confirmed, we'll action all of those.

John (Account Manager):
  Thank you Sarah. I'll send the meeting summary and tracking tasks through BMMJ shortly.
`;

      let transcriptText = req.body?.transcriptText;
      if (!transcriptText || req.body?.useBuiltIn) {
        transcriptText = BUILT_IN_TRANSCRIPT.trim();
      }

      if (!transcriptText || transcriptText.trim().length < 20) {
        return res.status(400).json({ error: 'transcriptText is required (min 20 characters)' });
      }

      // Look up meeting — must belong to this tenant
      const meeting = await meetingRepository.findById(meetingId, tenantId);
      if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

      // Auto-advance to conducted if still in approval_pending (dev convenience)
      if (meeting.status === 'approval_pending') {
        await meetingRepository.conductMeeting(meetingId);
        logger.info('dev/inject-transcript: auto-advanced meeting to conducted', { meetingId });
      } else if (!['conducted', 'closed'].includes(meeting.status)) {
        return res.status(409).json({
          error: `Meeting must be in conducted or closed state (current: ${meeting.status}). ` +
                 'Mark the meeting as conducted first, or use a meeting already in that state.',
        });
      }

      // Save transcript (same as transcriptFetch.job does after Graph API download)
      await meetingRepository.saveTranscript(meetingId, tenantId, transcriptText);

      // Trigger the full pipeline fire-and-forget (same as real transcript fetch does)
      setImmediate(async () => {
        try {
          await MeetingNotesService.processNotes('microsoft', meetingId, tenantId, { transcriptText });
          logger.info('dev/inject-transcript: notes pipeline triggered successfully', { meetingId });
        } catch (err) {
          logger.error('dev/inject-transcript: notes pipeline failed', { meetingId, error: err.message });
        }
      });

      logger.info('dev/inject-transcript: transcript injected', {
        meetingId,
        tenantId,
        length: transcriptText.length,
        by: req.user.email,
      });

      res.json({
        ok:      true,
        message: 'Transcript injected. AI is generating task recommendations in the background.',
        hint:    'Poll GET /api/ai/recommendations?meetingId=' + meetingId + ' every 3s to see tasks appear.',
        meetingId,
        transcriptLength: transcriptText.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
