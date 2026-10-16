import axios from 'axios';
import { mockService, ACCOUNT_MANAGERS } from './mockData';
import { trackerService } from './trackerMockData';
import { reportsService } from './reportsMockData';
import nxg360Service from './nxg360Service';

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === 'true';

const backendClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
});

const getSelectedTenantId = () => localStorage.getItem('nxg_selected_tenant');
const buildTenantHeaders = () => {
  const tenantId = getSelectedTenantId();
  return tenantId ? { 'x-tenant-id': tenantId } : {};
};

// Attach JWT + tenant headers to every backend request
backendClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('nxg_token');
  const tenantHeaders = buildTenantHeaders();
  if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
  if (config.headers) Object.assign(config.headers, tenantHeaders);
  return config;
}, (error) => Promise.reject(error));

let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);
const onRefreshed = (token) => { refreshSubscribers.forEach((cb) => cb(token)); refreshSubscribers = []; };
const processQueue = (error, token = null) => { refreshSubscribers.forEach((cb) => cb(token, error)); refreshSubscribers = []; };

// Auto-refresh JWT on 401
backendClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl = originalRequest?.url || '';
    if (!originalRequest || originalRequest._retry || !error.response || error.response.status !== 401) {
      return Promise.reject(error);
    }
    if (requestUrl.includes('/auth/refresh') || requestUrl.includes('/auth/login')) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;
    const refreshToken = localStorage.getItem('nxg_refresh_token');
    if (!refreshToken) return Promise.reject(error);

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeTokenRefresh((token, err) => {
          if (err) { reject(err); } else {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(backendClient(originalRequest));
          }
        });
      });
    }

    isRefreshing = true;
    try {
      const response = await backendClient.post('/auth/refresh', { refreshToken });
      const { accessToken, refreshToken: newRefreshToken, user } = response.data;
      localStorage.setItem('nxg_token', accessToken);
      localStorage.setItem('nxg_refresh_token', newRefreshToken);
      if (user) localStorage.setItem('nxg_user', JSON.stringify(user));
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      onRefreshed(accessToken);
      return backendClient(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      localStorage.removeItem('nxg_token');
      localStorage.removeItem('nxg_refresh_token');
      localStorage.removeItem('nxg_user');
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export const api = {
  // Tenants (role-scoped CRUD + NXG360 integration)
  tenants: {
    list: async () => {
      if (USE_BACKEND) {
        const res = await backendClient.get('/tenants');
        return res.data;
      }
      return mockService.getCustomers();
    },
    create: async (data) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/tenants', data);
        return res.data;
      }
      return mockService.createCustomer(data);
    },
    update: async (id, data) => {
      if (USE_BACKEND) {
        const res = await backendClient.put(`/tenants/${id}`, data);
        return res.data;
      }
      return mockService.updateCustomer(id, data);
    },
    // Validate NXG360 credentials before creating a tenant.
    // Returns { valid: true, tenantId, status } or { valid: false, message }.
    validate: async (nxg360TenantId, apiKey) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/tenants/validate', { nxg360TenantId, apiKey });
        return res.data;
      }
      return { valid: false, message: 'NXG360 validation requires backend connection' };
    },
    // Retrieve live NXG360 findings for a tenant.
    getFindings: async (tenantId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/tenants/${tenantId}/findings`);
        return res.data;
      }
      return nxg360Service.getFindingsByTenant(tenantId);
    },
  },

  auth: {
    login: async (email, password) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/auth/login', { email, password });
        return res.data;
      }
      return mockService.login(email, password);
    },
    refresh: async (refreshToken) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/auth/refresh', { refreshToken });
        return res.data;
      }
      return { accessToken: refreshToken, refreshToken, user: null };
    },
    logout: async () => {
      if (USE_BACKEND) {
        const refreshToken = localStorage.getItem('nxg_refresh_token');
        await backendClient.post('/auth/logout', { refreshToken });
      }
    },
    forgotPassword: async (email) => {
      const res = await backendClient.post('/auth/forgot-password', { email });
      return res.data;
    },
    resetPassword: async (token, newPassword) => {
      const res = await backendClient.post('/auth/reset-password', { token, newPassword });
      return res.data;
    },
    changePassword: async (currentPassword, newPassword) => {
      const res = await backendClient.post('/auth/change-password', { currentPassword, newPassword });
      return res.data;
    },
  },

  customers: {
    list: async () => {
      if (USE_BACKEND) {
        const res = await backendClient.get('/customers');
        return res.data;
      }
      return mockService.getCustomers();
    },
    create: async (customerData) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/customers', customerData);
        return res.data;
      }
      return mockService.createCustomer(customerData);
    },
    update: async (id, updates) => {
      if (USE_BACKEND) {
        const res = await backendClient.put(`/customers/${id}`, updates);
        return res.data;
      }
      return mockService.updateCustomer(id, updates);
    },
    reassignAM: async (tenantId, accountManagerId) => {
      if (USE_BACKEND) {
        const res = await backendClient.patch(`/customers/${tenantId}/account-manager`, { accountManagerId });
        return res.data;
      }
      return mockService.reassignAccountManager(tenantId, accountManagerId);
    },
    delete: async (id) => {
      if (USE_BACKEND) {
        await backendClient.delete(`/customers/${id}`);
        return;
      }
      return mockService.deleteCustomer(id);
    },
    getAccountManagers: async () => {
      if (USE_BACKEND) {
        const res = await backendClient.get('/customers/account-managers');
        return res.data;
      }
      return ACCOUNT_MANAGERS.map((am) => ({ ...am, isActive: true }));
    },
    createAccountManager: async ({ firstName, lastName, email, password }) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/customers/account-managers', { firstName, lastName, email, password });
        return res.data;
      }
      const newAM = { id: `am-${Date.now()}`, name: `${firstName} ${lastName}`, email, isActive: true };
      ACCOUNT_MANAGERS.push(newAM);
      return newAM;
    },
    setAccountManagerStatus: async (id, isActive) => {
      if (USE_BACKEND) {
        const res = await backendClient.patch(`/customers/account-managers/${id}/status`, { isActive });
        return res.data;
      }
      const am = ACCOUNT_MANAGERS.find((a) => a.id === id);
      if (am) am.isActive = isActive;
      return am;
    },
    resetAMPassword: async (id) => {
      const res = await backendClient.post(`/customers/account-managers/${id}/reset-password`);
      return res.data;
    },

    // Multi-AM assignment management
    getAssignments: async (tenantId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/customers/${tenantId}/assignments`);
        return res.data;
      }
      return [];
    },
    addAssignment: async (tenantId, userId, setPrimary = false) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/customers/${tenantId}/assignments`, { userId, setPrimary });
        return res.data;
      }
      return [];
    },
    removeAssignment: async (tenantId, userId) => {
      if (USE_BACKEND) {
        await backendClient.delete(`/customers/${tenantId}/assignments/${userId}`);
      }
    },
    setPrimaryAssignment: async (tenantId, userId) => {
      if (USE_BACKEND) {
        const res = await backendClient.patch(`/customers/${tenantId}/assignments/${userId}/primary`);
        return res.data;
      }
      return [];
    },
  },

  meetings: {
    list: async () => {
      if (USE_BACKEND) {
        const res = await backendClient.get('/meetings');
        return res.data;
      }
      return mockService.getMeetings();
    },
    getById: async (id) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/meetings/${id}`);
        return res.data;
      }
      return mockService.getMeetingById(id);
    },
    create: async (data) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/meetings', data);
        return res.data;
      }
      return null;
    },
    update: async (id, data) => {
      if (USE_BACKEND) {
        const res = await backendClient.put(`/meetings/${id}`, data);
        return res.data;
      }
      return null;
    },
    history: async (id) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/meetings/${id}/history`);
        return res.data;
      }
      return null;
    },
    saveConfig: async (configData) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/meetings/configs', configData);
        return res.data;
      }
      return mockService.saveConfig(configData);
    },
    triggerWorkflow: async (id) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meetings/${id}/trigger-workflow`);
        return res.data;
      }
      return mockService.triggerWorkflowNow(id);
    },
    requestReschedule: async (id, requestedDate, requestedTime, reason) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meetings/${id}/request-reschedule`, { requestedDate, requestedTime, reason });
        return res.data;
      }
      return mockService.requestReschedule(id, requestedDate, requestedTime, reason);
    },
    reviewReschedule: async (id, approved, notes) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meetings/${id}/review-reschedule`, { approved, notes });
        return res.data;
      }
      return mockService.reviewReschedule(id, approved, notes);
    },
    conductMeeting: async (id) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meetings/${id}/conduct`);
        return res.data;
      }
      return mockService.conductMeeting(id);
    },
    closeMeeting: async (id) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meetings/${id}/close`);
        return res.data;
      }
      return mockService.closeMeeting(id);
    },
    retryTranscript: async (id) => {
      const res = await backendClient.post(`/meetings/${id}/retry-transcript`);
      return res.data;
    },
    addBot: async (id) => {
      const res = await backendClient.post(`/meetings/${id}/add-bot`);
      return res.data;
    },
    getInvitations: async (meetingId) => {
      const res = await backendClient.get(`/meetings/${meetingId}/invitations`);
      return res.data;
    },
    sendInvitations: async (meetingId, recipients) => {
      const res = await backendClient.post(`/meetings/${meetingId}/invitations`, { recipients });
      return res.data;
    },
    regenerateInvitations: async (meetingId) => {
      const res = await backendClient.post(`/meetings/${meetingId}/invitations/regenerate`);
      return res.data;
    },
    preMeetingBrief: async (meetingId) => {
      const res = await backendClient.get(`/meetings/${meetingId}/pre-meeting-brief`);
      return res.data;
    },
    exportBrief: async (meetingId) => {
      const res = await backendClient.get(`/meetings/${meetingId}/brief/export`, {
        responseType: 'blob',
      });
      const url  = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `brief-${meetingId.slice(0, 8)}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
    sendBookingLink: async (meetingId, { customerContactEmail, customerContactName, additionalParticipants }) => {
      const res = await backendClient.post(`/meetings/${meetingId}/send-booking-link`, {
        customerContactEmail,
        customerContactName,
        additionalParticipants,
      });
      return res.data;
    },
    updateAttendees: async (meetingId, attendees) => {
      const res = await backendClient.put(`/meetings/${meetingId}/attendees`, { attendees });
      return res.data;
    },
    uploadTestFindings: async (meetingId, file) => {
      const form = new FormData();
      form.append('file', file);
      const res = await backendClient.post(
        `/meetings/${meetingId}/upload-test-findings`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data;
    },
    triggerT24: async (meetingId) => {
      const res = await backendClient.post(`/meetings/${meetingId}/trigger-t24`);
      return res.data;
    },
    reAnalyze: async (meetingId, model) => {
      const res = await backendClient.post(`/meetings/${meetingId}/re-analyze`, model ? { model } : {});
      return res.data;
    },
  },

  tracker: {
    summary: async (params = {}) => {
      if (USE_BACKEND) {
        const query = new URLSearchParams();
        if (params.tenantId) query.append('tenantId', params.tenantId);
        if (params.status)   query.append('status',   params.status);
        if (params.severity) query.append('severity', params.severity);
        if (params.search)   query.append('search',   params.search);
        if (params.page)     query.append('page',     params.page);
        if (params.pageSize) query.append('pageSize', params.pageSize);
        const res = await backendClient.get(`/tracker/summary?${query}`);
        return res.data;
      }
      return mockService.getTrackerList(params);
    },
    list: async (params = {}) => {
      if (USE_BACKEND) {
        const query = new URLSearchParams();
        if (params.tenantId) query.append('tenantId', params.tenantId);
        if (params.status)   query.append('status',   params.status);
        if (params.severity) query.append('severity', params.severity);
        if (params.search)   query.append('search',   params.search);
        if (params.page)     query.append('page',     params.page);
        if (params.pageSize) query.append('pageSize', params.pageSize);
        const res = await backendClient.get(`/tracker/tasks?${query}`);
        return res.data;
      }
      return mockService.getTrackerList(params);
    },
    taskById: async (taskId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/tracker/tasks/${taskId}`);
        return res.data;
      }
      const result = mockService.getTrackerList({ page: 1, pageSize: 1000 });
      return result.items.find((t) => String(t.id) === String(taskId)) || null;
    },
    customerSummary: async (tenantId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/tracker/customers/${tenantId}/summary`);
        return res.data;
      }
      return mockService.getCustomerSummary(tenantId);
    },
    updateTask: async (taskId, { progressPercentage, status, notes } = {}) => {
      const res = await backendClient.patch(`/tracker/tasks/${taskId}`, { progressPercentage, status, notes });
      return res.data;
    },
    setReviewOutcome: async (taskId, outcome, actorName) => {
      const res = await backendClient.post(`/tracker/tasks/${taskId}/review`, { outcome, actorName });
      return res.data;
    },
    triggerEscalation: async (taskId, data) => {
      const res = await backendClient.post(`/tracker/tasks/${taskId}/escalate`, {
        blockerType: data.blockerType,
        reason: data.escalationReason,
        notifyContact: data.notifyContact,
      });
      return res.data;
    },
  },

  reports: {
    list: async ({ page = 1, pageSize = 100 } = {}) => {
      const res = await backendClient.get('/reports', { params: { page, pageSize } });
      return res.data;
    },
    generate: async ({ tenantId, meetingId, reportType = 'weekly_progress', generatedBy = 'Account Manager', weekNumber = null, weekStart = null, weekEnd = null } = {}) => {
      const res = await backendClient.post('/reports/generate', { tenantId, meetingId, reportType, generatedBy, weekNumber, weekStart, weekEnd });
      return res.data;
    },
    getById: async (reportId) => {
      const res = await backendClient.get(`/reports/${reportId}`);
      return res.data;
    },
  },

  meetingLogs: {
    list: async (params = {}) => {
      if (USE_BACKEND) {
        const query = new URLSearchParams();
        if (params.page)     query.append('page',     params.page);
        if (params.pageSize) query.append('pageSize', params.pageSize);
        const res = await backendClient.get(`/meeting-logs?${query}`);
        return res.data;
      }
      return mockService.getMeetingLogs(params);
    },
    getById: async (meetingId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/meeting-logs/${meetingId}`);
        return res.data;
      }
      return mockService.getMeetingLogById(meetingId);
    },
    // Save / upsert meeting notes (manual entry)
    save: async (meetingId, payload) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meeting-logs/${meetingId}`, payload);
        return res.data;
      }
      return null;
    },
    // Re-run post-meeting AI analysis using already-structured notes
    reanalyze: async (meetingId, model) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meeting-logs/${meetingId}/reanalyze`, model ? { model } : {});
        return res.data;
      }
      return null;
    },
    // Upload MOM file (PDF / DOCX / TXT)
    upload: async (meetingId, formData) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/meeting-logs/${meetingId}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return res.data;
      }
      return null;
    },
    // List uploaded files for a meeting
    files: async (meetingId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/meeting-logs/${meetingId}/files`);
        return res.data;
      }
      return { files: [] };
    },
    // Directly update MoM fields (summary, actionItems, etc.) without triggering AI re-analysis
    patchNotes: async (meetingId, payload) => {
      if (USE_BACKEND) {
        const res = await backendClient.patch(`/meeting-logs/${meetingId}/notes`, payload);
        return res.data;
      }
      return null;
    },
    // Download a file — returns a Blob (caller creates object URL)
    downloadFile: async (meetingId, fileId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/meeting-logs/${meetingId}/files/${fileId}`, {
          responseType: 'blob',
        });
        return res.data;
      }
      return null;
    },
  },

  integrations: {
    connect: async (tenantId, provider, email) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/integrations/connect', { tenantId, provider, email });
        return res.data;
      }
      return mockService.connectCalendar(tenantId, provider, email);
    },
    disconnect: async (tenantId, provider) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/integrations/disconnect', { tenantId, provider });
        return res.data;
      }
      return mockService.disconnectCalendar(tenantId, provider);
    },
  },

  // ── Microsoft 365 OAuth + Calendly integration (Phase 11) ─────────────────
  microsoft: {
    getStatus: async () => {
      const res = await backendClient.get('/integrations/microsoft/status');
      return res.data;
    },
    getAuthUrl: async () => {
      const res = await backendClient.post('/integrations/microsoft/authorize');
      return res.data;
    },
    verify: async () => {
      const res = await backendClient.post('/integrations/microsoft/verify');
      return res.data;
    },
    saveCalendlyUrl: async (calendlyUrl) => {
      const res = await backendClient.post('/integrations/microsoft/save-calendly-url', { calendlyUrl });
      return res.data;
    },
    saveCalendlyToken: async (calendlyToken) => {
      const res = await backendClient.post('/integrations/microsoft/save-calendly-token', { calendlyToken });
      return res.data;
    },
    clearCalendlyToken: async () => {
      const res = await backendClient.delete('/integrations/microsoft/calendly-token');
      return res.data;
    },
    disconnect: async () => {
      const res = await backendClient.post('/integrations/microsoft/disconnect');
      return res.data;
    },
    // POST /api/integrations/microsoft/booking-link/send
    sendBookingLink: async ({ recipientEmail, recipientName, participants, meetingTitle, durationMinutes, calendlyUrl, calendlyToken }) => {
      const res = await backendClient.post('/integrations/microsoft/booking-link/send', {
        recipientEmail, recipientName, participants, meetingTitle, durationMinutes, calendlyUrl, calendlyToken,
      });
      return res.data;
    },
  },

  findings: {
    listForMeeting: async (meetingId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/meetings/${meetingId}/findings`);
        return res.data;
      }
      return mockService.getFindingsForMeeting(meetingId);
    },
  },

  tasks: {
    listForMeeting: async (meetingId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/meetings/${meetingId}/tasks`);
        return res.data;
      }
      return mockService.getTasksForMeeting(meetingId);
    },
    listOpenForTenant: async () => {
      if (USE_BACKEND) {
        const res = await backendClient.get('/tasks/open');
        return res.data;
      }
      return [];
    },
    updateStatus: async (taskId, approvalStatus, notes = '') => {
      if (USE_BACKEND) {
        const res = await backendClient.put(`/tasks/${taskId}/status`, { approvalStatus, notes });
        return res.data;
      }
      return mockService.updateTaskStatus(taskId, approvalStatus, notes);
    },
  },

  auditLogs: {
    list: async () => {
      const response = await api.meetingLogs.list();
      return response.items || [];
    },
  },

  analytics: {
    get: async (_tenantId) => {
      const res = await backendClient.get('/analytics');
      return res.data;
    },
  },

  monitoring: {
    getDashboard: async (tenantId) => {
      const params = tenantId ? `?tenantId=${tenantId}` : '';
      const res = await backendClient.get(`/monitoring/dashboard${params}`);
      return res.data;
    },
  },

  ai: {
    // GET /api/ai/providers — Ollama status + installed model list
    getProviders: async () => {
      if (USE_BACKEND) {
        const res = await backendClient.get('/ai/providers');
        return res.data;
      }
      return { provider: 'ollama', configured: false, online: false, availableModels: [], primaryModel: 'llama3.2', fallbackModel: null };
    },
    // POST /api/ai/analyze — triggers Ollama analysis, returns pending recommendations
    analyze: async ({ tenantId, meetingId, model }) => {
      if (USE_BACKEND) {
        const res = await backendClient.post('/ai/analyze', { tenantId, meetingId, model: model || undefined });
        return res.data;
      }
      return { recommendations: [], count: 0, message: 'AI analysis requires backend connection' };
    },
    // GET /api/ai/recommendations?tenantId=&meetingId=&status=&analysisType=
    listRecommendations: async ({ tenantId, meetingId, status, analysisType } = {}) => {
      if (USE_BACKEND) {
        const params = new URLSearchParams();
        if (tenantId)     params.append('tenantId',     tenantId);
        if (meetingId)    params.append('meetingId',    meetingId);
        if (status)       params.append('status',       status);
        if (analysisType) params.append('analysisType', analysisType);
        const res = await backendClient.get(`/ai/recommendations?${params}`);
        return res.data;
      }
      return { recommendations: [], count: 0 };
    },
    // GET /api/ai/recommendations/:id
    getRecommendation: async (id) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/ai/recommendations/${id}`);
        return res.data;
      }
      return null;
    },
    // PATCH /api/ai/recommendations/:id — edit a pending recommendation
    update: async (id, { tenantId, ...fields }) => {
      if (USE_BACKEND) {
        const res = await backendClient.patch(`/ai/recommendations/${id}`, { tenantId, ...fields });
        return res.data;
      }
      return null;
    },
    // POST /api/ai/recommendations/:id/approve — creates a tracker task
    approve: async (id, { tenantId }) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/ai/recommendations/${id}/approve`, { tenantId });
        return res.data;
      }
      return null;
    },
    // POST /api/ai/recommendations/:id/reject — stores rejection with reason
    reject: async (id, { tenantId, reason }) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/ai/recommendations/${id}/reject`, { tenantId, reason });
        return res.data;
      }
      return null;
    },
    // POST /api/tasks/:taskId/push-clickup — re-enqueue ClickUp push for an approved task
    pushClickUp: async (taskId) => {
      const res = await backendClient.post(`/tasks/${taskId}/push-clickup`);
      return res.data;
    },
    // POST /api/tasks/:taskId/sync-clickup — pull this one task's live status
    // from ClickUp right now, instead of waiting for the scheduled sweep.
    syncClickUp: async (taskId) => {
      const res = await backendClient.post(`/tasks/${taskId}/sync-clickup`);
      return res.data;
    },
    // POST /api/tasks/sync-clickup — pull live status for every task in the
    // current tenant, on demand.
    syncClickUpAll: async () => {
      const res = await backendClient.post(`/tasks/sync-clickup`);
      return res.data;
    },
  },

  actionItems: {
    list: async (filters = {}) => {
      const params = new URLSearchParams();
      if (filters.status)    params.append('status',    filters.status);
      if (filters.ownerType) params.append('ownerType', filters.ownerType);
      if (filters.meetingId) params.append('meetingId', filters.meetingId);
      if (filters.search)    params.append('search',    filters.search);
      if (filters.page)      params.append('page',      filters.page);
      if (filters.pageSize)  params.append('pageSize',  filters.pageSize);
      const res = await backendClient.get(`/action-items?${params}`);
      return res.data;
    },
    create: async (data) => {
      const res = await backendClient.post('/action-items', data);
      return res.data;
    },
    update: async (id, updates) => {
      const res = await backendClient.put(`/action-items/${id}`, updates);
      return res.data;
    },
    getById: async (id) => {
      const res = await backendClient.get(`/action-items/${id}`);
      return res.data;
    },
    escalate: async (id, { reason, blockerType, escalatedTo }) => {
      const res = await backendClient.post(`/action-items/${id}/escalate`, { reason, blockerType, escalatedTo });
      return res.data;
    },
    carryForward: async (id) => {
      const res = await backendClient.post(`/action-items/${id}/carry-forward`);
      return res.data;
    },
    stats: async () => {
      const res = await backendClient.get('/action-items/stats');
      return res.data;
    },
    weeklyReport: async (meetingId) => {
      const params = meetingId ? `?meetingId=${meetingId}` : '';
      const res = await backendClient.get(`/action-items/weekly-report${params}`);
      return res.data;
    },
    sendEmail: async (meetingId, emails) => {
      const res = await backendClient.post('/action-items/send-email', { meetingId, emails });
      return res.data;
    },
  },

  providers: {
    // GET /api/providers/status — full grid of all provider types with connection info
    getStatus: async () => {
      const res = await backendClient.get('/providers/status');
      return res.data;
    },
    // GET /api/providers — list configured connections for selected tenant
    list: async () => {
      const res = await backendClient.get('/providers');
      return res.data.providers || [];
    },
    // POST /api/providers — connect / configure a provider
    connect: async ({ providerType, oauthAccountEmail, providerWorkspaceId }) => {
      const res = await backendClient.post('/providers', { providerType, oauthAccountEmail, providerWorkspaceId });
      return res.data;
    },
    // PUT /api/providers/:id — update connection metadata
    update: async (id, updates) => {
      const res = await backendClient.put(`/providers/${id}`, updates);
      return res.data;
    },
    // POST /api/providers/:id/disable — soft-disconnect a provider
    disable: async (id) => {
      const res = await backendClient.post(`/providers/${id}/disable`);
      return res.data;
    },
    // DELETE /api/providers/:id — remove a provider connection
    remove: async (id) => {
      await backendClient.delete(`/providers/${id}`);
    },
    // POST /api/providers/:id/sync — trigger a sync for a meeting
    sync: async (id, meetingId) => {
      const res = await backendClient.post(`/providers/${id}/sync`, { meetingId: meetingId || null });
      return res.data;
    },
    // GET /api/providers/sync-logs — tenant sync log history
    syncLogs: async (limit = 50) => {
      const res = await backendClient.get(`/providers/sync-logs?limit=${limit}`);
      return res.data.logs || [];
    },
    // GET /api/providers/mapping/:meetingId — provider selected for a meeting
    getMeetingMapping: async (meetingId) => {
      const res = await backendClient.get(`/providers/mapping/${meetingId}`);
      return res.data;
    },
    // POST /api/providers/mapping/:meetingId — set provider source for a meeting
    setMeetingMapping: async (meetingId, { providerType, sourceType }) => {
      const res = await backendClient.post(`/providers/mapping/${meetingId}`, { providerType, sourceType });
      return res.data;
    },
  },

  notifications: {
    // GET /api/notifications/me — last 20 notifications for the current user
    getMyNotifications: async () => {
      const res = await backendClient.get('/notifications/me');
      return res.data;
    },
  },

  nxg360: {
    // GET /api/nxg360/tenant/:tenantId/findings
    getFindingsByTenant: async (tenantId) => {
      if (USE_BACKEND) {
        const res = await backendClient.get(`/nxg360/tenant/${tenantId}/findings`);
        return res.data;
      }
      return nxg360Service.getFindingsByTenant(tenantId);
    },
    // Generate AI task recommendations from findings (requires AM approval before publish)
    generateAITasks: async (tenantId, meetingId, findings) => {
      if (USE_BACKEND) {
        const res = await backendClient.post(`/nxg360/tenant/${tenantId}/generate-tasks`, { meetingId, findingIds: findings.map((f) => f.id) });
        return res.data;
      }
      return nxg360Service.generateAITasks(tenantId, meetingId, findings);
    },
    // GET /api/nxg360/connections/:tenantId — connection status (no API key returned)
    getConnection: async (tenantId) => {
      const res = await backendClient.get(`/nxg360/connections/${tenantId}`);
      return res.data;
    },
    // POST /api/nxg360/connections/:tenantId — validate + save connection
    saveConnection: async (tenantId, { workspaceId, apiKey, apiEndpoint }) => {
      const res = await backendClient.post(`/nxg360/connections/${tenantId}`, { workspaceId, apiKey, apiEndpoint });
      return res.data;
    },
    // POST /api/nxg360/connections/:tenantId/test — test existing stored connection
    testConnection: async (tenantId) => {
      const res = await backendClient.post(`/nxg360/connections/${tenantId}/test`);
      return res.data;
    },
    // DELETE /api/nxg360/connections/:tenantId — remove connection
    disconnect: async (tenantId) => {
      await backendClient.delete(`/nxg360/connections/${tenantId}`);
    },
  },

  // ── ClickUp — global workspace connection (Super Admin only) ────────────────
  clickup: {
    getConnection: async () => {
      const res = await backendClient.get('/clickup/connection');
      return res.data;
    },
    validate: async (apiKey) => {
      const res = await backendClient.post('/clickup/validate', { apiKey });
      return res.data;
    },
    // wizard: pass apiKey in body before the connection is saved
    getSpaces: async (workspaceId, apiKey) => {
      const res = await backendClient.post(`/clickup/workspaces/${workspaceId}/spaces`, { apiKey });
      return res.data;
    },
    saveConnection: async ({ apiKey, workspaceId, workspaceName, spaceId, spaceName }) => {
      const res = await backendClient.post('/clickup/connection', { apiKey, workspaceId, workspaceName, spaceId, spaceName });
      return res.data;
    },
    disconnect: async () => {
      await backendClient.delete('/clickup/connection');
    },
    getFolderMapping: async (tenantId) => {
      const res = await backendClient.get(`/clickup/folders/${tenantId}`);
      return res.data;
    },
    createFolderForTenant: async (tenantId, tenantName) => {
      const res = await backendClient.post(`/clickup/folders/${tenantId}`, { tenantName });
      return res.data;
    },
    getAllFolderMappings: async () => {
      const res = await backendClient.get('/clickup/folders');
      return res.data;
    },
    // List all folders currently in the connected ClickUp space
    getSpaceFolders: async () => {
      const res = await backendClient.get('/clickup/space/folders');
      return res.data;
    },
    // Link an EXISTING ClickUp folder to a tenant (finds/creates Action Items list)
    linkExistingFolder: async (tenantId, folderId, folderName) => {
      const res = await backendClient.put(`/clickup/folders/${tenantId}`, { folderId, folderName });
      return res.data;
    },
  },

  // ── Fireflies AI — per-tenant API key management ───────────────────────────
  fireflies: {
    // GET /api/fireflies/connections/:tenantId — status + key hint (no raw key)
    getConnection: async (tenantId) => {
      const res = await backendClient.get(`/fireflies/connections/${tenantId}`);
      return res.data;
    },
    // POST /api/fireflies/connections/:tenantId — validate + save API key
    saveConnection: async (tenantId, apiKey) => {
      const res = await backendClient.post(`/fireflies/connections/${tenantId}`, { apiKey });
      return res.data;
    },
    // POST /api/fireflies/connections/:tenantId/test — test stored key
    testConnection: async (tenantId) => {
      const res = await backendClient.post(`/fireflies/connections/${tenantId}/test`);
      return res.data;
    },
    // DELETE /api/fireflies/connections/:tenantId — remove connection
    disconnect: async (tenantId) => {
      await backendClient.delete(`/fireflies/connections/${tenantId}`);
    },
  },
};
