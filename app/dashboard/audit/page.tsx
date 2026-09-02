'use client';

/**
 * The audit trail.
 *
 * This is the screen a regulator asks for, so every figure on it has to be
 * derived from the trail itself rather than decorated onto it. The counters at
 * the top are computed from the loaded events; the origin column shows what
 * the middleware actually recorded and a dash where nothing was — background
 * workers and startup recovery raise events with no request behind them, and
 * entries written before the field existed have none either.
 *
 * Nothing here is invented to fill a column. In an audit trail that would not
 * be a cosmetic liberty, it would be the defect the whole screen exists to
 * make impossible.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Download, ScrollText, ChevronRight, ChevronLeft, Search, Calendar, Filter,
  ShieldCheck, Users as UsersIcon, Layers, FlaskConical, Box, User as UserIcon,
  Server, MoreHorizontal, Copy, Check, SlidersHorizontal,
} from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn, initials } from '@/lib/utils';

interface AuditEvent {
  id: string;
  timestamp: string;
  user_id: string | null;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string;
  trial_id: string | null;
  details: string;
  ip?: string;
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Signed In',
  logout: 'Signed Out',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  deactivate: 'Deactivated',
  analyze: 'Analysed',
  train_start: 'Training Started',
  train_cancel: 'Training Cancelled',
  sign_confirm: 'E-Signed — Confirmed',
  sign_correct: 'E-Signed — Corrected',
  raise_query: 'Raised Query',
  respond_query: 'Responded to Query',
  close_query: 'Closed Query',
  reopen_query: 'Reopened Query',
  gdpr_export: 'Subject Export',
  gdpr_redact: 'Redacted',
  gdpr_erase: 'Erased',
};

/** Colour carries the kind of change, so the column can be read down the page.
 *  Destruction is red, creation green, everything else stays quiet. */
function actionTone(action: string): { bg: string; fg: string } {
  if (/delete|deactivate|erase|cancel/.test(action)) return { bg: 'rgba(255,59,48,0.12)', fg: '#FF3B30' };
  if (/create|register|start/.test(action)) return { bg: 'rgba(52,199,89,0.14)', fg: '#248A3D' };
  if (/update|correct|redact/.test(action)) return { bg: 'rgba(175,82,222,0.14)', fg: '#8944AB' };
  if (/analyz|analys/.test(action)) return { bg: 'var(--accent-soft)', fg: 'var(--accent)' };
  if (/sign|confirm/.test(action)) return { bg: 'rgba(48,176,199,0.14)', fg: '#2A8B9D' };
  if (/quer/.test(action)) return { bg: 'rgba(255,149,0,0.14)', fg: '#B26A00' };
  return { bg: 'rgba(142,142,147,0.14)', fg: 'var(--text-secondary)' };
}

const TARGET_ICONS: Record<string, React.ElementType> = {
  patient: UsersIcon, slide: Layers, trial: FlaskConical, model: Box,
  training: Box, user: UserIcon, query: ScrollText, system: Server, batch: Layers,
};

type Range = 'all' | 'today' | '7d' | '30d';
const RANGE_LABELS: Record<Range, string> = {
  all: 'All time', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days',
};
const PAGE_SIZE = 25;

export default function AuditPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [range, setRange] = useState<Range>('all');
  const [page, setPage] = useState(0);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/audit/');
        if (res.status === 403) { router.push('/dashboard'); return; }
        setEvents(await res.json());
      } catch {
        setEvents([]);
      } finally {
        setLoading(false);
      }
      // The trail records who acted but not what they were — role lives on the
      // user record. Looked up separately so the row can show it; a user since
      // deleted simply has no role line rather than a guessed one.
      try {
        const users = await apiSend('/api/users/');
        if (Array.isArray(users)) {
          setRoles(Object.fromEntries(users.map((u: { username: string; role: string }) => [u.username, u.role])));
        }
      } catch { /* the trail is still readable without roles */ }
    })();
  }, [router]);

  const exportCsv = async () => {
    try {
      const res = await apiFetch('/api/audit/export-csv');
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'audit_trail.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      toast.show('Audit trail exported');
    } catch {
      toast.show('Could not export the audit trail.', 'error');
    }
  };

  const since = useMemo(() => {
    if (range === 'all') return null;
    const d = new Date();
    if (range === 'today') { d.setHours(0, 0, 0, 0); return d; }
    d.setDate(d.getDate() - (range === '7d' ? 7 : 30));
    return d;
  }, [range]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(e => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (since && new Date(e.timestamp) < since) return false;
      if (q && ![e.username, e.action, ACTION_LABELS[e.action] ?? '', e.entity_type,
                 e.entity_id, e.details, e.ip ?? '']
              .join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, actionFilter, since, search]);

  useEffect(() => { setPage(0); }, [search, actionFilter, range]);

  // Counters, all derived from the trail rather than decorated onto it.
  const stats = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    let today = 0, yesterday = 0;
    for (const e of events) {
      const t = new Date(e.timestamp);
      if (t >= startOfToday) today++;
      else if (t >= startOfYesterday) yesterday++;
    }
    // No baseline means no percentage. "+100%" against a day with no activity
    // would be arithmetic dressed up as a trend.
    const delta = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : null;
    return {
      total: events.length,
      today,
      delta,
      users: new Set(events.map(e => e.username).filter(Boolean)).size,
    };
  }, [events]);

  const actions = useMemo(
    () => [...new Set(events.map(e => e.action))].sort(),
    [events],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const from = page * PAGE_SIZE;
  const shown = filtered.slice(from, from + PAGE_SIZE);

  return (
    <div className="max-w-[1200px] px-7 pt-6 pb-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] mb-4">
        <button onClick={() => router.push('/dashboard')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          Dashboard
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="font-medium text-[var(--accent)]" aria-current="page">Audit Trail</span>
      </nav>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.6px] leading-tight">Audit Trail</h1>
          <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
            Every action, with who took it and where from — an immutable record under 21 CFR Part 11.
          </p>
        </div>
        <Button variant="secondary" size="md" className="shrink-0" onClick={exportCsv}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <AuditStat icon={ScrollText} tone="var(--accent)" label="Total activities"
                   value={loading ? '—' : stats.total.toLocaleString()} sub="Loaded from the trail" />
        <AuditStat icon={ShieldCheck} tone="#34C759" label="Today"
                   value={loading ? '—' : String(stats.today)}
                   sub={stats.delta === null
                     ? 'No activity yesterday to compare'
                     : `${stats.delta >= 0 ? '+' : ''}${stats.delta}% vs yesterday`}
                   subTone={stats.delta === null ? undefined : stats.delta >= 0 ? '#248A3D' : '#FF3B30'} />
        <AuditStat icon={UserIcon} tone="#5856D6" label="Users"
                   value={loading ? '—' : String(stats.users)} sub="Appearing in the trail" />
        <AuditStat icon={Calendar} tone="#FF9500" label="Date range"
                   value={RANGE_LABELS[range]}
                   sub={range === 'all' ? 'No filter applied' : `${filtered.length} in range`} />
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by user, action, target, or details…"
            className="w-full pl-11 pr-4 py-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>

        <SelectControl icon={Calendar} value={range} onChange={v => setRange(v as Range)}
                       options={(Object.keys(RANGE_LABELS) as Range[]).map(r => [r, RANGE_LABELS[r]])} />
        <SelectControl icon={Filter} value={actionFilter} onChange={setActionFilter}
                       options={[['', 'All actions'], ...actions.map(a => [a, ACTION_LABELS[a] ?? a] as [string, string])]} />
      </div>

      {loading ? (
        <TableSkeleton />
      ) : events.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nothing recorded yet"
                    subtitle="Actions taken in the application will appear here." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matching activity"
                    subtitle="Try a different search term, range, or action." />
      ) : (
        <Card size="md" className="overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <Th className="pl-5">Time</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>Details</Th>
                  <Th>Origin</Th>
                  <Th className="text-right pr-5">{''}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map(e => <AuditRow key={e.id} event={e} role={roles[e.username]} />)}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-[var(--border-subtle)]">
            <p className="text-[12px] text-[var(--text-secondary)]">
              Showing {filtered.length === 0 ? 0 : from + 1} to {from + shown.length} of{' '}
              {filtered.length.toLocaleString()} activit{filtered.length === 1 ? 'y' : 'ies'}
            </p>
            {pageCount > 1 && (
              <Pagination page={page} pageCount={pageCount} onPage={setPage} />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[var(--text-secondary)]', className)}>
      {children}
    </th>
  );
}

function AuditStat({ icon: Icon, tone, label, value, sub, subTone }: {
  icon: React.ElementType; tone: string; label: string;
  value: string; sub: string; subTone?: string;
}) {
  return (
    <Card size="md" className="p-4 flex items-center gap-3.5">
      <span className="w-11 h-11 rounded-[14px] grid place-items-center shrink-0"
            style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon className="w-[18px] h-[18px]" style={{ color: tone }} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-[var(--text-secondary)] truncate">{label}</span>
        <span className="block text-[22px] font-semibold tabular-nums leading-tight truncate">{value}</span>
        <span className="block text-[11px] truncate"
              style={{ color: subTone ?? 'var(--text-secondary)' }}>{sub}</span>
      </span>
    </Card>
  );
}

function SelectControl({ icon: Icon, value, onChange, options }: {
  icon: React.ElementType; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  const label = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1] ?? '';
  return (
    <label className="relative inline-flex items-center gap-2 px-4 py-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] font-medium cursor-pointer transition-colors hover:border-[var(--border-medium)]">
      <Icon className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
      <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** Page numbers with an ellipsis, so a long trail does not render 26 buttons. */
function Pagination({ page, pageCount, onPage }: {
  page: number; pageCount: number; onPage: (p: number) => void;
}) {
  const nums: (number | '…')[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="flex items-center gap-1.5">
      <PageBtn onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        <ChevronLeft className="w-4 h-4" />
      </PageBtn>
      {nums.map((n, i) =>
        n === '…' ? (
          <span key={`gap${i}`} className="px-1 text-[12px] text-[var(--text-secondary)]">…</span>
        ) : (
          <button
            key={n}
            onClick={() => onPage(n)}
            aria-current={n === page ? 'page' : undefined}
            className={cn(
              'min-w-8 h-8 px-2 rounded-[10px] text-[12px] tabular-nums font-medium transition-colors border',
              n === page
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]',
            )}
          >
            {n + 1}
          </button>
        ),
      )}
      <PageBtn onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1} aria-label="Next page">
        <ChevronRight className="w-4 h-4" />
      </PageBtn>
    </div>
  );
}

function PageBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function AuditRow({ event: e, role }: { event: AuditEvent; role?: string }) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const tone = actionTone(e.action);
  const TargetIcon = TARGET_ICONS[e.entity_type] ?? Server;
  const when = e.timestamp ? new Date(e.timestamp) : null;

  useEffect(() => {
    if (!menu) return;
    const onDown = (ev: MouseEvent) => {
      if (cellRef.current && !cellRef.current.contains(ev.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const copyEntry = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(e, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked */ }
  };

  return (
    <tr className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--cc-tile-hover)] transition-colors">
      <td className="pl-5 pr-4 py-3 whitespace-nowrap">
        <span className="block text-[12.5px] font-medium">
          {when ? when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
        </span>
        <span className="block text-[11px] text-[var(--text-secondary)] tabular-nums">
          {when ? when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[11.5px] font-bold grid place-items-center shrink-0">
            {initials(e.username)}
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium truncate">{e.username || 'system'}</span>
            {role && <span className="block text-[11px] text-[var(--text-secondary)] capitalize">{role}</span>}
          </span>
        </div>
      </td>

      <td className="px-4 py-3">
        <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
              style={{ background: tone.bg, color: tone.fg }}>
          {ACTION_LABELS[e.action] ?? e.action}
        </span>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[10px] bg-[var(--skeleton-bg)] grid place-items-center shrink-0">
            <TargetIcon className="w-4 h-4 text-[var(--text-secondary)]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium capitalize truncate">{e.entity_type || '—'}</span>
            {e.entity_id && (
              <span className="block text-[11px] text-[var(--text-secondary)] tabular-nums truncate">{e.entity_id}</span>
            )}
          </span>
        </div>
      </td>

      <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)] max-w-[180px]">
        <span className="block truncate" title={e.details}>{e.details || '—'}</span>
      </td>

      {/* Blank for anything not raised over HTTP — the background workers,
          startup recovery — and for entries written before the field existed.
          A dash, never a plausible-looking address. */}
      <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
        {e.ip || '—'}
      </td>

      <td className="pr-5 pl-4 py-3 text-right relative" ref={cellRef}>
        <button
          onClick={() => setMenu(v => !v)}
          aria-label="Entry actions"
          aria-expanded={menu}
          className="inline-grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menu && (
          <div className="cc-panel absolute right-5 top-[calc(100%-4px)] w-[188px] z-40 p-1.5 rounded-[14px] animate-menu-in origin-top-right text-left">
            <button onClick={copyEntry}
                    className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
              {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" />
                      : <Copy className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
              {copied ? 'Copied' : 'Copy entry'}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
