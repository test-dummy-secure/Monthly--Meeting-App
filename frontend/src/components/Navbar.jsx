import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';

export const Navbar = () => {
  const location = useLocation();
  const navItems = [
    { name: 'Dashboard',   path: '/' },
    { name: 'Customers',   path: '/customers' },
    { name: 'Meetings',    path: '/meetings' },
    { name: 'Integrations', path: '/integrations' },
    { name: 'Reports',     path: '/reports' },
  ];

  return (
    <header className="flex items-center justify-between bg-[#FDFAF5] px-6 py-3 shadow-sm border-b border-[#D8D2C4]">
      <div className="flex items-center space-x-4">
        <Link to="/" className="flex items-center gap-3">
          <svg width="36" height="18" viewBox="0 0 46 24" fill="none">
            <path
              d="M23,12 C23,5 18,1 12,1 C6,1 1,6 1,12 C1,18 6,23 12,23 C18,23 23,19 23,12 C23,5 28,1 34,1 C40,1 45,6 45,12 C45,18 40,23 34,23 C28,23 23,19 23,12"
              stroke="#1A1814" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          <div className="w-px h-4 bg-[#C8C2B8]" />
          <span className="text-lg font-bold tracking-tight"><span className="text-[#1A1814]">Nxg</span><span className="font-normal text-[#9B9589]">Secure</span></span>
        </Link>
        <nav className="hidden md:flex space-x-2">
          {navItems.map(item => (
            <Link
              key={item.name}
              to={item.path}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors
                ${location.pathname === item.path
                  ? 'bg-[#EDE8DC] text-[#1A1814] font-semibold'
                  : 'text-[#6B6358] hover:text-[#1A1814] hover:bg-[#EDE8DC]'}`}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center space-x-3">
        <button
          className="p-2 rounded-full hover:bg-[#EDE8DC] transition-colors"
          aria-label="Notifications"
        >
          <Bell size={20} className="text-[#6B6358]" />
        </button>
      </div>
    </header>
  );
};
