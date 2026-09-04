'use client';

/**
 * The grading model registry.
 *
 * Every row here is a model this installation actually holds: the one shipped
 * with Omnia, and one for each fine-tuning run that produced a checkpoint. The
 * reference design for this screen listed six models across ophthalmology,
 * breast, cytology and general pathology. This suite grades prostate
 * histopathology and nothing else, and a registry that claims otherwise is not
 * a cosmetic liberty — it is a page a reviewer would read as a statement of
 * what the software can do.
 *
 * Two more departures, for the same reason:
 *
 *   Agreement, not accuracy. Grading agreement is measured with quadratic
 *   weighted kappa, because Gleason grades are ordered — calling a grade 5 a
 *   grade 4 is a smaller error than calling it a 2, and plain accuracy scores
 *   both as simply wrong. QWK is the figure the run computed and the figure a
 *   reviewer will ask for; "94.2% accurate" is a different and weaker claim.
 *
 *   No inference-time or month-on-month trend cards. Neither is recorded, and
 *   a trend line is a claim about history this installation cannot make.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, CheckCircle2, Layers, GraduationCap, Search, ChevronRight, ChevronLeft,
  MoreHorizontal, SlidersHorizontal, Filter, RotateCcw, Play, AlertTriangle,
} from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn, relativeTime } from '@/lib/utils';
import FederatedGraphic from './FederatedGraphic';

interface ActiveModel {
  source: 'shipped' | 'finetuned';
  path?: string | null;
  qwk?: number;
  baseline_qwk?: number;
  examples_used?: number;
  activated?: string;
  description: string;
}

interface Run {
  id: string;
  state: string;
  started_at?: string;
  finished_at?: string;
  baseline_qwk?: number;
  finetuned_qwk?: number;
  selection_qwk?: number;
  examples_used?: number;
  train_size?: number;
  improved?: boolean;
  started_by?: string;
}

/** One row of the registry. */
interface ModelRow {
  id: string;
  name: string;
  provenance: string;
  origin: 'Supplied with Omnia' | 'Adapted on this site';
  qwk?: number;
  baseline?: number;
  examples?: number;
  updated?: string;
  status: 'in-use' | 'available' | 'not-promoted' | 'failed';
  runId?: string;
}

const STATUS_META: Record<ModelRow['status'], { label: string; dot: string; fg: string }> = {
  'in-use':        { label: 'In use',        dot: '#34C759', fg: '#248A3D' },
  'available':     { label: 'Available',     dot: 'var(--accent)', fg: 'var(--accent)' },
  'not-promoted':  { label: 'Not promoted',  dot: '#8E8E93', fg: 'var(--text-secondary)' },
  'failed':        { label: 'Failed',        dot: '#FF3B30', fg: '#FF3B30' },
};

const PAGE_SIZE = 25;

export default function ModelsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const writable = canWrite(user?.role);
  const toast = useToast();
  const [active, setActive] = useState<ActiveModel | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([
      apiSend('/api/training/model').catch(() => null),
      apiSend('/api/training/runs').catch(() => []),
    ]);
    setActive(m);
    setRuns(Array.isArray(r) ? r : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const revert = async () => {
    try {
      await apiSend('/api/training/model/revert', { method: 'POST' });
      toast.show('Reverted to the model supplied with Omnia');
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not revert.', 'error');
    }
  };

  const rows: ModelRow[] = useMemo(() => {
    const usingFinetune = active?.source === 'finetuned';
    const out: ModelRow[] = [{
      id: 'shipped',
      name: 'Omnia Prostate v1',
      provenance: 'Trained on a public prostate biopsy dataset. No slides from this site have changed it.',
      origin: 'Supplied with Omnia',
      status: usingFinetune ? 'available' : 'in-use',
    }];

    // Newest first, so the most recent adaptation sits nearest the shipped model.
    const finished = runs.filter(r => r.state !== 'running');
    finished.forEach((r, i) => {
      const failed = r.state === 'failed' || r.state === 'interrupted';
      out.push({
        id: r.id,
        name: `Site-adapted · run ${finished.length - i}`,
        provenance: r.examples_used
          ? `Adapted using ${r.examples_used.toLocaleString()} slides your pathologists signed.`
          : 'Adapted on this site.',
        origin: 'Adapted on this site',
        qwk: r.finetuned_qwk,
        baseline: r.baseline_qwk,
        examples: r.examples_used,
        updated: r.finished_at || r.started_at,
        // A run that did not beat the baseline still produced a model — it was
        // simply not promoted. Showing it is the point: a registry that only
        // lists winners hides how often adaptation does not help.
        status: failed ? 'failed'
              : (usingFinetune && i === 0 && r.improved) ? 'in-use'
              : r.improved ? 'available' : 'not-promoted',
        runId: r.id,
      });
    });
    return out;
  }, [active, runs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(m => {
      if (status && m.status !== status) return false;
      if (q && ![m.name, m.provenance, m.origin].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, status]);

  useEffect(() => { setPage(0); }, [search, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const from = page * PAGE_SIZE;
  const shown = filtered.slice(from, from + PAGE_SIZE);

  const inUse = rows.find(m => m.status === 'in-use');
  const promoted = rows.filter(m => m.status === 'available' || m.status === 'in-use').length;

  return (
    <div className="max-w-[1200px] px-7 pt-6 pb-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] mb-4">
        <button onClick={() => router.push('/dashboard')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          Dashboard
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="font-medium text-[var(--accent)]" aria-current="page">Models</span>
      </nav>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.6px] leading-tight">Grading models</h1>
          <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
            Every model this installation holds, and which one is grading right now.
            All of them grade prostate histopathology — this suite does nothing else.
          </p>
        </div>
        {writable && (
          <Button size="md" className="btn-gradient shrink-0"
                  onClick={() => router.push('/dashboard/training')}>
            <GraduationCap className="w-4 h-4" /> Train a model
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat icon={Box} tone="var(--accent)" label="Models held"
              value={loading ? '—' : String(rows.length)} sub="Shipped plus adaptations" />
        <Stat icon={CheckCircle2} tone="#34C759" label="In use"
              value={loading ? '—' : (active?.source === 'finetuned' ? 'Site-adapted' : 'Supplied')}
              sub={inUse ? inUse.name : '—'} />
        <Stat icon={Layers} tone="#5856D6" label="Agreement"
              value={loading ? '—' : (active?.qwk != null ? active.qwk.toFixed(3) : '—')}
              sub={active?.qwk != null && active?.baseline_qwk != null
                ? `baseline ${active.baseline_qwk.toFixed(3)}`
                : 'QWK, measured on held-out slides'} />
        <Stat icon={GraduationCap} tone="#FF9500" label="Promoted"
              value={loading ? '—' : String(promoted)}
              sub={`of ${rows.length} produced`} />
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search models by name or origin…"
            className="w-full pl-11 pr-4 py-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
        <SelectControl icon={Filter} value={status} onChange={setStatus}
                       options={[['', 'Status: All'], ['in-use', 'In use'], ['available', 'Available'],
                                 ['not-promoted', 'Not promoted'], ['failed', 'Failed']]} />
      </div>

      {loading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matching models"
                    subtitle="Try a different search term or status." />
      ) : (
        <Card size="md" className="overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <Th className="pl-5">Model</Th>
                  <Th>Origin</Th>
                  <Th className="text-right">Agreement</Th>
                  <Th>Status</Th>
                  <Th>Updated</Th>
                  <Th className="text-right pr-5">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map(m => (
                  <ModelRowView key={m.id} model={m} writable={writable}
                                onRevert={revert}
                                onOpenRun={() => router.push('/dashboard/training')} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-[var(--border-subtle)]">
            <p className="text-[12px] text-[var(--text-secondary)]">
              Showing {from + 1} to {from + shown.length} of {filtered.length} model{filtered.length === 1 ? '' : 's'}
            </p>
            {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPage={setPage} />}
          </div>
        </Card>
      )}

      <div className="mt-6">
        <FederatedGraphic />
      </div>
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

function Stat({ icon: Icon, tone, label, value, sub }: {
  icon: React.ElementType; tone: string; label: string; value: string; sub: string;
}) {
  return (
    <Card size="md" className="p-4 flex items-center gap-3.5">
      <span className="w-11 h-11 rounded-[16px] grid place-items-center shrink-0"
            style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon className="w-[18px] h-[18px]" style={{ color: tone }} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-[var(--text-secondary)] truncate">{label}</span>
        <span className="block text-[20px] font-semibold tabular-nums leading-tight truncate">{value}</span>
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
    <label className="relative inline-flex items-center gap-2 px-4 py-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] font-medium cursor-pointer transition-colors hover:border-[var(--border-medium)]">
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
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page"
        className="grid place-items-center w-8 h-8 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-40 disabled:pointer-events-none">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-[12px] tabular-nums px-2">{page + 1} / {pageCount}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1} aria-label="Next page"
        className="grid place-items-center w-8 h-8 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] disabled:opacity-40 disabled:pointer-events-none">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function ModelRowView({ model: m, writable, onRevert, onOpenRun }: {
  model: ModelRow; writable: boolean; onRevert: () => void; onOpenRun: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const meta = STATUS_META[m.status];
  const delta = m.qwk != null && m.baseline != null ? m.qwk - m.baseline : null;

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (cellRef.current && !cellRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  return (
    <tr className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--cc-tile-hover)] transition-colors">
      <td className="pl-5 pr-4 py-3 max-w-[320px]">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-[14px] bg-[var(--accent-soft)] grid place-items-center shrink-0 mt-0.5">
            <Box className="w-[18px] h-[18px] text-[var(--accent)]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold truncate">{m.name}</span>
            <span className="block text-[11.5px] text-[var(--text-secondary)] leading-snug">
              {m.provenance}
            </span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap bg-[var(--accent-soft)] text-[var(--accent)]">
          {m.origin}
        </span>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {m.qwk != null ? (
          <>
            <span className="text-[13px] font-semibold tabular-nums">{m.qwk.toFixed(3)}</span>
            {/* Against the baseline the same run measured, on the same held-out
                slides. A bare figure invites comparison with a number from a
                different dataset, which is how model claims go wrong. */}
            {delta != null && (
              <span className="block text-[11px] tabular-nums"
                    style={{ color: delta >= 0 ? '#248A3D' : '#FF3B30' }}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(3)} vs baseline
              </span>
            )}
          </>
        ) : (
          <span className="text-[12.5px] text-[var(--text-secondary)]">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap"
              style={{ color: meta.fg }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.dot }} />
          {meta.label}
        </span>
      </td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)] whitespace-nowrap">
        {m.updated ? relativeTime(m.updated) : '—'}
      </td>
      <td className="pr-5 pl-4 py-3 text-right relative" ref={cellRef}>
        <button onClick={() => setMenu(v => !v)} aria-label="Model actions" aria-expanded={menu}
          className="inline-grid place-items-center w-8 h-8 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]">
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menu && (
          <div className="cc-panel absolute right-5 top-[calc(100%-4px)] w-[214px] z-40 p-1.5 rounded-[18px] animate-menu-in origin-top-right text-left">
            <button onClick={() => { setMenu(false); onOpenRun(); }}
                    className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
              <Play className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Open training
            </button>
            {writable && m.id === 'shipped' && m.status !== 'in-use' && (
              <button onClick={() => { setMenu(false); onRevert(); }}
                      className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
                <RotateCcw className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Use this model
              </button>
            )}
            {m.status === 'not-promoted' && (
              <p className="px-2.5 py-2 text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                This run did not beat the baseline, so it was never put into use.
              </p>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
