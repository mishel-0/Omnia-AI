'use client';

/**
 * The trial register.
 *
 * Trials were only ever listed on the dashboard, mixed in with the greeting and
 * the review counters — fine while there were three, unusable once there are
 * thirty. This is the list on its own, with the columns a coordinator sorts and
 * filters by.
 *
 * Two columns exist here that the data model had no answer for until now. A
 * trial had one date, so an end date could only have been invented; closing a
 * trial now stamps it, and a running trial shows a dash because it has not
 * reached one. And status was a boolean in disguise — active or closed — which
 * left nowhere to record a study suspended by a monitoring committee.
 *
 * This suite grades prostate histopathology and nothing else, so the disease
 * column is not a facet to filter on. It is stated once, above the table.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FlaskConical, Activity, CheckCircle2, PauseCircle, Search, ChevronRight, ChevronLeft,
  Plus, MoreHorizontal, SlidersHorizontal, Filter, Archive, RotateCcw, PauseOctagon,
} from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface Trial {
  id: string;
  name: string;
  protocol_id: string;
  phase: string;
  sponsor: string;
  drug: string;
  indication: string;
  sites: string[];
  status: string;
  patient_count: number;
  slides_analyzed: number;
  slides_confirmed: number;
  created: string;
  ended?: string;
}

type Status = 'active' | 'on_hold' | 'closed';

const STATUS_META: Record<Status, { label: string; dot: string; fg: string }> = {
  active:  { label: 'In Progress', dot: '#34C759', fg: '#248A3D' },
  on_hold: { label: 'On Hold',     dot: '#FF9500', fg: '#B26A00' },
  closed:  { label: 'Completed',   dot: 'var(--accent)', fg: 'var(--accent)' },
};

const PAGE_SIZE = 25;

export default function TrialsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const writable = canWrite(user?.role);
  const toast = useToast();
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const [phase, setPhase] = useState('');
  const [sort, setSort] = useState<{ key: 'name' | 'created'; dir: 'asc' | 'desc' }>(
    { key: 'created', dir: 'desc' });
  const [page, setPage] = useState(0);

  const load = async () => {
    try {
      const data = await apiSend('/api/trials/');
      setTrials(Array.isArray(data) ? data : []);
    } catch {
      setTrials([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setTrialStatus = async (t: Trial, next: Status) => {
    try {
      await apiSend(`/api/trials/${t.id}/status`, {
        method: 'POST', body: JSON.stringify({ status: next }),
      });
      toast.show(`"${t.name}" is now ${STATUS_META[next].label.toLowerCase()}`);
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not change the status.', 'error');
    }
  };

  const phases = useMemo(
    () => [...new Set(trials.map(t => t.phase).filter(Boolean))].sort(),
    [trials]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = trials;
    if (status) out = out.filter(t => (t.status || 'active') === status);
    if (phase) out = out.filter(t => t.phase === phase);
    if (q) out = out.filter(t =>
      [t.name, t.protocol_id, t.indication, t.sponsor, t.drug]
        .join(' ').toLowerCase().includes(q));
    return [...out].sort((a, b) => {
      const av = sort.key === 'name' ? a.name : a.created;
      const bv = sort.key === 'name' ? b.name : b.created;
      const c = String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [trials, search, status, phase, sort]);

  useEffect(() => { setPage(0); }, [search, status, phase, sort]);

  const counts = useMemo(() => ({
    total: trials.length,
    active: trials.filter(t => (t.status || 'active') === 'active').length,
    closed: trials.filter(t => t.status === 'closed').length,
    onHold: trials.filter(t => t.status === 'on_hold').length,
  }), [trials]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const from = page * PAGE_SIZE;
  const shown = filtered.slice(from, from + PAGE_SIZE);

  const toggleSort = (key: 'name' | 'created') =>
    setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div className="max-w-[1200px] px-7 pt-6 pb-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] mb-4">
        <button onClick={() => router.push('/dashboard')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          Dashboard
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="font-medium text-[var(--accent)]" aria-current="page">Trials</span>
      </nav>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.6px] leading-tight">Trials</h1>
          <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
            Every prostate histopathology trial on this installation. This suite grades
            prostate tissue only, so every study here shares that indication.
          </p>
        </div>
        {writable && (
          <Button size="md" className="btn-gradient shrink-0"
                  onClick={() => router.push('/dashboard?new=1')}>
            <Plus className="w-4 h-4" /> Create Trial
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <TrialStat icon={FlaskConical} tone="var(--accent)" label="Total trials"
                   value={loading ? '—' : String(counts.total)} sub="All time" />
        <TrialStat icon={Activity} tone="#34C759" label="Active trials"
                   value={loading ? '—' : String(counts.active)} sub="In progress" />
        <TrialStat icon={CheckCircle2} tone="#5856D6" label="Completed"
                   value={loading ? '—' : String(counts.closed)} sub="Closed to review" />
        <TrialStat icon={PauseCircle} tone="#FF9500" label="On hold"
                   value={loading ? '—' : String(counts.onHold)} sub="Temporarily paused" />
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by trial name, protocol code, sponsor, or drug…"
            className="w-full pl-11 pr-4 py-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
        <SelectControl icon={Filter} value={status} onChange={v => setStatus(v as '' | Status)}
                       options={[['', 'Status: All'], ['active', 'In Progress'],
                                 ['on_hold', 'On Hold'], ['closed', 'Completed']]} />
        <SelectControl icon={FlaskConical} value={phase} onChange={setPhase}
                       options={[['', 'Phase: All'], ...phases.map(p => [p, p] as [string, string])]} />
      </div>

      {loading ? (
        <TableSkeleton />
      ) : trials.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No trials yet"
          subtitle={writable
            ? 'Create your first trial to start registering patients and grading slides.'
            : 'No trials have been created yet.'}
          action={writable
            ? <Button size="lg" className="btn-gradient" onClick={() => router.push('/dashboard?new=1')}>
                Create Trial
              </Button>
            : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matching trials"
                    subtitle="Try a different search term, status, or phase." />
      ) : (
        <Card size="md" className="overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[850px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <SortableTh label="Trial name" active={sort.key === 'name'} dir={sort.dir}
                              onClick={() => toggleSort('name')} className="pl-5" />
                  <Th>Code</Th>
                  <Th>Phase</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Patients</Th>
                  <SortableTh label="Started" active={sort.key === 'created'} dir={sort.dir}
                              onClick={() => toggleSort('created')} />
                  <Th>Ended</Th>
                  <Th className="text-right pr-5">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map(t => (
                  <TrialRow key={t.id} trial={t} writable={writable}
                            onOpen={() => router.push(`/dashboard/trials/${t.id}`)}
                            onStatus={next => setTrialStatus(t, next)} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-[var(--border-subtle)]">
            <p className="text-[12px] text-[var(--text-secondary)]">
              Showing {filtered.length === 0 ? 0 : from + 1} to {from + shown.length} of{' '}
              {filtered.length} trial{filtered.length === 1 ? '' : 's'}
            </p>
            {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPage={setPage} />}
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

function SortableTh({ label, active, dir, onClick, className }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; className?: string;
}) {
  return (
    <th className={cn('px-4 py-3', className)}>
      <button
        onClick={onClick}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(
          'inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.5px] transition-colors',
          active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        )}
      >
        {label}
        <SlidersHorizontal className="w-3 h-3" />
      </button>
    </th>
  );
}

function TrialStat({ icon: Icon, tone, label, value, sub }: {
  icon: React.ElementType; tone: string; label: string; value: string; sub: string;
}) {
  return (
    <Card size="md" className="p-4 flex items-center gap-3.5">
      <span className="w-11 h-11 rounded-[14px] grid place-items-center shrink-0"
            style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon className="w-[18px] h-[18px]" style={{ color: tone }} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-[var(--text-secondary)] truncate">{label}</span>
        <span className="block text-[22px] font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block text-[11px] text-[var(--text-secondary)] truncate">{sub}</span>
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
      <select value={value} onChange={e => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

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
      {nums.map((n, i) => n === '…' ? (
        <span key={`gap${i}`} className="px-1 text-[12px] text-[var(--text-secondary)]">…</span>
      ) : (
        <button key={n} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}
          className={cn(
            'min-w-8 h-8 px-2 rounded-[10px] text-[12px] tabular-nums font-medium transition-colors border',
            n === page
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]',
          )}>
          {n + 1}
        </button>
      ))}
      <PageBtn onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1} aria-label="Next page">
        <ChevronRight className="w-4 h-4" />
      </PageBtn>
    </div>
  );
}

function PageBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest}
      className="grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] disabled:opacity-40 disabled:pointer-events-none">
      {children}
    </button>
  );
}

function TrialRow({ trial: t, writable, onOpen, onStatus }: {
  trial: Trial; writable: boolean; onOpen: () => void; onStatus: (s: Status) => void;
}) {
  const [menu, setMenu] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const status = (t.status || 'active') as Status;
  const meta = STATUS_META[status] ?? STATUS_META.active;

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (cellRef.current && !cellRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const date = (v?: string) => v
    ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  return (
    <tr onClick={onOpen}
        className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--cc-tile-hover)] transition-colors cursor-pointer">
      <td className="pl-5 pr-4 py-3 max-w-[220px]">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-[12px] bg-[var(--accent-soft)] grid place-items-center shrink-0">
            <FlaskConical className="w-4 h-4 text-[var(--accent)]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold truncate">{t.name}</span>
            {/* Sponsor and drug, not a study-type label — the model has no such
                field, and a made-up one on a trial register would be read as
                fact by whoever comes next. */}
            <span className="block text-[11px] text-[var(--text-secondary)] truncate">
              {[t.sponsor, t.drug].filter(Boolean).join(' · ') || t.indication || '—'}
            </span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
        {t.protocol_id || '—'}
      </td>
      <td className="px-4 py-3">
        {t.phase
          ? <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap bg-[var(--accent-soft)] text-[var(--accent)]">
              {t.phase}
            </span>
          : <span className="text-[12.5px] text-[var(--text-secondary)]">—</span>}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap"
              style={{ color: meta.fg }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.dot }} />
          {meta.label}
        </span>
      </td>
      <td className="px-4 py-3 text-[12.5px] tabular-nums text-right">{t.patient_count ?? 0}</td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)] whitespace-nowrap">
        {date(t.created)}
      </td>
      {/* A running trial has not reached an end date, so it shows a dash rather
          than a projected one. Closing the trial is what stamps it. */}
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)] whitespace-nowrap">
        {date(t.ended)}
      </td>
      <td className="pr-5 pl-4 py-3 text-right relative" ref={cellRef}>
        <button
          onClick={e => { e.stopPropagation(); setMenu(v => !v); }}
          aria-label="Trial actions"
          aria-expanded={menu}
          className="inline-grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menu && (
          <div onClick={e => e.stopPropagation()}
               className="cc-panel absolute right-5 top-[calc(100%-4px)] w-[200px] z-40 p-1.5 rounded-[14px] animate-menu-in origin-top-right text-left">
            <button onClick={onOpen} className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
              <FlaskConical className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Open trial
            </button>
            {writable && status !== 'active' && (
              <button onClick={() => { setMenu(false); onStatus('active'); }}
                      className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
                <RotateCcw className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Resume trial
              </button>
            )}
            {writable && status === 'active' && (
              <button onClick={() => { setMenu(false); onStatus('on_hold'); }}
                      className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
                <PauseOctagon className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Put on hold
              </button>
            )}
            {writable && status !== 'closed' && (
              <button onClick={() => { setMenu(false); onStatus('closed'); }}
                      className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
                <Archive className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Close trial
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
