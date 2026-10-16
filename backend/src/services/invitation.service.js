'use strict';
const invitationRepository = require('../repositories/invitation.repository');
const calendarRepository   = require('../repositories/calendar.repository');
const logger               = require('../utils/logger');

const invitationService = {

  getForMeeting: async (meetingId, tenantId) => {
    const invitations = await invitationRepository.findByMeeting(meetingId, tenantId);
    const counts      = await invitationRepository.countByMeeting(meetingId);
    return { invitations, counts };
  },

  send: async (meetingId, tenantId, recipients, user) => {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw Object.assign(new Error('recipients must be a non-empty array'), { statusCode: 400 });
    }
    for (const r of recipients) {
      if (!r.recipientEmail) {
        throw Object.assign(new Error('Each recipient must include recipientEmail'), { statusCode: 400 });
      }
    }

    const records = recipients.map((r) => ({
      meetingId,
      tenantId,
      recipientEmail: r.recipientEmail,
      recipientName:  r.recipientName  || null,
      recipientType:  r.recipientType  || 'attendee',
    }));

    const created = await invitationRepository.bulkCreate(records);

    // Use findConnectionForTenant — background context, no per-user isolation needed.
    // activeConn is metadata only; actual emails are queued without this connection.
    const activeConn = await calendarRepository.findConnectionForTenant(tenantId, 'microsoft').catch(() => null);

    const syncLog = await calendarRepository.createSyncLog({
      tenantId,
      meetingId,
      connectionId: activeConn?.id   || null,
      provider:     activeConn?.provider || 'manual',
      syncType:     'invitation',
      payload:      { recipientCount: created.length, actor: user?.email },
    });

    // Queue one email job per recipient — worker handles send + status update.
    // jobId is idempotent so a duplicate call (e.g. retry) never double-sends.
    setImmediate(async () => {
      try {
        const emailQueue = require('../queues/email.queue');
        for (const inv of created) {
          await emailQueue.add(
            'invitation-email',
            { jobType: 'invitation', invitationId: inv.id },
            { jobId: `inv-${inv.id}` }
          );
        }
        await calendarRepository.updateSyncLogStatus(syncLog.id, 'completed');
        logger.info('[InvitationService] Invitation email jobs queued', {
          meetingId, count: created.length,
        });
      } catch (err) {
        await calendarRepository.updateSyncLogStatus(syncLog.id, 'failed', err.message);
        logger.error('[InvitationService] Failed to queue invitation emails', { error: err.message });
      }
    });

    logger.info('Invitations queued', { meetingId, count: created.length, actor: user?.email });
    return { invitations: created, syncLogId: syncLog.id };
  },

  regenerateAfterReschedule: async (meetingId, tenantId, user) => {
    const existing = await invitationRepository.findByMeeting(meetingId, tenantId);
    const sent     = existing.filter((inv) => inv.status === 'sent');

    await invitationRepository.cancelByMeeting(meetingId);

    if (sent.length === 0) {
      logger.info('No sent invitations to regenerate', { meetingId });
      return { regenerated: 0 };
    }

    const recipients = sent.map((inv) => ({
      recipientEmail: inv.recipientEmail,
      recipientName:  inv.recipientName,
      recipientType:  inv.recipientType,
    }));

    const result = await invitationService.send(meetingId, tenantId, recipients, user);
    logger.info('Invitations regenerated after reschedule', {
      meetingId, count: result.invitations.length,
    });
    return { regenerated: result.invitations.length, invitations: result.invitations };
  },
};

module.exports = invitationService;
