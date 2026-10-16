import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    const restoreAuth = async () => {
      const savedToken       = localStorage.getItem('nxg_token');
      const savedUser        = localStorage.getItem('nxg_user');
      const savedRefreshToken = localStorage.getItem('nxg_refresh_token');

      if (savedToken && savedUser) {
        setUser(JSON.parse(savedUser));
      } else if (savedRefreshToken) {
        try {
          const response = await api.auth.refresh(savedRefreshToken);
          localStorage.setItem('nxg_token', response.accessToken);
          localStorage.setItem('nxg_refresh_token', response.refreshToken);
          if (response.user) {
            localStorage.setItem('nxg_user', JSON.stringify(response.user));
            setUser(response.user);
          }
        } catch {
          localStorage.removeItem('nxg_token');
          localStorage.removeItem('nxg_refresh_token');
          localStorage.removeItem('nxg_user');
          setUser(null);
        }
      }

      setLoading(false);
    };

    restoreAuth();
  }, []);

  const login = async (email, password) => {
    setError(null);
    try {
      const response     = await api.auth.login(email, password);
      const accessToken  = response.accessToken || response.token;
      const refreshToken = response.refreshToken || response.refresh_token;

      if (accessToken)  localStorage.setItem('nxg_token', accessToken);
      if (refreshToken) localStorage.setItem('nxg_refresh_token', refreshToken);

      if (response.user) {
        localStorage.setItem('nxg_user', JSON.stringify(response.user));
        setUser(response.user);
      }

      return response.user;
    } catch (err) {
      setError(err.message || 'Login failed');
      throw err;
    }
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('nxg_refresh_token');
    try {
      if (refreshToken) await api.auth.logout(refreshToken);
    } catch {
      /* silent */
    }
    localStorage.removeItem('nxg_token');
    localStorage.removeItem('nxg_refresh_token');
    localStorage.removeItem('nxg_user');
    setUser(null);
  };

  // Called after a successful password change to sync the flag in local state.
  const updateUser = (patch) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      localStorage.setItem('nxg_user', JSON.stringify(updated));
      return updated;
    });
  };

  const isSuperAdmin    = () => user?.role === 'super_admin';
  const isAccountManager = () => user?.role === 'account_manager';

  return (
    <AuthContext.Provider value={{
      user, login, logout, updateUser,
      loading, error,
      isSuperAdmin, isAccountManager,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
