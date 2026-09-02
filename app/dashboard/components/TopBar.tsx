'use client';

/**
 * The header above the page content: search, appearance, notifications, account.
 *
 * What used to be one crowded bar is now split by kind. Navigation — where you
 * can go — lives in the rail. This holds the things that act on wherever you
 * already are. Keeping them apart is why the rail can grow without this
 * getting worse.
 *
 * The account menu is the Control Centre panel: grouped translucent modules
 * rather than a list of identical rows, because the grouping is the
 * information.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Bell, ChevronDown, LogOut, ShieldCheck, ScrollText, Users as UsersIcon,
  BookOpen, GraduationCap, Sun, Moon, Settings,
} from 'lucide-react';
import { useAuth, canWrite, ROLE_LABELS } from '@/lib/auth';
import { useOnboarding } from '@/lib/onboarding';
import { useTheme } from '@/lib/theme';
import { cn, initials } from '@/lib/utils';

export default function TopBar({ actions }: { actions?: React.ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const writable = canWrite(user?.role);
  const { open: openGuide } = useOnboarding();
  const { theme, setTheme, toggle: toggleTheme } = useTheme();
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

        <button
          onClick={toggleTheme}
          role="switch"
          aria-checked={theme === 'dark'}
          aria-label="Dark mode"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="grid place-items-center w-9 h-9 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--cc-tile-hover)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Sun className="theme-icon w-4 h-4" data-on={theme === 'dark' ? 'true' : 'false'} />
          <Moon className="theme-icon w-4 h-4" data-on={theme === 'dark' ? 'false' : 'true'} />
        </button>

        {/* Notifications are not built yet, so this does not pretend to be a
            feature: no unread dot, and it opens the guide rather than an empty
            panel. A badge that is always lit teaches people to ignore badges. */}
        <button
          onClick={openGuide}
          aria-label="Help"
          className="grid place-items-center w-9 h-9 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--cc-tile-hover)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Bell className="w-4 h-4" />
        </button>

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
              className="cc-panel absolute right-0 top-[calc(100%+10px)] w-[288px] z-50 p-2.5 rounded-[20px] animate-menu-in origin-top-right"
            >
              <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-2.5">
                <span className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[13px] font-bold flex items-center justify-center">
                  {initials(user?.full_name)}
                </span>
                <span className="leading-tight min-w-0">
                  <span className="block text-[13px] font-semibold truncate">{user?.full_name}</span>
                  <span className="block text-[11px] text-[var(--text-secondary)]">
                    {ROLE_LABELS[user?.role as keyof typeof ROLE_LABELS] ?? user?.role}
                  </span>
                </span>
              </div>

              <div className="cc-module p-2.5 mb-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[var(--text-secondary)] mb-2">
                  Appearance
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <CCTile icon={Sun}  label="Light" on={theme === 'light'} onClick={() => setTheme('light')} />
                  <CCTile icon={Moon} label="Dark"  on={theme === 'dark'}  onClick={() => setTheme('dark')} />
                </div>
              </div>

              <div className="cc-module p-1.5 mb-2">
                <CCRow icon={Settings} label="Settings" onClick={() => { setMenu(false); router.push('/dashboard/settings'); }} />
                {(user?.role === 'admin' || user?.role === 'monitor') && (
                  <CCRow icon={ScrollText} label="Audit Trail" onClick={() => { setMenu(false); router.push('/dashboard/audit'); }} />
                )}
                {user?.role === 'admin' && (
                  <CCRow icon={UsersIcon} label="Manage Users" onClick={() => { setMenu(false); router.push('/dashboard/users'); }} />
                )}
                {writable && (
                  <CCRow icon={GraduationCap} label="Model Training" onClick={() => { setMenu(false); router.push('/dashboard/training'); }} />
                )}
                <CCRow icon={BookOpen} label="Guide & Help" onClick={() => { setMenu(false); openGuide(); }} />
                <CCRow icon={ShieldCheck} label="System Health" onClick={() => { setMenu(false); router.push('/admin'); }} />
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

function CCTile({ icon: Icon, label, on, onClick }: {
  icon: React.ElementType; label: string; on?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
      className={cn(
        'cc-tile flex flex-col items-start gap-1.5 px-2.5 py-2 text-[11.5px] font-medium',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        !on && 'text-[var(--text-secondary)]',
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
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
