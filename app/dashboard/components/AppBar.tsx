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

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

  // Where the travelling indicator should sit. Measured from the DOM rather
  // than computed from label lengths, because the only thing that knows how
  // wide "Audit Trail" renders is the browser that just laid it out.
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const el = nav.querySelector<HTMLElement>('[data-active="true"]');
    // No match means a route with no section of its own — a patient detail
    // page, say. Fading the indicator out is honest; parking it under an
    // unrelated tab would claim you are somewhere you are not.
    if (!el) { setInd(null); return; }
    setInd({ x: el.offsetLeft - nav.scrollLeft, w: el.offsetWidth });
  }, []);

  // Layout effect, not effect: this runs before paint, so the indicator is
  // already in the right place on the first frame after a navigation.
  useLayoutEffect(() => {
    measure();
    const nav = navRef.current;
    if (!nav) return;
    // Re-measure on anything that can move a pill: the window resizing, the
    // nav scrolling when it overflows, or a webfont landing late and changing
    // every label's width after we already measured.
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    nav.querySelectorAll('button').forEach((b) => ro.observe(b));
    nav.addEventListener('scroll', measure, { passive: true });
    document.fonts?.ready.then(measure).catch(() => { /* no font API */ });
    return () => { ro.disconnect(); nav.removeEventListener('scroll', measure); };
  }, [measure, pathname, visible.length]);

  // Deliberately a timer rather than requestAnimationFrame. rAF does not fire
  // while the window is hidden or fully occluded, so an app launched behind
  // another window would sit with its transition disabled forever and the
  // indicator would snap between sections instead of travelling. A timer still
  // runs when the window is not being painted.
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <header className="titlebar-drag titlebar-inset sticky top-0 z-40 glass-chrome border-b border-[var(--border-subtle)] pr-6 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 shrink-0">
        <BrandMark size={30} />
        <div className="hidden xl:block">
          <h1 className="text-[14px] font-semibold leading-tight">Omnia Pathology AI</h1>
          <p className="text-[10px] text-[var(--text-secondary)] leading-tight">Research Use Only</p>
        </div>
      </div>

      <nav
        ref={navRef}
        className="nav-rail titlebar-no-drag flex items-center gap-0.5 min-w-0 overflow-x-auto no-scrollbar"
      >
        {/* One element that travels between sections, drawn behind the labels.
            Hidden from assistive tech: `aria-current` on the button already
            says which section is active, and a decorative box repeating it
            would be read out as noise. */}
        <span
          aria-hidden
          className="nav-indicator"
          style={{
            transform: `translateX(${ind?.x ?? 0}px)`,
            width: ind?.w ?? 0,
            opacity: ind ? 1 : 0,
            // Suppressed for the very first paint, otherwise the indicator
            // visibly flies in from the left edge on every cold load.
            transition: ready ? undefined : 'none',
          }}
        />
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
        <ThemeSwitch theme={theme} onToggle={toggleTheme} />
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
      data-active={active ? 'true' : 'false'}
      className={cn(
        // relative + z-10 keeps the label above the indicator that slides
        // beneath it; the active pill draws no background of its own, because
        // the indicator is the background.
        'relative z-10 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium whitespace-nowrap',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        active
          ? 'text-[var(--accent-contrast)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--skeleton-bg)]',
      )}
    >
      {label}
    </button>
  );
}

/** Light/dark, one click, always visible.
 *
 * This was reachable only by opening the account menu and finding an
 * "Appearance" row — three interactions to do something people do twice a day
 * as the light in the room changes. */
function ThemeSwitch({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="grid place-items-center w-8 h-8 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--skeleton-bg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {/* Both icons stay mounted in the same grid cell and rotate past each
          other, so the change is one movement rather than a swap. */}
      <Sun className="theme-icon w-4 h-4" data-on={dark ? 'true' : 'false'} />
      <Moon className="theme-icon w-4 h-4" data-on={dark ? 'false' : 'true'} />
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
