import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../services/api';

const TenantContext = createContext(null);

export const TenantProvider = ({ children }) => {
  const { user } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadTenants = async () => {
      if (!user) {
        setTenants([]);
        setSelectedTenant(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await api.tenants.list();
        const available = Array.isArray(response) ? response : [];
        setTenants(available);

        const savedId = localStorage.getItem('nxg_selected_tenant');
        const savedTenant = savedId
          ? available.find((t) => String(t.id) === String(savedId))
          : null;

        const defaultTenant = savedTenant || available[0] || null;

        if (defaultTenant) {
          setSelectedTenant(defaultTenant);
          localStorage.setItem('nxg_selected_tenant', String(defaultTenant.id));
        }

        setError(null);
      } catch (err) {
        setError(err.message || 'Failed to load tenants');
        setTenants([]);
      } finally {
        setLoading(false);
      }
    };

    loadTenants();
  }, [user]);

  const selectTenant = (tenant) => {
    if (!tenant) return;
    const hasAccess = tenants.some((t) => t.id === tenant.id);
    if (!hasAccess) {
      setError('You do not have access to this tenant');
      return;
    }
    setSelectedTenant(tenant);
    localStorage.setItem('nxg_selected_tenant', String(tenant.id));
    setError(null);
  };

  const refreshTenants = async () => {
    if (!user) return;
    try {
      const response = await api.tenants.list();
      const available = Array.isArray(response) ? response : [];
      setTenants(available);
      if (selectedTenant) {
        const refreshed = available.find((t) => String(t.id) === String(selectedTenant.id));
        if (refreshed) setSelectedTenant(refreshed);
      }
    } catch {
      /* silent */
    }
  };

  return (
    <TenantContext.Provider
      value={{
        tenants,
        selectedTenant,
        selectTenant,
        refreshTenants,
        loading,
        error,
        canSelectTenant: user?.role === 'super_admin' || user?.role === 'account_manager',
        tenantId: selectedTenant?.id || null,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within TenantProvider');
  return context;
};
