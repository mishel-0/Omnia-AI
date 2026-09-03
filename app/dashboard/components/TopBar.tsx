'use client';

/**
 * The header above the page content: search, and who is signed in.
 *
 * It used to carry a second copy of the navigation. The account menu listed
 * Settings, Audit Trail, Manage Users and Model Training — every one of which
 * is a row in the rail two hundred pixels to the left — plus a light/dark
 * control that was the third one in the interface, after the rail's own and a
 * sun icon sitting right beside it. Three ways to do one thing is not
 * three times the convenience; it is three places to look and two of them
 * wrong.
 *
 * What is left is what has nowhere else to live: who you are signed in as,
 * when that sign-in happened, the system health page (which is outside this
 * segment and so cannot go in the rail), and signing out. The bell went with
 * them — notifications are not built, and a bell that opens something else is
 * a promise the application does not keep.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ChevronDown, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth, ROLE_LABELS } from '@/lib/auth';
import { cn, initials, relativeTime } from '@/lib/utils';

export default function TopBar({ actions }: { actions?: React.ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // ⌘K focuses search. Standard enough on desktop that its absence is the
  // thing people notice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="titlebar-drag sticky top-0 z-40 glass-chrome border-b border-[var(--border-subtle)] px-6 py-3 flex items-center gap-4">
      <div className="titlebar-no-drag relative flex-1 max-w-[420px]">
        <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={searchRef}
          placeholder="Search patients, trials, slides…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              router.push(`/dashboard/patients?q=${encodeURIComponent(e.currentTarget.value.trim())}`);
            }
          }}
          className="w-full pl-9 pr-14 py-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[12.5px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-[var(--text-secondary)] pointer-events-none">
          ⌘K
        </kbd>
      </div>

      <div className="titlebar-no-drag flex items-center gap-1.5 ml-auto">
        {actions}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            aria-haspopup="menu"
            className="flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-full hover:bg-[var(--cc-tile-hover)] transition-colors"
          >
            <span className="w-7 h-7 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[11.5px] font-bold flex items-center justify-center">
              {initials(user?.full_name)}
            </span>
            <span className="hidden md:block text-left leading-tight">
              <span className="block text-[12.5px] font-semibold">{user?.full_name}</span>
              <span className="block text-[10.5px] text-[var(--text-secondary)]">
                {ROLE_LABELS[user?.role as keyof typeof ROLE_LABELS] ?? user?.role}
              </span>
            </span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform duration-200', menu && 'rotate-180')} />
          </button>

          {menu && (
            <div
              role="menu"
              className="cc-panel absolute right-0 top-[calc(100%+10px)] w-[264px] z-50 p-2.5 rounded-[20px] animate-menu-in origin-top-right"
            >
              <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-2.5">
                <span className="w-9 h-9 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[13px] font-bold flex items-center justify-center">
                  {initials(user?.full_name)}
                </span>
                <span className="leading-tight min-w-0">
                  <span className="block text-[13px] font-semibold truncate">{user?.full_name}</span>
                  <span className="block text-[11px] text-[var(--text-secondary)]">
                    {ROLE_LABELS[user?.role as keyof typeof ROLE_LABELS] ?? user?.role}
                  </span>
                </span>
              </div>

              {/* Real, and worth surfacing here: every action taken in this
                  session is attributed to this account in the audit trail, so
                  seeing which account it is — and when it signed in — is the
                  thing this menu is actually for. */}
              <div className="cc-module px-2.5 py-2 mb-2 space-y-1">
                <Row label="Signed in as" value={user?.username ?? '—'} />
                <Row label="Session began" value={relativeTime(user?.last_login, 'This session')} />
              </div>

              <div className="cc-module p-1.5 mb-2">
                <CCRow icon={ShieldCheck} label="System Health"
                       onClick={() => { setMenu(false); router.push('/admin'); }} />
              </div>

              <button
                onClick={async () => { setMenu(false); await logout(); router.push('/login'); }}
                className="cc-tile w-full flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-[#FF3B30] hover:bg-[#FF3B30]/10"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function CCRow({ icon: Icon, label, onClick }: {
  icon: React.ElementType; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
      {label}
    </button>
  );
}

/** A label/value line inside a Control Centre module. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11.5px] text-[var(--text-secondary)]">{label}</span>
      <span className="text-[11.5px] font-medium truncate">{value}</span>
    </div>
  );
}
