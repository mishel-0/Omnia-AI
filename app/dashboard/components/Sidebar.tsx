'use client';

/**
 * The navigation rail.
 *
 * Replaces the top bar. A horizontal bar has a fixed budget — six sections and
 * an account menu was already crowding it, and every section added after that
 * would have had to overflow or hide. A rail grows downward instead, which is
 * why almost every clinical application that outlives its first year ends up
 * with one.
 *
 * It also lets sections be *grouped*. "Patients" and "Audit Trail" are things
 * you do to trial data; "Users" and "Settings" are things you do to the
 * installation. Flat, those six items are a list to read; grouped under two
 * headings they are two short lists, and the eye finds the right one without
 * reading either in full.
 *
 * The travelling indicator from the top bar survives, turned on its side: one
 * element that moves between items rather than a highlight that blinks out
 * here and in over there.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users as UsersIcon, ScrollText, GraduationCap, Settings as SettingsIcon,
  ChevronRight, LifeBuoy, Sun, Moon, ChevronsUpDown,
} from 'lucide-react';
import { BrandMark } from '@/components/ui';
import { useAuth, canWrite } from '@/lib/auth';
import { useOnboarding } from '@/lib/onboarding';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface Item {
  label: string;
  href: string;
  icon: React.ElementType;
  show: (role?: string, writable?: boolean) => boolean;
}

// Deliberately not a copy of the reference layout's item list. That mockup
// carries a "Trials" entry, and there is no trials route — trials are the
// dashboard's own content. A nav item that goes nowhere, or lands on a page
// the user is already looking at, is worse than one fewer item.
const PRIMARY: Item[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, show: () => true },
];

const CLINICAL: Item[] = [
  { label: 'Patients', href: '/dashboard/patients', icon: UsersIcon, show: () => true },
  { label: 'Audit Trail', href: '/dashboard/audit', icon: ScrollText,
    show: (r) => r === 'admin' || r === 'monitor' },
];

const SYSTEM: Item[] = [
  { label: 'Users', href: '/dashboard/users', icon: UsersIcon, show: (r) => r === 'admin' },
  { label: 'Models', href: '/dashboard/training', icon: GraduationCap, show: (_r, w) => !!w },
  { label: 'Settings', href: '/dashboard/settings', icon: SettingsIcon, show: () => true },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname() || '';
  const { user } = useAuth();
  const writable = canWrite(user?.role);
  const { open: openGuide } = useOnboarding();

  const visible = (items: Item[]) => items.filter((i) => i.show(user?.role, writable));
  const all = [...PRIMARY, ...CLINICAL, ...SYSTEM];

  // Longest matching href wins — every route starts with /dashboard, so a
  // plain prefix test would light up Dashboard on every page.
  const current = all
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const railRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ y: number; h: number } | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const el = rail.querySelector<HTMLElement>('[data-active="true"]');
    // No match means a route with no item of its own — a patient detail page.
    // Fading out is honest; parking the indicator on an unrelated item would
    // claim you are somewhere you are not.
    if (!el) { setInd(null); return; }
    setInd({ y: el.offsetTop - rail.scrollTop, h: el.offsetHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
    const rail = railRef.current;
    if (!rail) return;
    const ro = new ResizeObserver(measure);
    ro.observe(rail);
    rail.querySelectorAll('button').forEach((b) => ro.observe(b));
    rail.addEventListener('scroll', measure, { passive: true });
    document.fonts?.ready.then(measure).catch(() => { /* no font API */ });
    return () => { ro.disconnect(); rail.removeEventListener('scroll', measure); };
  }, [measure, pathname, user?.role, writable]);

  // A timer rather than requestAnimationFrame: rAF does not fire while the
  // window is hidden or occluded, so an app launched behind another window
  // would keep its transition suppressed and the indicator would snap.
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  const Group = ({ title, items }: { title: string; items: Item[] }) => {
    const shown = visible(items);
    if (shown.length === 0) return null;
    return (
      <div className="mt-6">
        <p className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.7px] text-[var(--text-secondary)]">
          {title}
        </p>
        {shown.map((i) => (
          <NavItem key={i.href} item={i} active={current?.href === i.href}
                   onClick={() => router.push(i.href)} />
        ))}
      </div>
    );
  };

  return (
    <aside className="titlebar-drag w-[264px] shrink-0 h-screen sticky top-0 flex flex-col bg-[var(--sidebar-bg)] border-r border-[var(--border-subtle)]">
      <div className="titlebar-inset flex items-center gap-2 px-3.5 pb-4 border-b border-[var(--border-subtle)]">
        <BrandMark size={32} />
        <div className="min-w-0">
          {/* Measured, not guessed: at 13.5px with a 34px mark the product name
              needed 128px in a 119px column and lost its last two letters. */}
          <h1 className="text-[13px] font-semibold leading-tight truncate">Omnia Pathology AI</h1>
          <p className="text-[10.5px] text-[var(--text-secondary)] leading-tight">Research Use Only</p>
        </div>
      </div>

      <div ref={railRef} className="titlebar-no-drag relative flex-1 overflow-y-auto no-scrollbar px-3 pt-4 pb-3">
        <span
          aria-hidden
          className="nav-indicator-v"
          style={{
            transform: `translateY(${ind?.y ?? 0}px)`,
            height: ind?.h ?? 0,
            opacity: ind ? 1 : 0,
            transition: ready ? undefined : 'none',
          }}
        />
        {visible(PRIMARY).map((i) => (
          <NavItem key={i.href} item={i} active={current?.href === i.href}
                   onClick={() => router.push(i.href)} />
        ))}
        <Group title="Clinical" items={CLINICAL} />
        <Group title="System" items={SYSTEM} />
      </div>

      <div className="titlebar-no-drag px-3 pb-3 space-y-2">
        <button
          onClick={openGuide}
          className="w-full flex items-center gap-2.5 rounded-[12px] border border-[var(--border-subtle)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--cc-tile-hover)]"
        >
          <span className="w-7 h-7 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] grid place-items-center shrink-0">
            <LifeBuoy className="w-3.5 h-3.5" />
          </span>
          <span className="leading-tight min-w-0">
            <span className="block text-[12px] font-semibold">Need help?</span>
            <span className="block text-[10.5px] text-[var(--text-secondary)]">Guide and support</span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)] ml-auto shrink-0" />
        </button>

        <ThemeSelect />
      </div>
    </aside>
  );
}

function NavItem({ item, active, onClick }: { item: Item; active?: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : 'false'}
      className={cn(
        // relative + z-10 keeps the label above the indicator sliding beneath
        // it; the active item paints no background of its own.
        'relative z-10 w-full flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-[13px] font-medium',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        active
          ? 'text-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--cc-tile-hover)]',
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      <ChevronRight className={cn('w-3.5 h-3.5 ml-auto shrink-0 transition-opacity',
                                  active ? 'opacity-60' : 'opacity-0')} />
    </button>
  );
}

/** Light / dark, as a stepper at the foot of the rail.
 *
 * A real <select> rather than a styled div: it is a choice between two named
 * options, and the platform's own control is keyboard-navigable and
 * screen-reader-correct for free.
 */
function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : Sun;
  return (
    <label className="relative flex items-center gap-2.5 rounded-[12px] border border-[var(--border-subtle)] px-3 py-2.5 cursor-pointer transition-colors hover:bg-[var(--cc-tile-hover)]">
      <Icon className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
      <span className="text-[12.5px] font-medium capitalize">{theme}</span>
      <ChevronsUpDown className="w-3.5 h-3.5 text-[var(--text-secondary)] ml-auto shrink-0" />
      <select
        aria-label="Appearance"
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
