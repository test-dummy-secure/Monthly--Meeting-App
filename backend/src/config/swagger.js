'use strict';

const swaggerJsdoc = require('swagger-jsdoc');

const definition = {
  openapi: '3.0.3',
  info: {
    title:       'NxgSecure Platform API',
    version:     '1.0.0',
    description: 'MSSP Business Meeting Management & Journey Platform — REST API reference.',
    contact:     { name: 'NXG Secure', email: 'support@nxgsecure.com' },
  },
  servers: [
    { url: '/api', description: 'Current server' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type:         'http',
        scheme:       'bearer',
        bearerFormat: 'JWT',
        description:  'Access token from POST /auth/login',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Resource not found' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth',          description: 'Login, token rotation, password reset' },
    { name: 'Customers',     description: 'Tenant/customer management and AM assignment' },
    { name: 'Meetings',      description: 'Meeting lifecycle — create, schedule, conduct, close' },
    { name: 'Action Items',  description: 'Remediation tasks, escalation, carry-forward' },
    { name: 'AI',            description: 'AI recommendation approval workflow' },
    { name: 'NXG360',        description: 'NXG360 MSSP integration — findings and connection management' },
    { name: 'Meeting Logs',  description: 'Post-meeting notes upload and AI analysis' },
    { name: 'Reports',       description: 'Monthly and weekly security reports' },
    { name: 'Notifications', description: 'In-app and email notifications' },
    { name: 'Audit Logs',    description: 'Immutable audit trail (super_admin only)' },
    { name: 'Calendar',      description: 'Calendar provider connections and reminder management' },
    { name: 'Providers',     description: 'Meeting notes provider connections (Zoom, Teams, Meet)' },
  ],
  paths: {
    // ── Auth ────────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Login',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['email','password'],
          properties: { email: { type: 'string' }, password: { type: 'string' } },
        }}}},
        responses: {
          200: { description: 'Access + refresh token pair' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'], summary: 'Rotate refresh token', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['refreshToken'],
          properties: { refreshToken: { type: 'string' } },
        }}}},
        responses: { 200: { description: 'New token pair' }, 401: { description: 'Token invalid or expired' } },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'], summary: 'Revoke refresh token',
        requestBody: { required: false, content: { 'application/json': { schema: {
          type: 'object', properties: { refreshToken: { type: 'string' } },
        }}}},
        responses: { 200: { description: 'Logged out' } },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'], summary: 'Request password reset email', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } },
        }}}},
        responses: { 200: { description: 'Reset link sent (if email is registered)' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'], summary: 'Set new password using reset token', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['token','newPassword'],
          properties: { token: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } },
        }}}},
        responses: { 200: { description: 'Password updated' }, 400: { description: 'Token invalid or expired' } },
      },
    },

    // ── Customers ───────────────────────────────────────────────────────────
    '/customers': {
      get:  { tags: ['Customers'], summary: 'List tenants (role-scoped)', responses: { 200: { description: 'Array of customers' } } },
      post: { tags: ['Customers'], summary: 'Create tenant (super_admin)', responses: { 201: { description: 'Created customer' } } },
    },
    '/customers/{id}': {
      get:    { tags: ['Customers'], summary: 'Get tenant by ID', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Customer' }, 404: { description: 'Not found' } } },
      put:    { tags: ['Customers'], summary: 'Update tenant', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Customers'], summary: 'Delete tenant (super_admin)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'Deleted' } } },
    },

    // ── Meetings ────────────────────────────────────────────────────────────
    '/meetings': {
      get:  { tags: ['Meetings'], summary: 'List meetings for tenant', responses: { 200: { description: 'Array of meetings' } } },
      post: { tags: ['Meetings'], summary: 'Create meeting', responses: { 201: { description: 'Created meeting' } } },
    },
    '/meetings/{id}': {
      get: { tags: ['Meetings'], summary: 'Get meeting', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Meeting' } } },
      put: { tags: ['Meetings'], summary: 'Update meeting fields', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Updated' } } },
    },
    '/meetings/{id}/trigger-workflow': {
      post: { tags: ['Meetings'], summary: 'Transition scheduled → approval_pending', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Updated meeting' }, 409: { description: 'Invalid status transition' } } },
    },
    '/meetings/{id}/conduct': {
      post: { tags: ['Meetings'], summary: 'Mark meeting as conducted', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Updated meeting' } } },
    },
    '/meetings/{id}/close': {
      post: { tags: ['Meetings'], summary: 'Close meeting and carry forward open tasks', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Closed meeting with carry-forward count' } } },
    },
    '/meetings/{id}/refresh-findings': {
      post: { tags: ['Meetings'], summary: 'Force NXG360 sync and regenerate findings (super_admin)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Refreshed findings array' }, 404: { description: 'Meeting not found' } } },
    },
    '/meetings/{id}/trigger-t48': {
      post: { tags: ['Meetings'], summary: 'Manually fire all T-48 background tasks (super_admin, account_manager)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: '{ triggered, status, tasksQueued }' }, 409: { description: 'Invalid meeting status' } } },
    },
    '/meetings/{id}/pre-meeting-brief': {
      get: { tags: ['Meetings'], summary: 'Get NXG360 findings + pending AI recommendations', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Pre-meeting brief' } } },
    },

    // ── Action Items ────────────────────────────────────────────────────────
    '/action-items': {
      get:  { tags: ['Action Items'], summary: 'List tasks with filters', responses: { 200: { description: 'Paginated tasks' } } },
      post: { tags: ['Action Items'], summary: 'Create task', responses: { 201: { description: 'Created task' } } },
    },
    '/action-items/{id}/escalate': {
      post: { tags: ['Action Items'], summary: 'Escalate task with reason', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Escalated task' } } },
    },
    '/action-items/{id}/resolve-escalation': {
      post: { tags: ['Action Items'], summary: 'Resolve escalation and return task to in_progress', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { resolutionNote: { type: 'string' } } } } } }, responses: { 200: { description: 'Resolved escalation' }, 409: { description: 'Task not currently escalated' } } },
    },
    '/action-items/{id}/carry-forward': {
      post: { tags: ['Action Items'], summary: 'Manually carry forward a task', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Updated task' } } },
    },
    '/action-items/stats': {
      get: { tags: ['Action Items'], summary: 'Aggregate counts by status and owner type', responses: { 200: { description: 'Stats object' } } },
    },
    '/action-items/weekly-report': {
      get: { tags: ['Action Items'], summary: 'Generate and persist weekly monitoring snapshot', responses: { 200: { description: 'Weekly report' } } },
    },

    // ── NXG360 ──────────────────────────────────────────────────────────────
    '/nxg360/tenant/{tenantId}/findings': {
      get: { tags: ['NXG360'], summary: 'Get all NXG360 findings for tenant', parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Findings array' } } },
    },
    '/nxg360/connections/{tenantId}': {
      get:    { tags: ['NXG360'], summary: 'Get connection status', parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Connection status' } } },
      post:   { tags: ['NXG360'], summary: 'Save NXG360 API key (super_admin)', parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Connected' }, 422: { description: 'Validation failed' } } },
      delete: { tags: ['NXG360'], summary: 'Remove NXG360 connection (super_admin)', parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 204: { description: 'Removed' } } },
    },
    '/nxg360/connections/{tenantId}/sync': {
      post: { tags: ['NXG360'], summary: 'Force immediate NXG360 sync (super_admin)', parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: '{ success, syncedAt }' } } },
    },
    '/nxg360/connections/{tenantId}/test': {
      post: { tags: ['NXG360'], summary: 'Test stored connection', parameters: [{ in: 'path', name: 'tenantId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: '{ success, findingCount }' } } },
    },

    // ── Meeting Logs ────────────────────────────────────────────────────────
    '/meeting-logs/{meetingId}/upload': {
      post: { tags: ['Meeting Logs'], summary: 'Upload DOCX / PDF / TXT meeting notes', parameters: [{ in: 'path', name: 'meetingId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 202: { description: 'File accepted, pipeline started' } } },
    },
    '/meeting-logs/{meetingId}/notes': {
      post: { tags: ['Meeting Logs'], summary: 'Submit manual meeting notes', parameters: [{ in: 'path', name: 'meetingId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Notes saved' } } },
    },

    // ── Reports ─────────────────────────────────────────────────────────────
    '/reports': {
      get: { tags: ['Reports'], summary: 'List reports for tenant', responses: { 200: { description: 'Array of reports' } } },
    },
    '/reports/{id}': {
      get: { tags: ['Reports'], summary: 'Get report by ID', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Report' }, 404: { description: 'Not found' } } },
    },

    // ── Notifications ───────────────────────────────────────────────────────
    '/notifications': {
      get: { tags: ['Notifications'], summary: 'List notifications for current user', responses: { 200: { description: 'Notifications array' } } },
    },
    '/notifications/mark-all-read': {
      post: { tags: ['Notifications'], summary: 'Mark all current user notifications as read', responses: { 200: { description: '{ marked: number }' } } },
    },
    '/notifications/{id}/read': {
      patch: { tags: ['Notifications'], summary: 'Mark a single notification as read', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: '{ id, readAt }' }, 404: { description: 'Not found or already read' } } },
    },
    '/notifications/{id}/retry': {
      post: { tags: ['Notifications'], summary: 'Re-send a failed notification email', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: '{ retried, deliveredAt }' }, 409: { description: 'Not in failed state' } } },
    },

    // ── Audit Logs ──────────────────────────────────────────────────────────
    '/audit-logs': {
      get: { tags: ['Audit Logs'], summary: 'Immutable audit trail (super_admin)', responses: { 200: { description: 'Audit events array' } } },
    },
  },
};

const swaggerSpec = swaggerJsdoc({ definition, apis: [] });

module.exports = swaggerSpec;
