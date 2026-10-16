import React, { createContext, useContext, useState, useEffect } from 'react';

const SidebarContext = createContext(null);

const STORAGE_KEY = 'bmmj_sidebar_collapsed';

export const SidebarProvider = ({ children }) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch { /* private-browsing or storage blocked — non-fatal, just won't persist */ }
  }, [collapsed]);

  const toggleCollapsed = () => setCollapsed((v) => !v);

  // Separate from `collapsed` (the desktop icon-rail state) — on small
  // screens the sidebar is an off-canvas drawer, hidden by default rather
  // than always rendered at some width. Never persisted: a drawer should
  // always start closed on a fresh page load, unlike the desktop preference.
  const [mobileOpen, setMobileOpen] = useState(false);
  const openMobile  = () => setMobileOpen(true);
  const closeMobile = () => setMobileOpen(false);

  return (
    <SidebarContext.Provider value={{ collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider');
  return ctx;
};
