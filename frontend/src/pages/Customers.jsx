import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { INDUSTRIES, TIMEZONES, MEETING_PLATFORMS } from '../services/mockData';
import {
  Building2, Plus, Check, RefreshCw, X, Edit2, UserCheck, Link as LinkIcon,
  Eye, EyeOff, Shield, AlertTriangle, Users, UserPlus, Ban, CheckCircle,
  Wifi, WifiOff, Zap, Unplug, ChevronDown, ChevronUp, KeyRound,
} from 'lucide-react';
import { AMCombobox } from '../components/AMCombobox';
import { Link } from 'react-router-dom';

// ─── Style constants ──────────────────────────────────────────────────────────

const INPUT_CLS = 'w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 outline-none transition-colors';
const SELECT_CLS = `${INPUT_CLS} py-2.5`;
const LABEL_CLS = 'text-[10px] font-bold text-slate-400 uppercase tracking-wider';

const PLATFORM_BADGE = {
  google_meet:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
  microsoft_teams:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const STATUS_BADGE = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  inactive:  'bg-slate-500/10 text-slate-400 border-slate-700',
  suspended: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const initials = (name = '') =>
  name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'AM';

const emptyTenantForm = () => ({
  name: '',
  domain: '',
  industry: 'Financial Services',
  timezone: 'America/New_York',
  meetingPlatform: 'microsoft_teams',
  accountManagerId: '',
  status: 'active',
  nxg360TenantId: '',
  nxg360ApiKey: '',
});

const emptyAmForm = () => ({
  firstName: '',
  lastName: '',
  email: '',
  password: '',
});

const NXG360_IDLE    = { status: 'idle',       message: '' };
const NXG360_VALID   = { status: 'valid',       message: '' };
const nxg360Invalid  = (msg) => ({ status: 'invalid', message: msg });

// ─── Component ────────────────────────────────────────────────────────────────

export const Customers = () => {
  const { isSuperAdmin, user: currentUser } = useAuth();
  const { refreshTenants } = useTenant();

  // ── Tab ─────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('tenants');

  // ── Tenant state ────────────────────────────────────────────────────────────
  const [customers, setCustomers]       = useState([]);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [submitting, setSubmitting]     = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm]     = useState(emptyTenantForm());
  const [nxg360Validation, setNxg360Validation] = useState(NXG360_IDLE);
  const [showApiKey, setShowApiKey]     = useState(false);
  const [editingId, setEditingId]       = useState(null);
  const [editForm, setEditForm]         = useState(emptyTenantForm());
  const [manageAMsId,          setManageAMsId]          = useState(null);
  const [manageAMsAssignments, setManageAMsAssignments] = useState([]);
  const [manageAMsLoading,     setManageAMsLoading]     = useState(false);
  const [addAMUserId,          setAddAMUserId]          = useState('');
  const [addAMSetPrimary,      setAddAMSetPrimary]      = useState(false);
  const [amActionLoading,      setAmActionLoading]      = useState(false);

  // ── Account Manager state ────────────────────────────────────────────────────
  const [accountManagers, setAccountManagers] = useState([]);
  const [amLoading, setAmLoading]       = useState(false);
  const [showAmForm, setShowAmForm]     = useState(false);
  const [amForm, setAmForm]             = useState(emptyAmForm());
  const [showAmPassword, setShowAmPassword] = useState(false);
  const [amSubmitting, setAmSubmitting] = useState(false);
  const [amError, setAmError]           = useState('');
  const [amToggling, setAmToggling]     = useState(null); // id of AM being toggled
  const [amResetting, setAmResetting]   = useState(null); // id of AM whose password is being reset
  const [amResetMsg,  setAmResetMsg]    = useState('');   // inline success message

  // ── NXG360 connection management ────────────────────────────────────────────
  const [connectionMap,    setConnectionMap]    = useState({}); // tenantId → { connected, workspaceId, ... }
  const [nxgManageId,      setNxgManageId]      = useState(null); // expanded row tenantId
  const [nxgForm,          setNxgForm]          = useState({ workspaceId: '', apiKey: '' });
  const [nxgRowValidation, setNxgRowValidation] = useState(NXG360_IDLE);
  const [nxgShowKey,       setNxgShowKey]       = useState(false);
  const [nxgSaving,        setNxgSaving]        = useState(false);
  const [nxgTesting,       setNxgTesting]       = useState(false);
  const [nxgTestResult,    setNxgTestResult]    = useState(null); // { success, findingCount?, error? }
  const [nxgDisconnecting, setNxgDisconnecting] = useState(false);
  const [nxgConfirmId,     setNxgConfirmId]     = useState(null); // tenantId awaiting disconnect confirm

  // ── ClickUp folder mapping state ────────────────────────────────────────────
  const [cuFolderMap,     setCuFolderMap]     = useState({}); // tenantId → { connected, folderName, listName }
  const [cuGlobalConn,    setCuGlobalConn]    = useState(false); // is global ClickUp workspace set up?
  const [cuConnecting,    setCuConnecting]    = useState(null); // tenantId currently being connected
  const [cuError,         setCuError]         = useState('');
  // Folder picker modal state
  const [cuPickerTenant,  setCuPickerTenant]  = useState(null); // { id, name } of tenant whose picker is open
  const [cuSpaceFolders,  setCuSpaceFolders]  = useState([]);   // folders from ClickUp space
  const [cuFoldersLoading,setCuFoldersLoading]= useState(false);
  const [cuPickerError,   setCuPickerError]   = useState('');

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    setTenantLoading(true);
    try {
      const data = await api.customers.list();
      setCustomers(data);
      // Load NXG360 connection status for all tenants in parallel — non-fatal
      if (data.length > 0) {
        const settled = await Promise.allSettled(
          data.map((t) => api.nxg360.getConnection(t.id).then((c) => [t.id, c]))
        );
        const map = {};
        settled.forEach((r) => {
          if (r.status === 'fulfilled') {
            const [id, conn] = r.value;
            map[id] = conn;
          }
        });
        setConnectionMap(map);
      }

      // Load ClickUp global connection + all folder mappings — non-fatal
      try {
        const [cuConn, cuData] = await Promise.all([
          api.clickup.getConnection(),
          api.clickup.getAllFolderMappings(),
        ]);
        setCuGlobalConn(cuConn?.connected === true);
        const cuMap = {};
        (cuData?.mappings || []).forEach((m) => {
          cuMap[m.tenant_id] = { connected: true, folderName: m.folder_name, listName: m.list_name };
        });
        setCuFolderMap(cuMap);
      } catch {
        // non-fatal — ClickUp may not be configured yet
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTenantLoading(false);
    }
  }, []);

  const fetchAccountManagers = useCallback(async () => {
    setAmLoading(true);
    try {
      const data = await api.customers.getAccountManagers();
      setAccountManagers(data);
      // Seed default value for tenant create/edit AM picker
      setCreateForm((f) => ({ ...f, accountManagerId: f.accountManagerId || data.find((a) => a.isActive !== false)?.id || '' }));
    } catch (err) {
      console.error(err);
    } finally {
      setAmLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
    fetchAccountManagers();
  }, [fetchCustomers, fetchAccountManagers]);

  // ─── Active AMs for dropdowns ───────────────────────────────────────────────
  const activeAMs = accountManagers.filter((a) => a.isActive !== false);

  // ─── Tenant handlers ────────────────────────────────────────────────────────

  const handleNxgFieldChange = (field) => (e) => {
    setCreateForm((f) => ({ ...f, [field]: e.target.value }));
    setNxg360Validation(NXG360_IDLE);
  };

  const handleValidateNXG360 = async () => {
    if (!createForm.nxg360TenantId.trim() || !createForm.nxg360ApiKey.trim()) return;
    setNxg360Validation({ status: 'validating', message: '' });
    try {
      const result = await api.tenants.validate(
        createForm.nxg360TenantId.trim(),
        createForm.nxg360ApiKey.trim()
      );
      setNxg360Validation(result.valid ? NXG360_VALID : nxg360Invalid(result.message || 'Validation failed'));
    } catch (err) {
      setNxg360Validation(nxg360Invalid(err?.response?.data?.error || err.message || 'Validation request failed'));
    }
  };

  const closeCreateForm = () => {
    setShowCreateForm(false);
    setCreateForm(emptyTenantForm());
    setNxg360Validation(NXG360_IDLE);
    setShowApiKey(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.name) return;
    const hasNxgId  = createForm.nxg360TenantId.trim();
    const hasNxgKey = createForm.nxg360ApiKey.trim();
    if ((hasNxgId && !hasNxgKey) || (!hasNxgId && hasNxgKey)) return;
    if (hasNxgId && hasNxgKey && nxg360Validation.status !== 'valid') return;
    setSubmitting(true);
    try {
      await api.tenants.create(createForm);
      closeCreateForm();
      await fetchCustomers();
      await refreshTenants();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (c) => {
    setEditingId(c.id);
    setEditForm({
      name:             c.name,
      domain:           c.domain || '',
      industry:         c.industry || 'Financial Services',
      timezone:         c.timezone || 'America/New_York',
      meetingPlatform:  c.meetingPlatform || 'microsoft_teams',
      accountManagerId: c.accountManagerId || '',
      status:           c.status || 'active',
      nxg360TenantId:   '',
      nxg360ApiKey:     '',
    });
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.customers.update(editingId, editForm);
      setEditingId(null);
      await fetchCustomers();
      await refreshTenants();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const openManageAMs = async (c) => {
    setManageAMsId(c.id);
    setManageAMsLoading(true);
    setManageAMsAssignments([]);
    setAddAMUserId('');
    setAddAMSetPrimary(false);
    try {
      const data = await api.customers.getAssignments(c.id);
      setManageAMsAssignments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setManageAMsLoading(false);
    }
  };

  const closeManageAMs = () => {
    setManageAMsId(null);
    setManageAMsAssignments([]);
    setAddAMUserId('');
    setAddAMSetPrimary(false);
  };

  const handleAddAM = async () => {
    if (!addAMUserId) return;
    setAmActionLoading(true);
    try {
      const data = await api.customers.addAssignment(manageAMsId, addAMUserId, addAMSetPrimary);
      setManageAMsAssignments(data);
      setAddAMUserId('');
      setAddAMSetPrimary(false);
      await fetchCustomers();
      await refreshTenants();
    } catch (err) {
      console.error(err);
    } finally {
      setAmActionLoading(false);
    }
  };

  const handleRemoveAM = async (userId) => {
    setAmActionLoading(true);
    try {
      await api.customers.removeAssignment(manageAMsId, userId);
      const data = await api.customers.getAssignments(manageAMsId);
      setManageAMsAssignments(data);
      await fetchCustomers();
      await refreshTenants();
    } catch (err) {
      console.error(err);
    } finally {
      setAmActionLoading(false);
    }
  };

  const handleSetPrimaryAM = async (userId) => {
    setAmActionLoading(true);
    try {
      const data = await api.customers.setPrimaryAssignment(manageAMsId, userId);
      setManageAMsAssignments(data);
      await fetchCustomers();
      await refreshTenants();
    } catch (err) {
      console.error(err);
    } finally {
      setAmActionLoading(false);
    }
  };

  const handleToggleStatus = async (id, current) => {
    const next = current === 'active' ? 'suspended' : 'active';
    try {
      await api.customers.update(id, { status: next });
      await fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };

  // ─── NXG360 per-tenant management handlers ───────────────────────────────────

  const openNxgManage = (tenant) => {
    const isSame = nxgManageId === tenant.id;
    setNxgManageId(isSame ? null : tenant.id);
    if (!isSame) {
      const conn = connectionMap[tenant.id];
      setNxgForm({ workspaceId: conn?.workspaceId || '', apiKey: '' });
      setNxgRowValidation(NXG360_IDLE);
      setNxgShowKey(false);
      setNxgTestResult(null);
      setNxgConfirmId(null);
    }
  };

  const handleNxgFormChange = (field) => (e) => {
    setNxgForm((f) => ({ ...f, [field]: e.target.value }));
    setNxgRowValidation(NXG360_IDLE);
  };

  const handleNxgValidate = async () => {
    const ws = nxgForm.workspaceId.trim();
    const ak = nxgForm.apiKey.trim();
    if (!ws || !ak) return;
    setNxgRowValidation({ status: 'validating', message: '' });
    try {
      const result = await api.tenants.validate(ws, ak);
      setNxgRowValidation(result.valid ? NXG360_VALID : nxg360Invalid(result.message || 'Validation failed'));
    } catch (err) {
      setNxgRowValidation(nxg360Invalid(err?.response?.data?.error || err.message || 'Validation request failed'));
    }
  };

  const handleNxgSave = async (tenantId) => {
    if (nxgRowValidation.status !== 'valid') return;
    setNxgSaving(true);
    try {
      const conn = await api.nxg360.saveConnection(tenantId, {
        workspaceId: nxgForm.workspaceId.trim(),
        apiKey:      nxgForm.apiKey.trim(),
      });
      setConnectionMap((m) => ({ ...m, [tenantId]: conn }));
      setNxgManageId(null);
    } catch (err) {
      setNxgRowValidation(nxg360Invalid(err?.response?.data?.error || err.message || 'Save failed'));
    } finally {
      setNxgSaving(false);
    }
  };

  const handleNxgTest = async (tenantId) => {
    setNxgTesting(true);
    setNxgTestResult(null);
    try {
      const result = await api.nxg360.testConnection(tenantId);
      setNxgTestResult(result);
    } catch (err) {
      setNxgTestResult({ success: false, error: err?.response?.data?.error || err.message });
    } finally {
      setNxgTesting(false);
    }
  };

  const handleNxgDisconnect = async (tenantId) => {
    setNxgDisconnecting(true);
    try {
      await api.nxg360.disconnect(tenantId);
      setConnectionMap((m) => ({ ...m, [tenantId]: { connected: false, status: 'disconnected' } }));
      setNxgManageId(null);
      setNxgConfirmId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setNxgDisconnecting(false);
    }
  };

  // ─── ClickUp handlers ────────────────────────────────────────────────────────

  // Opens the folder picker — fetches all folders from the connected ClickUp space
  const openFolderPicker = async (tenant) => {
    setCuPickerTenant(tenant);
    setCuPickerError('');
    setCuSpaceFolders([]);
    setCuFoldersLoading(true);
    try {
      const data = await api.clickup.getSpaceFolders();
      setCuSpaceFolders(data.folders || []);
    } catch (err) {
      setCuPickerError(err?.response?.data?.error || 'Failed to load ClickUp folders.');
    } finally {
      setCuFoldersLoading(false);
    }
  };

  const closeFolderPicker = () => {
    setCuPickerTenant(null);
    setCuSpaceFolders([]);
    setCuPickerError('');
  };

  // Links an existing ClickUp folder to the tenant
  const handleLinkFolder = async (folder) => {
    if (!cuPickerTenant) return;
    const { id: tenantId } = cuPickerTenant;
    setCuConnecting(tenantId);
    setCuPickerError('');
    try {
      const data = await api.clickup.linkExistingFolder(tenantId, folder.id, folder.name);
      setCuFolderMap((prev) => ({
        ...prev,
        [tenantId]: { connected: true, folderName: data.folderName, listName: data.listName },
      }));
      closeFolderPicker();
    } catch (err) {
      setCuPickerError(err?.response?.data?.error || 'Failed to link folder.');
    } finally {
      setCuConnecting(null);
    }
  };

  // Creates a brand-new folder in ClickUp then links it
  const handleCreateNewFolder = async () => {
    if (!cuPickerTenant) return;
    const { id: tenantId, name: tenantName } = cuPickerTenant;
    setCuConnecting(tenantId);
    setCuPickerError('');
    try {
      const data = await api.clickup.createFolderForTenant(tenantId, tenantName);
      setCuFolderMap((prev) => ({
        ...prev,
        [tenantId]: { connected: true, folderName: data.folderName, listName: data.listName },
      }));
      closeFolderPicker();
    } catch (err) {
      setCuPickerError(err?.response?.data?.error || 'Failed to create ClickUp folder.');
    } finally {
      setCuConnecting(null);
    }
  };

  // ─── Account Manager handlers ────────────────────────────────────────────────

  const handleCreateAM = async (e) => {
    e.preventDefault();
    setAmError('');
    if (!amForm.firstName.trim() || !amForm.lastName.trim() || !amForm.email.trim() || !amForm.password) return;
    if (amForm.password.length < 8) { setAmError('Password must be at least 8 characters'); return; }
    setAmSubmitting(true);
    try {
      await api.customers.createAccountManager(amForm);
      setAmForm(emptyAmForm());
      setShowAmForm(false);
      setShowAmPassword(false);
      await fetchAccountManagers();
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to create account manager';
      setAmError(msg);
    } finally {
      setAmSubmitting(false);
    }
  };

  const handleToggleAMStatus = async (am) => {
    setAmToggling(am.id);
    try {
      await api.customers.setAccountManagerStatus(am.id, !am.isActive);
      await fetchAccountManagers();
    } catch (err) {
      console.error(err);
    } finally {
      setAmToggling(null);
    }
  };

  const handleResetAMPassword = async (am) => {
    setAmResetting(am.id);
    setAmResetMsg('');
    setAmError('');
    try {
      await api.customers.resetAMPassword(am.id);
      setAmResetMsg(`Reset email sent to ${am.email}`);
      setTimeout(() => setAmResetMsg(''), 6000);
    } catch (err) {
      setAmError(err?.response?.data?.error || 'Failed to reset password. Please try again.');
    } finally {
      setAmResetting(null);
    }
  };

  // ─── Access guard ────────────────────────────────────────────────────────────

  if (!isSuperAdmin()) {
    return (
      <div className="flex-grow flex items-center justify-center">
        <div className="glass-panel p-8 text-center max-w-md w-full border-red-500/25">
          <Building2 className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white font-sans">Administrative Restricted Area</h2>
          <p className="text-xs text-slate-400 mt-2 mb-6">Only Super Admin users may manage client tenants.</p>
          <div className="bg-slate-900/60 p-4 rounded-lg border border-slate-800 text-xs text-slate-400 font-semibold mb-6">
            Current Role: <span className="text-indigo-400 uppercase tracking-wide">Account Manager</span>
          </div>
          <Link to="/" className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const platformLabel = (p) => MEETING_PLATFORMS.find((x) => x.value === p)?.label || p || '—';

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-white font-sans tracking-tight">Administration</h2>
          <p className="text-xs text-slate-400">Manage customer tenants and account manager personnel</p>
        </div>
        {activeTab === 'tenants' && !showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center gap-1.5 shadow-md transition-all"
          >
            <Plus className="w-4 h-4" />
            Create Tenant
          </button>
        )}
        {activeTab === 'account-managers' && !showAmForm && (
          <button
            onClick={() => { setShowAmForm(true); setAmError(''); }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center gap-1.5 shadow-md transition-all"
          >
            <UserPlus className="w-4 h-4" />
            Add Account Manager
          </button>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 border-b border-slate-800 pb-0">
        {[
          { key: 'tenants',          label: 'Customer Tenants',   icon: Building2 },
          { key: 'account-managers', label: 'Account Managers',   icon: Users },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 border-b-2 transition-colors -mb-px ${
              activeTab === key
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {key === 'account-managers' && accountManagers.length > 0 && (
              <span className="ml-1 text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full font-bold">
                {accountManagers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════
          TAB: CUSTOMER TENANTS
         ════════════════════════════════════════════════════════ */}
      {activeTab === 'tenants' && (
        <>
          {/* ── Create form ── */}
          {showCreateForm && (
            <div className="glass-panel p-6 border-indigo-500/30 bg-indigo-950/5 animate-slide-up">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-400" />
                  Configure New Customer Tenant
                </h3>
                <button onClick={closeCreateForm} className="text-slate-400 hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Customer Name *</label>
                    <input required type="text" value={createForm.name}
                      onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Acme Corp" className={INPUT_CLS} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Domain</label>
                    <input type="text" value={createForm.domain}
                      onChange={(e) => setCreateForm((f) => ({ ...f, domain: e.target.value }))}
                      placeholder="e.g. acme.com" className={INPUT_CLS} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Industry</label>
                    <select value={createForm.industry}
                      onChange={(e) => setCreateForm((f) => ({ ...f, industry: e.target.value }))}
                      className={SELECT_CLS}>
                      {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Timezone</label>
                    <select value={createForm.timezone}
                      onChange={(e) => setCreateForm((f) => ({ ...f, timezone: e.target.value }))}
                      className={SELECT_CLS}>
                      {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Meeting Platform</label>
                    <select value={createForm.meetingPlatform}
                      onChange={(e) => setCreateForm((f) => ({ ...f, meetingPlatform: e.target.value }))}
                      className={SELECT_CLS}>
                      {MEETING_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Assigned Account Manager</label>
                    <AMCombobox
                      value={createForm.accountManagerId}
                      onChange={(id) => setCreateForm((f) => ({ ...f, accountManagerId: id }))}
                      ams={accountManagers}
                    />
                  </div>
                </div>

                {/* NXG360 integration section */}
                <div className="border border-slate-700/60 rounded-lg p-4 space-y-3 bg-cyan-950/5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Shield className="w-3 h-3 text-cyan-400" />
                    NXG360 Integration — Optional
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>NXG360 Tenant ID</label>
                      <input type="text" value={createForm.nxg360TenantId}
                        onChange={handleNxgFieldChange('nxg360TenantId')}
                        placeholder="e.g. nxg-tenant-abc123" className={INPUT_CLS} />
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>NXG360 API Key</label>
                      <div className="relative">
                        <input type={showApiKey ? 'text' : 'password'} value={createForm.nxg360ApiKey}
                          onChange={handleNxgFieldChange('nxg360ApiKey')}
                          placeholder="Paste API key" className={`${INPUT_CLS} pr-9`} />
                        <button type="button" onClick={() => setShowApiKey((s) => !s)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                          tabIndex={-1}>
                          {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {(createForm.nxg360TenantId || createForm.nxg360ApiKey) && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <button type="button"
                        disabled={!createForm.nxg360TenantId.trim() || !createForm.nxg360ApiKey.trim() || nxg360Validation.status === 'validating'}
                        onClick={handleValidateNXG360}
                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded border bg-cyan-500/5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        {nxg360Validation.status === 'validating'
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <Shield className="w-3 h-3" />}
                        {nxg360Validation.status === 'validating' ? 'Validating…' : 'Validate NXG360'}
                      </button>
                      {nxg360Validation.status === 'valid' && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                          <Check className="w-3 h-3" /> Credentials verified
                        </span>
                      )}
                      {nxg360Validation.status === 'invalid' && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                          <AlertTriangle className="w-3 h-3" /> {nxg360Validation.message}
                        </span>
                      )}
                      {nxg360Validation.status === 'idle' && createForm.nxg360TenantId.trim() && createForm.nxg360ApiKey.trim() && (
                        <span className="text-[11px] text-amber-400/80">Validate before saving</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/60">
                  <button type="button" onClick={closeCreateForm}
                    className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-4 py-2">Cancel</button>
                  <button type="submit"
                    disabled={
                      submitting ||
                      (!!createForm.nxg360TenantId.trim() !== !!createForm.nxg360ApiKey.trim()) ||
                      (createForm.nxg360TenantId.trim() && createForm.nxg360ApiKey.trim() && nxg360Validation.status !== 'valid')
                    }
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-5 py-2.5 rounded-lg flex items-center gap-1.5 shadow-md transition-colors">
                    {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Save Tenant
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── ClickUp Folder Picker Modal ── */}
          {cuPickerTenant && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1814]/70 backdrop-blur-sm p-4">
              <div className="glass-panel w-full max-w-md p-6 animate-slide-up border-emerald-500/20">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-0.5">ClickUp · Link Folder</p>
                    <h3 className="text-base font-bold text-white">{cuPickerTenant.name}</h3>
                  </div>
                  <button onClick={closeFolderPicker} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-400 mb-4">
                  Select an existing folder from your ClickUp space to link to this customer.
                  Tasks approved in the app will be pushed to that folder's <span className="text-emerald-400 font-semibold">Action Items</span> list.
                </p>

                {cuPickerError && (
                  <div className="mb-3 bg-rose-500/10 border border-rose-500/25 text-rose-400 rounded-lg px-3 py-2 text-xs">
                    {cuPickerError}
                  </div>
                )}

                {cuFoldersLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Loading folders from ClickUp…</span>
                  </div>
                ) : cuSpaceFolders.length === 0 && !cuPickerError ? (
                  <p className="text-xs text-slate-500 italic text-center py-6">No folders found in the connected space.</p>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 mb-4">
                    {cuSpaceFolders.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => handleLinkFolder(folder)}
                        disabled={cuConnecting === cuPickerTenant.id}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-700 bg-slate-900/50 hover:border-emerald-500/40 hover:bg-emerald-500/5 text-left transition-all group disabled:opacity-50"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Zap className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 flex-shrink-0 transition-colors" />
                          <span className="text-xs font-medium text-slate-200 truncate">{folder.name}</span>
                        </div>
                        {cuConnecting === cuPickerTenant.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin text-emerald-400 flex-shrink-0" />
                        ) : (
                          <span className="text-[10px] text-slate-500 group-hover:text-emerald-400 flex-shrink-0 transition-colors">Select →</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Super admin can create a new folder if none match */}
                {isSuperAdmin && (
                  <div className="border-t border-slate-800 pt-3 mt-1">
                    <p className="text-[10px] text-slate-500 mb-2">Folder doesn't exist yet?</p>
                    <button
                      onClick={handleCreateNewFolder}
                      disabled={cuConnecting === cuPickerTenant.id}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-slate-400 hover:text-emerald-400 text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      {cuConnecting === cuPickerTenant.id
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <Plus className="w-3.5 h-3.5" />}
                      Create New Folder in ClickUp
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Edit modal ── */}
          {editingId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1814]/60 backdrop-blur-sm p-4">
              <div className="glass-panel w-full max-w-2xl p-6 animate-slide-up border-indigo-500/30">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
                  <h3 className="font-bold text-white text-sm flex items-center gap-2">
                    <Edit2 className="w-4 h-4 text-indigo-400" />
                    Edit Tenant Profile
                  </h3>
                  <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-200">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleEdit} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>Customer Name *</label>
                      <input required type="text" value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className={INPUT_CLS} />
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>Domain</label>
                      <input type="text" value={editForm.domain}
                        onChange={(e) => setEditForm((f) => ({ ...f, domain: e.target.value }))}
                        className={INPUT_CLS} />
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>Industry</label>
                      <select value={editForm.industry}
                        onChange={(e) => setEditForm((f) => ({ ...f, industry: e.target.value }))}
                        className={SELECT_CLS}>
                        {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>Timezone</label>
                      <select value={editForm.timezone}
                        onChange={(e) => setEditForm((f) => ({ ...f, timezone: e.target.value }))}
                        className={SELECT_CLS}>
                        {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>Meeting Platform</label>
                      <select value={editForm.meetingPlatform}
                        onChange={(e) => setEditForm((f) => ({ ...f, meetingPlatform: e.target.value }))}
                        className={SELECT_CLS}>
                        {MEETING_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLS}>Status</label>
                      <select value={editForm.status}
                        onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                        className={SELECT_CLS}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Assigned Account Manager</label>
                    <AMCombobox
                      value={editForm.accountManagerId}
                      onChange={(id) => setEditForm((f) => ({ ...f, accountManagerId: id }))}
                      ams={accountManagers}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/60">
                    <button type="button" onClick={() => setEditingId(null)}
                      className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-4 py-2">Cancel</button>
                    <button type="submit" disabled={submitting}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2.5 rounded-lg flex items-center gap-1.5">
                      {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Save Changes
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ── Manage AMs modal ── */}
          {manageAMsId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1814]/60 backdrop-blur-sm p-4">
              <div className="glass-panel w-full max-w-md p-6 animate-slide-up border-sky-500/30">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
                  <h3 className="font-bold text-white text-sm flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-sky-400" />
                    Manage Account Managers
                    <span className="text-[10px] font-normal text-slate-500 ml-1">
                      ({manageAMsAssignments.length}/3)
                    </span>
                  </h3>
                  <button onClick={closeManageAMs} className="text-slate-400 hover:text-slate-200">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {manageAMsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-4 border-sky-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Assigned AMs list — only this part scrolls; no overflow on AM picker */}
                    <div className="space-y-2 mb-5 max-h-52 overflow-y-auto pr-0.5">
                      {manageAMsAssignments.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4 italic">No account managers assigned yet.</p>
                      ) : manageAMsAssignments.map((a) => (
                        <div key={a.userId} className="flex items-center gap-3 p-3 bg-slate-900/40 rounded-lg border border-slate-800">
                          <div className="w-7 h-7 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[10px] font-bold text-indigo-400 shrink-0">
                            {initials(a.name || 'AM')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-semibold text-slate-200 truncate">{a.name || '—'}</p>
                              {a.isPrimary && (
                                <span className="text-[9px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
                                  Primary
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 font-mono truncate">{a.email}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!a.isPrimary && (
                              <button
                                disabled={amActionLoading}
                                onClick={() => handleSetPrimaryAM(a.userId)}
                                title="Set as primary"
                                className="text-[10px] font-bold px-2 py-1 rounded border bg-amber-500/5 border-amber-500/20 text-amber-400 hover:bg-amber-500/15 disabled:opacity-40 transition-colors whitespace-nowrap"
                              >
                                Set Primary
                              </button>
                            )}
                            <button
                              disabled={amActionLoading || (a.isPrimary && manageAMsAssignments.length > 1)}
                              onClick={() => handleRemoveAM(a.userId)}
                              title={a.isPrimary && manageAMsAssignments.length > 1 ? 'Set a different primary first' : 'Remove'}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add AM section — outside any overflow container so dropdown is never clipped */}
                    {manageAMsAssignments.length < 3 ? (
                      <div className="border-t border-slate-800 pt-4 space-y-3">
                        <p className={LABEL_CLS}>Add Account Manager</p>
                        <AMCombobox
                          value={addAMUserId}
                          onChange={setAddAMUserId}
                          ams={accountManagers.filter((a) => !manageAMsAssignments.find((b) => b.userId === a.id))}
                        />
                        {addAMUserId && (
                          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={addAMSetPrimary || manageAMsAssignments.length === 0}
                              disabled={manageAMsAssignments.length === 0}
                              onChange={(e) => setAddAMSetPrimary(e.target.checked)}
                              className="accent-amber-500"
                            />
                            Set as primary account manager
                            {manageAMsAssignments.length === 0 && (
                              <span className="text-[10px] text-slate-600">(auto — first AM)</span>
                            )}
                          </label>
                        )}
                      </div>
                    ) : (
                      <div className="border-t border-slate-800 pt-4">
                        <p className="text-xs text-amber-400/80 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Maximum of 3 account managers reached for this tenant.
                        </p>
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-end gap-2 pt-4 border-t border-slate-800/60 mt-4">
                  <button type="button" onClick={closeManageAMs}
                    className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-4 py-2">
                    Close
                  </button>
                  {manageAMsAssignments.length < 3 && (
                    <button
                      type="button"
                      disabled={!addAMUserId || amActionLoading}
                      onClick={handleAddAM}
                      className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 transition-colors"
                    >
                      {amActionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                      Add
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── ClickUp error ── */}
          {cuError && (
            <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-2.5 text-rose-400 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {cuError}
              <button onClick={() => setCuError('')} className="ml-auto text-rose-500 hover:text-rose-300"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* ── Tenant table ── */}
          {tenantLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="glass-panel p-6">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Tenant ID</th>
                      <th className="py-3 px-4">Customer Name</th>
                      <th className="py-3 px-4">Industry</th>
                      <th className="py-3 px-4">Timezone</th>
                      <th className="py-3 px-4">Meeting Platform</th>
                      <th className="py-3 px-4">Account Manager</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Shield className="w-3 h-3 text-cyan-500" />
                          NXG360
                        </div>
                      </th>
                      <th className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Zap className="w-3 h-3 text-emerald-500" />
                          ClickUp
                        </div>
                      </th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {customers.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-10 text-center text-slate-500 text-xs">
                          No tenants found. Create your first tenant above.
                        </td>
                      </tr>
                    ) : customers.map((c) => {
                      const conn        = connectionMap[c.id];
                      const isConnected = conn?.connected === true;
                      const isExpanded  = nxgManageId === c.id;

                      return (
                        <React.Fragment key={c.id}>
                          {/* ── Main row ── */}
                          <tr className={`hover:bg-slate-900/20 transition-colors ${isExpanded ? 'bg-slate-900/30' : ''}`}>
                            <td className="py-3.5 px-4">
                              <span className="font-mono text-[10px] text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded select-all">
                                {c.id}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-bold text-slate-200">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                <div>
                                  <p>{c.name}</p>
                                  {c.domain && <p className="text-[10px] text-slate-500 font-mono font-normal">{c.domain}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-400">{c.industry || '—'}</td>
                            <td className="py-3.5 px-4 text-slate-400 font-mono text-[10px]">{c.timezone || '—'}</td>
                            <td className="py-3.5 px-4">
                              <span className={`text-[9px] px-2 py-0.5 rounded font-extrabold uppercase border ${PLATFORM_BADGE[c.meetingPlatform] || 'bg-slate-800 text-slate-500'}`}>
                                {c.meetingPlatform === 'google_meet' ? 'Google Meet' : c.meetingPlatform === 'microsoft_teams' ? 'MS Teams' : '—'}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-slate-300">
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[9px] font-bold text-indigo-400 shrink-0">
                                  {initials(c.accountManagerName || 'AM')}
                                </div>
                                <div>
                                  <p>{c.accountManagerName || '—'}</p>
                                  {c.accountManagerEmail && (
                                    <p className="text-[10px] text-slate-500 font-mono font-normal">{c.accountManagerEmail}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border tracking-wider ${STATUS_BADGE[c.status] || STATUS_BADGE.inactive}`}>
                                {c.status}
                              </span>
                            </td>

                            {/* ── NXG360 status cell ── */}
                            <td className="py-3.5 px-4">
                              <button
                                onClick={() => openNxgManage(c)}
                                title={isConnected ? `Connected — workspace: ${conn.workspaceId}` : 'Not connected — click to set up'}
                                className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                                  isConnected
                                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20'
                                    : 'bg-slate-800/60 border-slate-700 text-slate-500 hover:border-cyan-500/40 hover:text-cyan-400 hover:bg-cyan-500/5'
                                }`}
                              >
                                {isConnected
                                  ? <Wifi className="w-3 h-3" />
                                  : <WifiOff className="w-3 h-3" />
                                }
                                {isConnected ? 'Connected' : 'Not set'}
                                {isExpanded
                                  ? <ChevronUp className="w-3 h-3 ml-0.5" />
                                  : <ChevronDown className="w-3 h-3 ml-0.5" />
                                }
                              </button>
                            </td>

                            {/* ── ClickUp cell ── */}
                            <td className="py-3.5 px-4">
                              {cuFolderMap[c.id]?.connected ? (
                                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-full w-fit"
                                  title={`Folder: ${cuFolderMap[c.id].folderName} → ${cuFolderMap[c.id].listName}`}>
                                  <Zap className="w-3 h-3" />
                                  {cuFolderMap[c.id].folderName || 'Synced'}
                                </div>
                              ) : cuGlobalConn ? (
                                <button
                                  onClick={() => openFolderPicker({ id: c.id, name: c.name })}
                                  disabled={cuConnecting === c.id}
                                  className="flex items-center gap-1.5 text-[10px] font-semibold bg-slate-800/60 border border-slate-700 text-slate-500 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5 px-2.5 py-1 rounded-full transition-all disabled:opacity-50"
                                >
                                  {cuConnecting === c.id
                                    ? <RefreshCw className="w-3 h-3 animate-spin" />
                                    : <Zap className="w-3 h-3" />}
                                  {cuConnecting === c.id ? 'Linking…' : 'Link Folder'}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-600 italic">Not set up</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4">
                              <div className="flex justify-end gap-1 items-center">
                                <Link to="/integrations"
                                  className="p-1.5 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded transition-colors"
                                  title="Connect OAuth / Calendar">
                                  <LinkIcon className="w-3.5 h-3.5" />
                                </Link>
                                <button onClick={() => openEdit(c)}
                                  className="p-1.5 text-slate-500 hover:text-sky-400 hover:bg-sky-500/10 rounded transition-colors"
                                  title="Edit Tenant">
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => openManageAMs(c)}
                                  className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                                  title="Manage Account Managers">
                                  <UserCheck className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleToggleStatus(c.id, c.status)}
                                  className={`text-[9px] font-bold py-1 px-2 rounded border transition-colors ${
                                    c.status === 'active'
                                      ? 'bg-rose-500/5 text-rose-400 border-rose-500/20 hover:bg-rose-500/15'
                                      : 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15'
                                  }`}>
                                  {c.status === 'active' ? 'Suspend' : 'Activate'}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* ── NXG360 management sub-row ── */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={10} className="px-6 pb-4 pt-0 bg-slate-900/40">
                                <div className="border border-cyan-500/20 rounded-xl p-5 bg-cyan-950/10 space-y-4">

                                  {/* Panel header */}
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Shield className="w-4 h-4 text-cyan-400" />
                                      <span className="text-sm font-bold text-white">NXG360 Integration — {c.name}</span>
                                    </div>
                                    {isConnected && (
                                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                        <span>Workspace: <span className="font-mono text-slate-300">{conn.workspaceId}</span></span>
                                        <span>·</span>
                                        <span>Key: <span className="font-mono text-slate-300">••••{conn.keyHint}</span></span>
                                        {conn.lastSyncedAt && (
                                          <>
                                            <span>·</span>
                                            <span>Last sync: {new Date(conn.lastSyncedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Test result banner */}
                                  {nxgTestResult && (
                                    <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                                      nxgTestResult.success
                                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                                        : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
                                    }`}>
                                      {nxgTestResult.success
                                        ? <><Zap className="w-3.5 h-3.5 shrink-0" /> Connection active — {nxgTestResult.findingCount} findings returned</>
                                        : <><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Test failed: {nxgTestResult.error}</>
                                      }
                                    </div>
                                  )}

                                  {/* Connected state: test + disconnect + update section */}
                                  {isConnected && (
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <button
                                        onClick={() => handleNxgTest(c.id)}
                                        disabled={nxgTesting}
                                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded border bg-sky-500/5 border-sky-500/25 text-sky-400 hover:bg-sky-500/15 disabled:opacity-40 transition-colors"
                                      >
                                        {nxgTesting
                                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                                          : <Zap className="w-3 h-3" />
                                        }
                                        {nxgTesting ? 'Testing…' : 'Test Connection'}
                                      </button>

                                      {nxgConfirmId === c.id ? (
                                        <div className="flex items-center gap-2">
                                          <span className="text-[11px] text-rose-400 font-semibold">Remove NXG360 integration?</span>
                                          <button
                                            onClick={() => handleNxgDisconnect(c.id)}
                                            disabled={nxgDisconnecting}
                                            className="flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded border bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
                                          >
                                            {nxgDisconnecting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Unplug className="w-3 h-3" />}
                                            Yes, Disconnect
                                          </button>
                                          <button
                                            onClick={() => setNxgConfirmId(null)}
                                            className="text-[11px] text-slate-400 hover:text-slate-200 font-semibold px-2 py-1.5 transition-colors"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setNxgConfirmId(c.id)}
                                          className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded border bg-rose-500/5 border-rose-500/20 text-rose-400 hover:bg-rose-500/10 transition-colors"
                                        >
                                          <Unplug className="w-3 h-3" />
                                          Disconnect
                                        </button>
                                      )}

                                      <span className="text-[10px] text-slate-600 ml-auto">Update credentials below to replace</span>
                                    </div>
                                  )}

                                  {/* Connect / update form */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className={LABEL_CLS}>
                                        {isConnected ? 'New Workspace ID' : 'NXG360 Workspace ID'}
                                      </label>
                                      <input
                                        type="text"
                                        value={nxgForm.workspaceId}
                                        onChange={handleNxgFormChange('workspaceId')}
                                        placeholder={isConnected ? conn.workspaceId : 'e.g. acme-ws-001'}
                                        className={INPUT_CLS}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className={LABEL_CLS}>
                                        {isConnected ? 'New API Key' : 'NXG360 API Key'}
                                      </label>
                                      <div className="relative">
                                        <input
                                          type={nxgShowKey ? 'text' : 'password'}
                                          value={nxgForm.apiKey}
                                          onChange={handleNxgFormChange('apiKey')}
                                          placeholder={isConnected ? `Replace ••••${conn.keyHint}` : 'Paste API key'}
                                          className={`${INPUT_CLS} pr-9`}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setNxgShowKey((s) => !s)}
                                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                          tabIndex={-1}
                                        >
                                          {nxgShowKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Validate + Save row */}
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <button
                                      type="button"
                                      disabled={!nxgForm.workspaceId.trim() || !nxgForm.apiKey.trim() || nxgRowValidation.status === 'validating'}
                                      onClick={handleNxgValidate}
                                      className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded border bg-cyan-500/5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                      {nxgRowValidation.status === 'validating'
                                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                                        : <Shield className="w-3 h-3" />
                                      }
                                      {nxgRowValidation.status === 'validating' ? 'Validating…' : 'Validate'}
                                    </button>

                                    {nxgRowValidation.status === 'valid' && (
                                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                        <Check className="w-3 h-3" /> Credentials verified
                                      </span>
                                    )}
                                    {nxgRowValidation.status === 'invalid' && (
                                      <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                                        <AlertTriangle className="w-3 h-3" /> {nxgRowValidation.message}
                                      </span>
                                    )}
                                    {nxgRowValidation.status === 'idle' && nxgForm.workspaceId.trim() && nxgForm.apiKey.trim() && (
                                      <span className="text-[11px] text-amber-400/80">Validate before saving</span>
                                    )}

                                    <button
                                      type="button"
                                      disabled={nxgRowValidation.status !== 'valid' || nxgSaving}
                                      onClick={() => handleNxgSave(c.id)}
                                      className="flex items-center gap-1.5 text-[11px] font-bold px-4 py-1.5 rounded border bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-auto"
                                    >
                                      {nxgSaving
                                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                                        : <Check className="w-3 h-3" />
                                      }
                                      {isConnected ? 'Update Connection' : 'Save & Connect'}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB: ACCOUNT MANAGERS
         ════════════════════════════════════════════════════════ */}
      {activeTab === 'account-managers' && (
        <>
          {/* ── Create AM form ── */}
          {showAmForm && (
            <div className="glass-panel p-6 border-emerald-500/30 bg-emerald-950/5 animate-slide-up">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-emerald-400" />
                  Add New Account Manager
                </h3>
                <button onClick={() => { setShowAmForm(false); setAmError(''); setAmForm(emptyAmForm()); setShowAmPassword(false); }}
                  className="text-slate-400 hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateAM} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>First Name *</label>
                    <input required type="text" value={amForm.firstName}
                      onChange={(e) => setAmForm((f) => ({ ...f, firstName: e.target.value }))}
                      placeholder="e.g. Sarah" className={INPUT_CLS} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Last Name *</label>
                    <input required type="text" value={amForm.lastName}
                      onChange={(e) => setAmForm((f) => ({ ...f, lastName: e.target.value }))}
                      placeholder="e.g. Jenkins" className={INPUT_CLS} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Email Address *</label>
                    <input required type="email" value={amForm.email}
                      onChange={(e) => setAmForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="e.g. sarah.jenkins@nxgsecure.com" className={INPUT_CLS} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLS}>Initial Password * (min 8 chars)</label>
                    <div className="relative">
                      <input
                        required
                        type={showAmPassword ? 'text' : 'password'}
                        value={amForm.password}
                        onChange={(e) => { setAmForm((f) => ({ ...f, password: e.target.value })); setAmError(''); }}
                        placeholder="Set initial password"
                        className={`${INPUT_CLS} pr-9`}
                      />
                      <button type="button" onClick={() => setShowAmPassword((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                        tabIndex={-1}>
                        {showAmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {amError && (
                  <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {amError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/60">
                  <button type="button"
                    onClick={() => { setShowAmForm(false); setAmError(''); setAmForm(emptyAmForm()); setShowAmPassword(false); }}
                    className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-4 py-2">Cancel</button>
                  <button type="submit" disabled={amSubmitting}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-5 py-2.5 rounded-lg flex items-center gap-1.5 shadow-md transition-colors">
                    {amSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    Create Account Manager
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── AM list ── */}
          {amLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-bold text-white">Account Manager Personnel</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {accountManagers.filter((a) => a.isActive !== false).length} active
                    {accountManagers.filter((a) => a.isActive === false).length > 0 &&
                      `, ${accountManagers.filter((a) => a.isActive === false).length} deactivated`}
                  </p>
                </div>
              </div>

              {amResetMsg && (
                <div className="flex items-center gap-2 mb-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-2.5 rounded-lg text-xs font-semibold">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                  {amResetMsg}
                </div>
              )}

              {accountManagers.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-xs">
                  No account managers found. Add one using the button above.
                </div>
              ) : (
                <div className="space-y-2">
                  {accountManagers.map((am) => {
                    const isCurrentUser = currentUser?.id === am.id;
                    const isActive = am.isActive !== false;
                    const toggling = amToggling === am.id;

                    return (
                      <div
                        key={am.id}
                        className={`flex items-center gap-4 px-4 py-3.5 rounded-lg border transition-colors ${
                          isActive
                            ? 'bg-slate-900/30 border-slate-800 hover:bg-slate-900/50'
                            : 'bg-slate-900/10 border-slate-800/40 opacity-60'
                        }`}
                      >
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${
                          isActive
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            : 'bg-slate-800 border-slate-700 text-slate-500'
                        }`}>
                          {initials(am.name || `${am.firstName || ''} ${am.lastName || ''}`)}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-200 truncate">
                              {am.name || `${am.firstName || ''} ${am.lastName || ''}`.trim() || '—'}
                            </p>
                            {isCurrentUser && (
                              <span className="text-[9px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-bold">YOU</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 font-mono truncate">{am.email}</p>
                        </div>

                        {/* Created date */}
                        <div className="hidden md:block text-right shrink-0">
                          <p className="text-[10px] text-slate-600">Added</p>
                          <p className="text-[11px] text-slate-400">
                            {am.createdAt ? new Date(am.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          </p>
                        </div>

                        {/* Status badge */}
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border tracking-wider shrink-0 ${
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-slate-800 text-slate-500 border-slate-700'
                        }`}>
                          {isActive ? 'Active' : 'Deactivated'}
                        </span>

                        {/* Reset Password button — only for active AMs, not current user */}
                        {isActive && !isCurrentUser && (
                          <button
                            disabled={amResetting === am.id || toggling}
                            onClick={() => handleResetAMPassword(am)}
                            title="Send a temporary password to this AM's email"
                            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded border bg-amber-500/5 border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {amResetting === am.id
                              ? <RefreshCw className="w-3 h-3 animate-spin" />
                              : <KeyRound className="w-3 h-3" />
                            }
                            Reset Pwd
                          </button>
                        )}

                        {/* Toggle button */}
                        <button
                          disabled={toggling || isCurrentUser}
                          onClick={() => handleToggleAMStatus(am)}
                          title={isCurrentUser ? 'Cannot deactivate your own account' : isActive ? 'Deactivate account manager' : 'Reactivate account manager'}
                          className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded border transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                            isActive
                              ? 'bg-rose-500/5 border-rose-500/20 text-rose-400 hover:bg-rose-500/10'
                              : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10'
                          }`}
                        >
                          {toggling
                            ? <RefreshCw className="w-3 h-3 animate-spin" />
                            : isActive
                              ? <Ban className="w-3 h-3" />
                              : <CheckCircle className="w-3 h-3" />
                          }
                          {isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
