import React, { useState, useRef, useEffect } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSidebar } from '../context/SidebarContext';
import { InfinityMark } from './NxgLogo';
import { TenantSelector } from './TenantSelector';
import { NotificationPanel } from './NotificationPanel';
import {
  LayoutDashboard,
  Users,
  CalendarRange,
  Settings as SettingsIcon,
  ClipboardList,
  LogOut,
  FileBarChart,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronUp,
} from 'lucide-react';

export const Sidebar = () => {
  const { user, logout, isSuperAdmin } = useAuth();
  const { collapsed, toggleCollapsed, mobileOpen, closeMobile } = useSidebar();
  const navigate = useNavigate();

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    if (!profileOpen) return;
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    const handleEscape = (e) => { if (e.key === 'Escape') setProfileOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [profileOpen]);

  // Collapsing the sidebar hides the profile dropdown's anchor context —
  // close it so it can't be left open, invisible, behind the collapsed rail.
  useEffect(() => { setProfileOpen(false); }, [collapsed]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard',          path: '/',             icon: LayoutDashboard },
    { name: 'Customers',          path: '/customers',    icon: Users, isSuperAdminOnly: true },
    { name: 'Meetings & Tracker', path: '/meetings',     icon: CalendarRange },
    { name: 'Weekly Reports',     path: '/reports',      icon: FileBarChart },
    { name: 'Activity',           path: '/logs',         icon: ClipboardList },
    { name: 'Settings',           path: '/integrations', icon: SettingsIcon },
  ];

  return (
    <>
      {/* Mobile backdrop — tap to close. Never rendered on lg+ (sidebar is
          always docked there, not an overlay), so this can't accidentally
          block clicks on a desktop viewport. */}
      {mobileOpen && (
        <div
          onClick={closeMobile}
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`bg-[#FDFAF5] border-r border-[#D8D2C4] flex flex-col justify-between h-screen fixed top-0 left-0 z-40 shadow-sm transition-all duration-200
          w-64 ${collapsed ? 'lg:w-20' : 'lg:w-64'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* NxgSecure Brand — click to collapse/expand */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`group px-5 py-4 border-b border-[#E4DFCF] flex items-center shrink-0 hover:bg-[#F5F1E8] transition-colors ${collapsed ? 'justify-center' : 'gap-3'}`}
        >
          <InfinityMark width={40} height={15} className="shrink-0" />
          {!collapsed && (
            <>
              <div className="w-px h-5 bg-[#C8C2B8] shrink-0" />
              <div className="text-left flex-1 min-w-0">
                <h1 className="text-base tracking-tight leading-tight">
                  <span className="font-bold text-[#1A1814]">Nxg</span><span className="font-normal text-[#9B9589]">Secure</span>
                </h1>
                <p className="text-[9px] text-[#B8872A] font-semibold uppercase tracking-widest mt-0.5">
                  Security Management
                </p>
              </div>
              <PanelLeftClose className="w-3.5 h-3.5 text-[#A89E90] group-hover:text-[#6B6358] shrink-0 transition-colors" />
            </>
          )}
          {collapsed && (
            <PanelLeftOpen className="w-3 h-3 text-[#A89E90] group-hover:text-[#6B6358] absolute bottom-1.5 transition-colors" />
          )}
        </button>

        {/* Navigation */}
        <nav className="p-3 space-y-0.5 shrink-0">
          {navItems.map((item) => {
            if (item.isSuperAdminOnly && !isSuperAdmin()) return null;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={closeMobile}
                title={collapsed ? item.name : undefined}
                className={({ isActive }) => `
                  flex items-center rounded-lg text-sm font-medium transition-all duration-150
                  ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
                  ${isActive
                    ? 'bg-[#B8872A] text-[#1A1814] shadow-sm font-semibold'
                    : 'text-[#4A4239] hover:text-[#1A1814] hover:bg-[#EDE8DC]'
                  }
                `}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{item.name}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Tenant Selector — needs label + name width, so it steps aside when collapsed */}
        {!collapsed && (
          <div className="px-3 pb-4 mt-2 shrink-0">
            <div className="border-t border-[#E4DFCF] pt-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#A89E90] mb-2 px-1">
                Active Tenant
              </p>
              <TenantSelector compact />
            </div>
          </div>
        )}
      </div>

      {/* User Footer */}
      <div className={`border-t border-[#E4DFCF] shrink-0 relative ${collapsed ? 'p-2' : 'p-4'}`} ref={profileRef}>
        {user && (
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            title={collapsed ? `${user.first_name} ${user.last_name}` : undefined}
            className={`w-full flex items-center rounded-lg transition-colors hover:bg-[#F5F1E8] ${collapsed ? 'justify-center py-2' : 'gap-3 px-1 py-1.5'}`}
          >
            <div className="w-9 h-9 rounded-full bg-[#F5F1E8] flex items-center justify-center border border-[#D8D2C4] shrink-0">
              <span className="font-bold text-[#B8872A] text-xs">
                {user.first_name?.[0]}{user.last_name?.[0]}
              </span>
            </div>
            {!collapsed && (
              <>
                <div className="overflow-hidden flex-1 text-left">
                  <p className="text-sm font-semibold text-[#1A1814] truncate leading-tight">
                    {user.first_name} {user.last_name}
                  </p>
                  <span className={`
                    text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider inline-block mt-0.5
                    ${user.role === 'super_admin'
                      ? 'bg-[#B8872A]/15 text-[#7A5719]'
                      : 'bg-[#EDE8DC] text-[#6B6358]'}
                  `}>
                    {user.role.replace(/_/g, ' ')}
                  </span>
                </div>
                <ChevronUp className={`w-3.5 h-3.5 text-[#A89E90] shrink-0 transition-transform ${profileOpen ? '' : 'rotate-180'}`} />
              </>
            )}
          </button>
        )}

        {/* Notifications — kept separate from the account menu below, same
            convention as most apps (bell = its own always-visible control) */}
        <div className={`flex items-center pt-2 ${collapsed ? 'justify-center' : 'px-1'}`}>
          <NotificationPanel />
        </div>

        {/* Account dropdown — Change Password + Sign Out */}
        {profileOpen && (
          <div
            className={`absolute bottom-full mb-1.5 rounded-xl border border-[#D8D2C4] bg-[#FDFAF5] shadow-lg py-1.5 z-40 animate-slide-up
              ${collapsed ? 'left-full ml-1.5 w-48' : 'left-3 right-3'}`}
          >
            <Link
              to="/account/password"
              onClick={() => { setProfileOpen(false); closeMobile(); }}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#6B6358] hover:text-[#1A1814] hover:bg-[#EDE8DC] transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Change Password</span>
            </Link>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
      </aside>
    </>
  );
};
