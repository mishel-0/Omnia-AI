'use client';

/**
 * The window chrome: brand, section nav, and the account menu.
 *
 * This lived inside the dashboard page, so it existed on exactly one screen.
 * Open Patients, the audit trail, Users or Model and the navigation vanished —
 * there was no way back to another section without the browser's own history,
 * which a packaged desktop app does not show. Every dashboard route now mounts
 * the same bar and the current section is derived from the URL rather than
 * passed in, so it cannot disagree with the page you are actually on.
 */

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronDown, LogOut, ShieldCheck, ScrollText, Users as UsersIcon,
  BookOpen, GraduationCap, Sun, Moon, Settings,
} from 'lucide-react';
import { Card, BrandMark } from '@/components/ui';
import { useAuth, canWrite, ROLE_LABELS } from '@/lib/auth';
import { useOnboarding } from '@/lib/onboarding';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface Section {
  label: string;
  href: string;
  show: (role?: string, writable?: boolean) => boolean;
}

const SECTIONS: Section[] = [
  { label: 'Dashboard', href: '/dashboard', show: () => true },
  { label: 'Patients', href: '/dashboard/patients', show: () => true },
  { label: 'Audit Trail', href: '/dashboard/audit', show: (r) => r === 'admin' || r === 'monitor' },
  { label: 'Users', href: '/dashboard/users', show: (r) => r === 'admin' },
  { label: 'Model', href: '/dashboard/training', show: (_r, w) => !!w },
  { label: 'Settings', href: '/dashboard/settings', show: () => true },
];

export default function AppBar({ actions }: { actions?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '';
  const { user, logout } = useAuth();
  const writable = canWrite(user?.role);
  const { open: openGuide } = useOnboarding();
  const { theme, toggle: toggleTheme } = useTheme();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. A dropdown that can only be closed
  // by clicking its own trigger is a trap on a desktop app, where there is no
  // browser chrome to click away into.
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

  // Longest matching href wins, so /dashboard/patients highlights Patients
  // rather than Dashboard — every route starts with /dashboard.
  const current = SECTIONS
    .filter((s) => pathname === s.href || pathname.startsWith(s.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const visible = SECTIONS.filter((s) => s.show(user?.role, writable));

  return (
    <header className="titlebar-drag titlebar-inset sticky top-0 z-40 glass-chrome border-b border-[var(--border-subtle)] pr-6 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 shrink-0">
        <BrandMark size={30} />
        <div className="hidden xl:block">
          <h1 className="text-[14px] font-semibold leading-tight">Omnia Pathology AI</h1>
          <p className="text-[10px] text-[var(--text-secondary)] leading-tight">Research Use Only</p>
        </div>
      </div>

      <nav className="titlebar-no-drag flex items-center gap-0.5 min-w-0 overflow-x-auto no-scrollbar">
        {visible.map((s) => (
          <NavPill
            key={s.href}
            label={s.label}
            active={current?.href === s.href}
            onClick={() => router.push(s.href)}
          />
        ))}
      </nav>

      <div className="titlebar-no-drag flex items-center gap-2 shrink-0">
        {actions}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            aria-haspopup="menu"
            className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-full hover:bg-[var(--skeleton-bg)] transition-colors"
          >
            <span className="w-6 h-6 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[11px] font-bold flex items-center justify-center">
              {(user?.full_name || '?').trim().charAt(0).toUpperCase()}
            </span>
            <span className="hidden md:block text-left leading-tight">
              <span className="block text-[12px] font-medium">{user?.full_name}</span>
              <span className="block text-[10px] text-[var(--text-secondary)]">
                {ROLE_LABELS[user?.role as keyof typeof ROLE_LABELS] ?? user?.role}
              </span>
            </span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform duration-200', menu && 'rotate-180')} />
          </button>

          {menu && (
            <Card size="sm" className="absolute right-0 top-[calc(100%+8px)] w-[212px] z-50 p-1.5 shadow-xl animate-menu-in origin-top-right">
              <MenuItem icon={Settings} label="Settings" onClick={() => { setMenu(false); router.push('/dashboard/settings'); }} />
              {(user?.role === 'admin' || user?.role === 'monitor') && (
                <MenuItem icon={ScrollText} label="Audit Trail" onClick={() => { setMenu(false); router.push('/dashboard/audit'); }} />
              )}
              {user?.role === 'admin' && (
                <MenuItem icon={UsersIcon} label="Manage Users" onClick={() => { setMenu(false); router.push('/dashboard/users'); }} />
              )}
              {writable && (
                <MenuItem icon={GraduationCap} label="Model Training" onClick={() => { setMenu(false); router.push('/dashboard/training'); }} />
              )}
              <MenuItem icon={BookOpen} label="Guide & Help" onClick={() => { setMenu(false); openGuide(); }} />
              <MenuItem icon={ShieldCheck} label="System Health" onClick={() => { setMenu(false); router.push('/admin'); }} />
              {/* Stays open: appearance is judged by looking at the result. */}
              <MenuItem
                icon={theme === 'dark' ? Sun : Moon}
                label="Appearance"
                trailing={<span className="text-[11px] text-[var(--text-secondary)] capitalize">{theme}</span>}
                onClick={toggleTheme}
              />
              <div className="h-px bg-[var(--border-subtle)] my-1" />
              <MenuItem
                icon={LogOut}
                label="Sign Out"
                danger
                onClick={async () => { setMenu(false); await logout(); router.push('/login'); }}
              />
            </Card>
          )}
        </div>
      </div>
    </header>
  );
}

function NavPill({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'px-3.5 py-1.5 rounded-full text-[12.5px] font-medium whitespace-nowrap',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        active
          ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--skeleton-bg)]',
      )}
    >
      {label}
    </button>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger, trailing }: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[8px] text-[12px] text-left transition-colors',
        danger
          ? 'hover:bg-[#FF3B30]/10 text-[#FF3B30]'
          : 'hover:bg-[var(--skeleton-bg)]',
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className={cn('w-3.5 h-3.5', !danger && 'text-[var(--text-secondary)]')} />
        {label}
      </span>
      {trailing}
    </button>
  );
}
