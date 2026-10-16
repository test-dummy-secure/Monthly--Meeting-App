import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { useTenant } from '../context/TenantContext';

// Custom dropdown — deliberately not a native <select>. The open option list
// on a native <select> is rendered by the OS/browser itself (plain white
// background, default blue highlight on Windows/Chrome) and can't be
// restyled with CSS, which is why it looked out of place before. Styled on
// the app's real, literal cream tokens (matching Sidebar.jsx, which this
// component sits directly inside) rather than `slate`/`indigo` — this app's
// tailwind.config.js remaps both of those to the same cream/gold scale with
// no darkMode option, so they never actually render as a dark theme here.
//
// The option list is portaled to document.body rather than rendered as a
// normal absolutely-positioned child. The sidebar (its actual parent in the
// DOM) has overflow-hidden on purpose, to keep the sidebar itself from
// scrolling as a whole — but that same overflow-hidden silently clips any
// descendant that tries to render outside its bounds, including an absolute
// dropdown, regardless of z-index. With enough tenants, the list got hard-
// cut before showing all of them — this is the same class of bug fixed for
// KPIDetailsModal earlier via createPortal, applied here for the same reason.
const TenantDropdown = ({ tenants, selectedTenant, selectTenant, compact }) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const rootRef    = useRef(null);
  const triggerRef = useRef(null);

  const updateCoords = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left, width: r.width });
  };

  useLayoutEffect(() => {
    if (open) updateCoords();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (e.target.closest?.('[data-tenant-portal]')) return;
      setOpen(false);
    };
    const handleEscape = (e) => { if (e.key === 'Escape') setOpen(false); };
    // Keep the portaled list glued to the trigger if the page scrolls or resizes.
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open]);

  const handleSelect = (tenant) => {
    selectTenant(tenant);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 rounded-xl border bg-[#FDFAF5] text-left text-xs font-semibold text-[#1A1814] outline-none transition-colors
          ${open ? 'border-[#B8872A]' : 'border-[#D8D2C4] hover:border-[#C4BEB0]'}
          ${compact ? 'px-3 py-2' : 'px-3 py-2'}`}
      >
        <span className="truncate">{selectedTenant?.name || 'Select tenant'}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[#A89E90] transition-transform ${open ? 'rotate-180 text-[#B8872A]' : ''}`} />
      </button>

      {open && coords && createPortal(
        <div
          data-tenant-portal
          role="listbox"
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
          className="z-[100] max-h-64 overflow-y-auto rounded-xl border border-[#D8D2C4] bg-[#FDFAF5] backdrop-blur-xl shadow-2xl shadow-black/20 py-1.5 animate-slide-up"
        >
          {tenants.map((tenant) => {
            const isSelected = String(tenant.id) === String(selectedTenant?.id);
            return (
              <button
                key={tenant.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(tenant)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors
                  ${isSelected ? 'bg-[#FAE8B8]/50 text-[#7A5719] font-semibold' : 'text-[#4A4239] hover:bg-[#F5F1E8] hover:text-[#1A1814]'}`}
              >
                <span className="truncate">{tenant.name}</span>
                {isSelected && <Check className="w-3.5 h-3.5 shrink-0 text-[#B8872A]" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
};

export const TenantSelector = ({ className = '', compact = false }) => {
  const { tenants, selectedTenant, selectTenant, canSelectTenant, loading } = useTenant();

  if (!canSelectTenant || loading || tenants.length === 0) return null;

  if (compact) {
    return (
      <div className={`w-full ${className}`}>
        <TenantDropdown tenants={tenants} selectedTenant={selectedTenant} selectTenant={selectTenant} compact />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6358] flex items-center gap-1.5 shrink-0">
        <Building2 className="w-3.5 h-3.5 text-[#B8872A]" />
        Tenant
      </span>
      <div className="min-w-[220px]">
        <TenantDropdown tenants={tenants} selectedTenant={selectedTenant} selectTenant={selectTenant} />
      </div>
    </div>
  );
};
