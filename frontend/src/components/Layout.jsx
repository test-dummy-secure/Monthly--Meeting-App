import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Sidebar } from './Sidebar';
import { SidebarProvider, useSidebar } from '../context/SidebarContext';

// Split out so it can read the collapsed state via context — the padding
// here has to track the Sidebar's actual width or content either leaves a
// gap (still padded for the expanded width) or slides underneath the
// fixed-position sidebar (padded too little).
//
// Below lg, the sidebar becomes an off-canvas drawer (see Sidebar.jsx) rather
// than a docked column, so content stays full-width there instead of
// reserving space for a sidebar that isn't visible.
const LayoutContent = () => {
  const { collapsed, openMobile } = useSidebar();
  return (
    <div className="min-h-screen flex bg-cyber-darker text-slate-50">
      <Sidebar />
      <main className={`flex-1 min-h-screen flex flex-col transition-[padding] duration-200 ${collapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
        {/* Mobile-only top bar — the sidebar is off-canvas below lg, so this
            is the only way to open it there. */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-[#D8D2C4] bg-[#FDFAF5] shrink-0 sticky top-0 z-20">
          <button
            type="button"
            onClick={openMobile}
            aria-label="Open menu"
            className="p-2 -ml-2 rounded-lg text-[#4A4239] hover:bg-[#EDE8DC] transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-bold text-[#1A1814]">Nxg<span className="font-normal text-[#9B9589]">Secure</span></span>
        </div>

        {/* max-w loosened from 7xl (1280px) to 1600px — dense pages like the
            Tracker table were capped well short of the room a collapsed
            sidebar (or a wide monitor) actually makes available. */}
        <div className="p-4 sm:p-6 lg:p-8 flex-1 flex flex-col gap-6 lg:gap-8 max-w-[1600px] w-full mx-auto animate-slide-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export const Layout = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cyber-darker">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#B8872A] border-t-transparent rounded-full animate-spin" style={{ borderWidth: '3px' }}></div>
          <p className="text-sm font-medium text-[#6B6358]">Loading NxgSecure…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <SidebarProvider>
      <LayoutContent />
    </SidebarProvider>
  );
};
