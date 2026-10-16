'use strict';
const calendarRepository = require('../repositories/calendar.repository');
const logger             = require('../utils/logger');

const REMINDER_WINDOWS = [
  { key: '7d',  days:  7, label: '7 days before'  },
  { key: '3d',  days:  3, label: '3 days before'  },
  { key: '1d',  days:  1, label: '1 day before'   },
  { key: '1h',  hours: 1, label: '1 hour before'  },
];

const VALID_TYPES = new Set(REMINDER_WINDOWS.map((w) => w.key).concat(['custom']));

const reminderService = {
  REMINDER_WINDOWS,

  triggerForMeeting: async (meetingId, tenantId, { scheduledStart, reminderType }, user) => {
    if (!scheduledStart) {
      throw Object.assign(new Error('scheduledStart is required'), { statusCode: 400 });
    }
    const type = reminderType || 'custom';
    if (!VALID_TYPES.has(type)) {
      throw Object.assign(
        new Error(`Invalid reminderType. Allowed: ${[...VALID_TYPES].join(', ')}`),
        { statusCode: 400 }
      );
    }

    // Background job — no userId available. findConnectionForTenant resolves
    // the tenant's primary AM connection without requiring a user context.
    const activeConn = await calendarRepository.findConnectionForTenant(tenantId, 'microsoft').catch(() => null);

    const syncLog = await calendarRepository.createSyncLog({
      tenantId,
      meetingId,
      connectionId: activeConn?.id       || null,
      provider:     activeConn?.provider || 'manual',
      syncType:     'reminder',
      payload:      { reminderType: type, scheduledStart, actor: user?.email },
    });

    // Extension point — Phase 2: email / push / calendar delivery
    setImmediate(async () => {
      try {
        logger.info('[ReminderService] Delivery extension point fired', {
          meetingId, reminderType: type,
        });
        await calendarRepository.updateSyncLogStatus(syncLog.id, 'completed');
      } catch (err) {
        await calendarRepository.updateSyncLogStatus(syncLog.id, 'failed', err.message);
        logger.error('[ReminderService] Delivery failed', { error: err.message });
      }
    });

    logger.info('Reminder triggered', { meetingId, reminderType: type, actor: user?.email });
    return { syncLogId: syncLog.id, reminderType: type, status: 'queued' };
  },

  // Returns which reminder windows are currently active for a given meeting
  getActiveWindows: (scheduledStart, schedule = [7, 3, 1]) => {
    const now       = Date.now();
    const meetingMs = new Date(scheduledStart).getTime();
    if (meetingMs <= now) return [];

    const diffDays  = (meetingMs - now) / (1000 * 60 * 60 * 24);
    const diffHours = (meetingMs - now) / (1000 * 60 * 60);

    return REMINDER_WINDOWS.filter((w) => {
      if (w.hours) return diffHours <= w.hours;
      return schedule.includes(w.days) && diffDays <= w.days;
    }).map((w) => w.label);
  },
};

module.exports = reminderService;
