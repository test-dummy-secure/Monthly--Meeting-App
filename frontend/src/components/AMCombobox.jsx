import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, X } from 'lucide-react';

const INPUT_CLS =
  'w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 outline-none transition-colors';

/**
 * Searchable combobox for picking an Account Manager.
 *
 * Props:
 *   value      — selected AM user UUID ('' = unassigned)
 *   onChange   — called with the UUID string ('' to unassign)
 *   ams        — array of { id, name, email, isActive } — passed from parent
 *                that has already fetched getAccountManagers(); avoids a
 *                duplicate fetch when the parent list is already loaded.
 *   disabled   — disables the input
 */
export const AMCombobox = ({ value = '', onChange, ams = [], disabled = false }) => {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState('');
  const [cursor,  setCursor]  = useState(-1);
  const containerRef          = useRef(null);
  const inputRef              = useRef(null);
  const listRef               = useRef(null);

  // Only show active AMs in the picker.
  const activeAMs = ams.filter((a) => a.isActive !== false);

  // The AM object that matches the current value UUID.
  const selectedAM = activeAMs.find((a) => a.id === value) || null;

  // Filtered list based on the search query.
  const filtered = query.trim()
    ? activeAMs.filter(
        (a) =>
          a.name.toLowerCase().includes(query.toLowerCase()) ||
          a.email.toLowerCase().includes(query.toLowerCase())
      )
    : activeAMs;

  // When the dropdown opens, reset the query and show the full list.
  const openDropdown = () => {
    if (disabled) return;
    setQuery('');
    setCursor(-1);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setQuery('');
    setCursor(-1);
  }, []);

  const select = (am) => {
    onChange(am ? am.id : '');
    closeDropdown();
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeDropdown]);

  // Keyboard navigation.
  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    // +1 because index 0 in the list is the "Unassigned" option.
    const total = filtered.length + 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, total - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor === 0) {
        select(null);
      } else if (cursor > 0 && filtered[cursor - 1]) {
        select(filtered[cursor - 1]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    }
  };

  // Scroll cursor item into view.
  useEffect(() => {
    if (!listRef.current || cursor < 0) return;
    const item = listRef.current.children[cursor];
    item?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const displayValue = selectedAM ? selectedAM.name : '';

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger button (looks like a select) */}
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={openDropdown}
          className={`${INPUT_CLS} py-2.5 flex items-center justify-between gap-2 text-left disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className={displayValue ? 'text-slate-100' : 'text-slate-600'}>
            {displayValue || '— Unassigned —'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        </button>
      ) : (
        /* Search input — shown when open */
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(-1); }}
          onKeyDown={handleKeyDown}
          placeholder="Search by name or email…"
          className={`${INPUT_CLS} py-2.5`}
        />
      )}

      {/* Dropdown list */}
      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1"
        >
          {/* Unassigned option */}
          <li
            onMouseDown={() => select(null)}
            onMouseEnter={() => setCursor(0)}
            className={`flex items-center px-3 py-2 cursor-pointer text-xs transition-colors ${
              cursor === 0
                ? 'bg-indigo-600/20 text-slate-200'
                : 'text-slate-500 hover:bg-slate-800'
            }`}
          >
            <X className="w-3 h-3 mr-2 shrink-0 opacity-50" />
            — Unassigned —
          </li>

          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-600 italic">No matches</li>
          ) : (
            filtered.map((am, i) => {
              const isCurrent  = am.id === value;
              const isCursored = cursor === i + 1;
              return (
                <li
                  key={am.id}
                  onMouseDown={() => select(am)}
                  onMouseEnter={() => setCursor(i + 1)}
                  className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                    isCursored
                      ? 'bg-indigo-600/20'
                      : isCurrent
                        ? 'bg-indigo-500/10'
                        : 'hover:bg-slate-800'
                  }`}
                >
                  {/* Initials avatar */}
                  <div className="w-5 h-5 rounded-full bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-[9px] font-bold text-indigo-400 shrink-0 mt-0.5">
                    {am.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <p className={`text-xs font-semibold truncate ${isCursored || isCurrent ? 'text-slate-100' : 'text-slate-300'}`}>
                      {am.name}
                      {isCurrent && (
                        <span className="ml-1.5 text-[9px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1 py-0.5 rounded">
                          current
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono truncate">{am.email}</p>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};
