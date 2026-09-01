'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FlaskConical, Users, Download, Trash2, ScrollText, Search, Archive, RotateCcw, ArrowRight, Layers } from 'lucide-react';
import { Card, Button, Pill, EmptyState, Skeleton, CardSkeleton,
         PillButton, CardHeader, AreaChart } from '@/components/ui';
import { apiFetch, apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';
import { cn } from '@/lib/utils';
import CreateTrialDialog, { TrialDraft } from './components/CreateTrialDialog';
import SystemHealth from './components/SystemHealth';
import AppBar from './components/AppBar';

export interface Trial {
  id: string;
  name: string;
  /** Added after first release — absent on trials registered before then. */
  protocol_id?: string;
  phase?: string;
  sponsor: string;
  drug: string;
  indication: string;
  notes: string;
  sites: string[];
  status: string;
  patient_count: number;
  slides_analyzed: number;
  slides_confirmed: number;
  created: string;
}

export default function TrialDashboard() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [openQueries, setOpenQueries] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');
  const router = useRouter();
  const { user } = useAuth();
  const writable = canWrite(user?.role);
  const toast = useToast();
  const { confirm } = useDialogs();

  const loadTrials = async () => {
    try {
      const res = await apiFetch('/api/trials/');
      const data = await res.json();
      setTrials(data);
      apiFetch('/api/queries/')
        .then(r => r.json())
        .then((queries: { trial_id: string; status: string }[]) => {
          const counts: Record<string, number> = {};
          for (const q of queries) {
            if (q.status !== 'closed') counts[q.trial_id] = (counts[q.trial_id] || 0) + 1;
          }
          setOpenQueries(counts);
        })
        .catch(() => {});
    } catch (e) {
      console.error('Failed to load trials', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTrials(); }, []);

  // Throws on failure. The dialog catches it, keeps the entered data on
  // screen, and shows the server's reason — previously a rejected create
  // closed nothing and left only a toast.
  const createTrial = async (draft: TrialDraft) => {
    await apiSend('/api/trials/', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    setShowCreate(false);
    loadTrials();
    toast.show(`Trial "${draft.name}" registered`);
  };

  const deleteTrial = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete Trial',
      message: `This permanently deletes "${name}" and all its patients and slides. This cannot be undone.`,
      confirmLabel: 'Delete Trial',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiSend(`/api/trials/${id}`, { method: 'DELETE' });
      loadTrials();
      toast.show(`Trial "${name}" deleted`);
    } catch (e) {
      console.error('Failed to delete', e);
      toast.show(e instanceof Error ? e.message : 'Failed to delete trial', 'error');
    }
  };

  const setTrialStatus = async (id: string, name: string, status: 'active' | 'closed') => {
    try {
      await apiSend(`/api/trials/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      loadTrials();
      toast.show(`"${name}" ${status === 'closed' ? 'closed' : 'reopened'}`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to update trial status', 'error');
    }
  };

  const exportCorrections = async (id: string, name: string) => {
    try {
      const res = await apiFetch(`/api/trials/${id}/export-corrections`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_corrections.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show('Corrections exported');
    } catch (e) {
      console.error('Failed to export', e);
      toast.show('Failed to export corrections', 'error');
    }
  };

  const q = search.trim().toLowerCase();
  const visibleTrials = trials.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (!q) return true;
    return [t.name, t.protocol_id || '', t.phase || '', t.sponsor, t.drug, t.indication]
      .some((f) => (f || '').toLowerCase().includes(q));
  });

  const totals = {
    trials: trials.length,
    active: trials.filter((t) => t.status === 'active').length,
    patients: trials.reduce((n, t) => n + (t.patient_count || 0), 0),
    slides: trials.reduce((n, t) => n + (t.slides_analyzed || 0), 0),
    pending: trials.reduce((n, t) => n + Math.max(0, (t.slides_analyzed || 0) - (t.slides_confirmed || 0)), 0),
  };

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  })();
  // Greet by name, not by title. Splitting on the first word alone produced
  // "Good afternoon, Dr" for anyone entered as "Dr Sarah Chen", so skip a
  // leading honorific. Clinicians commonly enter their title in this field.
  const displayName = (() => {
    const TITLES = /^(dr|dr\.|prof|prof\.|mr|mr\.|mrs|mrs\.|ms|ms\.|miss|md|phd)$/i;
    const parts = (user?.full_name || '').trim().split(/\s+/).filter(Boolean);
    const hadTitle = parts.length > 1 && TITLES.test(parts[0]);
    const named = hadTitle ? parts.slice(1) : parts;
    if (named.length === 0) return 'there';
    // With a title, surname reads more naturally ("Dr Chen"); without one,
    // the given name does ("Sarah").
    return hadTitle ? `${parts[0]} ${named[named.length - 1]}` : named[0];
  })();

  const reviewedPct = totals.slides > 0
    ? Math.round(((totals.slides - totals.pending) / totals.slides) * 100)
    : 0;

  // One bar per trial that has analysed slides, height = share signed.
  const trialBars = trials
    .filter((t) => (t.slides_analyzed || 0) > 0)
    .slice(0, 12)
    .map((t) => ({
      id: t.id,
      name: t.name,
      analyzed: t.slides_analyzed || 0,
      confirmed: t.slides_confirmed || 0,
      pct: Math.round(((t.slides_confirmed || 0) / (t.slides_analyzed || 1)) * 100),
    }));

  // Jump straight to the trial carrying the most unreviewed work.
  const firstPendingTrial = [...trials]
    .filter((t) => (t.slides_analyzed || 0) - (t.slides_confirmed || 0) > 0)
    .sort((a, b) =>
      ((b.slides_analyzed || 0) - (b.slides_confirmed || 0)) -
      ((a.slides_analyzed || 0) - (a.slides_confirmed || 0)))[0];

  const totalOpenQueries = Object.values(openQueries).reduce((n, v) => n + (v || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
        <div className="border-b border-[var(--border-subtle)] px-6 py-3.5 flex items-center gap-3 bg-[var(--bg-card-solid)]">
          <div className="w-8 h-8 rounded-[8px] skeleton-shimmer" />
          <div className="space-y-1.5">
            <div className="w-40 h-3 rounded-[4px] skeleton-shimmer" />
            <div className="w-56 h-2.5 rounded-[4px] skeleton-shimmer" />
          </div>
        </div>
        {/* Mirrors the real layout — four stat cards, three overview cards,
            then the trial grid — so nothing shifts position when the data
            arrives. A centred spinner would tell the reader nothing about
            what is coming and then move everything on load. */}
        <div className="max-w-6xl mx-auto px-6 pt-7">
          <Skeleton className="h-6 w-64 rounded-[6px]" />
          <Skeleton className="h-3 w-80 rounded-[4px] mt-2.5" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} size="sm" className="p-4">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-6 w-14" />
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} lines={3} />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} lines={4} />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      <AppBar
        actions={writable ? (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" />
            New Trial
          </Button>
        ) : undefined}
      />

      <SystemHealth />

      {/* Greeting + at-a-glance figures.
          Rendered unconditionally: this is the page header, not a data
          widget. Hiding it until a trial exists meant a fresh install showed
          nothing but an empty state, so the dashboard looked unchanged on
          exactly the screen a new user sees first. Zero is a valid figure. */}
      <div className="max-w-6xl mx-auto px-6 pt-7 pb-1">
        <h2 className="text-[26px] font-semibold tracking-[-0.5px] leading-tight">
          {greeting}, <span className="text-[var(--accent)]">{displayName}</span>
        </h2>
        <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
          {trials.length === 0
            ? 'No trials yet — create one to begin.'
            : totals.pending > 0
              ? `${totals.pending} slide${totals.pending === 1 ? '' : 's'} awaiting your review`
              : 'Everything analysed has been reviewed and signed'}
        </p>

        {/* Figures read left-to-right in the order a coordinator checks them:
            how much work exists, how much is done, what is left. Cards rather
            than a bare row of numbers with rules between them — every other
            surface on this page is a card, and the header was the one place
            that broke the grid. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <StatCard icon={Users} label="Patients" value={totals.patients} />
          <StatCard icon={Layers} label="Slides analysed" value={totals.slides} />
          <StatCard
            icon={ScrollText}
            label="Awaiting review"
            value={totals.pending}
            tone={totals.pending > 0 ? '#FF9500' : undefined}
          />
          <StatCard
            icon={FlaskConical}
            label="Active trials"
            value={totals.active}
            sub={totals.trials !== totals.active ? `of ${totals.trials}` : undefined}
          />
        </div>
      </div>

      {/* Trial List */}
      <div className="max-w-6xl mx-auto px-6 py-6">
          {/* Overview row. Three cards: what is done, what needs a person,
              and how the portfolio is split. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            {/* Review progress — real completion, not a decorative gauge */}
            <Card size="md" className="p-5">
              <CardHeader
                title="Review progress"
                action={
                  <span className="text-[11.5px] font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-2.5 py-1 tabular-nums">
                    {reviewedPct}%
                  </span>
                }
              />
              {trialBars.length === 0 ? (
                <div className="h-[96px] flex items-center">
                  <p className="text-[11.5px] text-[var(--text-secondary)]">
                    No slides analysed yet — the curve appears once grading starts.
                  </p>
                </div>
              ) : (
                <AreaChart
                  points={trialBars.map((b) => b.pct)}
                  max={100}
                  height={96}
                />
              )}
              <div className="flex items-center gap-4 text-[11px] text-[var(--text-secondary)] mt-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                  Signed {totals.slides - totals.pending}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--skeleton-bg)] border border-[var(--border-subtle)]" />
                  Pending {totals.pending}
                </span>
              </div>
            </Card>

            {/* The one accent card — deliberately the only saturated surface on
                the page, so the eye lands on the outstanding work first. */}
            <div className="rounded-[20px] p-5 flex flex-col justify-between" style={{ background: 'linear-gradient(145deg, var(--accent-bright) 0%, var(--accent-hover) 100%)' }}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-[var(--accent-contrast)]/95">Needs a pathologist</p>
                  <span className="text-[10px] font-medium text-[var(--accent-contrast)]/80 bg-[var(--accent-contrast)]/15 rounded-full px-2 py-0.5">
                    {totals.active} active
                  </span>
                </div>
                <p className="text-[38px] font-semibold text-[var(--accent-contrast)] leading-none tabular-nums mt-3">
                  {totals.pending}
                </p>
                <p className="text-[12px] text-[var(--accent-contrast)]/85 leading-relaxed mt-2">
                  {totals.pending > 0
                    ? 'Analysed slides become part of the record only once a qualified pathologist confirms or corrects the grade.'
                    : 'No slides are waiting. Every analysed slide carries a signature.'}
                </p>
              </div>
              {firstPendingTrial && (
                <button
                  onClick={() => router.push(`/dashboard/trials/${firstPendingTrial.id}`)}
                  className="mt-4 self-start inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] bg-[var(--bg-card-solid)] rounded-full px-3.5 py-1.5 hover:bg-[var(--bg-card-solid)]/90 transition-colors"
                >
                  Open {firstPendingTrial.name} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Portfolio split */}
            <Card size="md" className="p-5">
              <CardHeader title="Portfolio" />
              <div className="space-y-3">
                <PortfolioRow label="Trials" value={totals.trials} />
                <PortfolioRow label="Active" value={totals.active} accent="#34C759" />
                <PortfolioRow label="Closed" value={totals.trials - totals.active} />
                <PortfolioRow label="Open queries" value={totalOpenQueries} accent={totalOpenQueries > 0 ? '#FF9500' : undefined} />
              </div>
            </Card>
          </div>

          {trials.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title="No trials yet"
              subtitle={writable ? 'Create your first clinical trial to get started.' : 'No trials have been created yet.'}
              action={writable ? <Button size="lg" onClick={() => setShowCreate(true)}>Create Trial</Button> : undefined}
            />
          ) : (
          <>
          {/* Toolbar. Pill controls on the page ground rather than a boxed
              filter bar — the search field is the one thing that has to be
              wide, so it takes the row and the filters sit beside it. */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search trials, sponsors, drugs…"
                className="w-full pl-10 pr-4 py-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[12.5px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
            {(['all', 'active', 'closed'] as const).map((s) => (
              <PillButton
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                className="capitalize"
              >
                {s}
              </PillButton>
            ))}
          </div>

          {visibleTrials.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching trials"
              subtitle="Try a different search term or status filter."
            />
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleTrials.map((trial) => (
              <TrialCard
                key={trial.id}
                trial={trial}
                openQueries={openQueries[trial.id] || 0}
                writable={writable}
                onOpen={() => router.push(`/dashboard/trials/${trial.id}`)}
                onExport={() => exportCorrections(trial.id, trial.name)}
                onToggleStatus={() =>
                  setTrialStatus(trial.id, trial.name, trial.status === 'closed' ? 'active' : 'closed')}
                onDelete={() => deleteTrial(trial.id, trial.name)}
              />
            ))}
          </div>
          )}
          </>
        )}
      </div>

      <CreateTrialDialog
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        onSubmit={createTrial}
      />
    </div>
  );
}

/** Top-bar section pill. Active is a solid fill so the current section is
 * unambiguous at a glance, matching how the rest of the app marks state. */

/** A single headline figure in the greeting strip. */
/** One figure, in a card. */
export function StatCard({ icon: Icon, label, value, tone, sub }: {
  icon: React.ElementType; label: string; value: number; tone?: string; sub?: string;
}) {
  return (
    <Card size="sm" className="p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)] truncate">{label}</span>
      </div>
      <p className="text-[26px] font-semibold tabular-nums leading-none" style={{ color: tone }}>
        {value.toLocaleString()}
        {sub && <span className="text-[12px] font-medium text-[var(--text-secondary)] ml-1.5">{sub}</span>}
      </p>
    </Card>
  );
}

/** A trial, as a card.
 *
 * This was a nine-column table that needed horizontal scrolling below about
 * 640px — so on a laptop the columns a coordinator actually checks (progress,
 * status, open queries) were off the right edge. A card carries the same
 * fields in a shape that fits, and puts the progress bar directly under the
 * counts it describes instead of three columns away.
 */
export function TrialCard({ trial, openQueries, writable, onOpen, onExport, onToggleStatus, onDelete }: {
  trial: Trial;
  openQueries: number;
  writable: boolean;
  onOpen: () => void;
  onExport: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const pct = trial.slides_analyzed > 0
    ? Math.round((trial.slides_confirmed / trial.slides_analyzed) * 100)
    : 0;
  const pending = Math.max(0, trial.slides_analyzed - trial.slides_confirmed);

  // A div, not a button: the card contains its own buttons, and nesting
  // interactive elements is invalid and breaks keyboard navigation. Role and
  // key handling give it the same behaviour without the nesting.
  return (
    <Card
      size="sm"
      className="health-card-interactive p-5 cursor-pointer flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-semibold truncate">{trial.name}</h3>
            {trial.phase && (
              <span className="text-[10px] font-medium text-[var(--text-secondary)] bg-[var(--skeleton-bg)] rounded-full px-2 py-0.5 whitespace-nowrap">
                {trial.phase}
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5 truncate">
            {[trial.protocol_id, trial.sponsor, trial.drug].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Pill accent={trial.status === 'active' ? 'green' : 'gray'}>{trial.status}</Pill>
      </div>

      {trial.indication && (
        <p className="text-[11.5px] text-[var(--text-secondary)] mt-2.5 truncate">{trial.indication}</p>
      )}

      <div className="grid grid-cols-3 gap-2 mt-4">
        {[
          ['Patients', trial.patient_count, undefined],
          ['Analysed', trial.slides_analyzed, undefined],
          ['Signed', trial.slides_confirmed, '#34C759'],
        ].map(([label, value, tone]) => (
          <div key={String(label)}>
            <p className="text-[10px] uppercase tracking-[0.4px] text-[var(--text-secondary)]">{String(label)}</p>
            <p className="text-[16px] font-semibold tabular-nums leading-tight mt-0.5"
               style={{ color: tone as string | undefined }}>
              {Number(value).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3.5">
        <div className="flex items-center justify-between text-[10.5px] text-[var(--text-secondary)] mb-1">
          <span>{pending > 0 ? `${pending} awaiting review` : 'All signed'}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-1.5 min-w-0">
          {openQueries > 0 && (
            <Pill accent="orange">{openQueries} {openQueries === 1 ? 'query' : 'queries'}</Pill>
          )}
          {trial.sites?.length > 0 && (
            <span className="text-[10.5px] text-[var(--text-secondary)] whitespace-nowrap">
              {trial.sites.length} site{trial.sites.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <CardAction icon={Download} title="Export corrections"
                      onClick={(e) => { e.stopPropagation(); onExport(); }} />
          {writable && (
            <CardAction
              icon={trial.status === 'closed' ? RotateCcw : Archive}
              title={trial.status === 'closed' ? 'Reopen trial' : 'Close trial'}
              onClick={(e) => { e.stopPropagation(); onToggleStatus(); }}
            />
          )}
          {writable && (
            <CardAction icon={Trash2} title="Delete trial" danger
                        onClick={(e) => { e.stopPropagation(); onDelete(); }} />
          )}
        </div>
      </div>
    </Card>
  );
}

function CardAction({ icon: Icon, title, onClick, danger }: {
  icon: React.ElementType;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'p-1.5 rounded-[7px] text-[var(--text-secondary)] transition-colors',
        danger
          ? 'hover:bg-[#FF3B30]/10 hover:text-[#FF3B30]'
          : 'hover:bg-[var(--skeleton-bg)] hover:text-[var(--text-primary)]',
      )}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function PortfolioRow({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums" style={{ color: accent }}>{value}</span>
    </div>
  );
}
