'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FlaskConical, Users, Download, Trash2, ShieldCheck, ScrollText, LogOut, ChevronDown, Search, Archive, RotateCcw, BookOpen, GraduationCap, ArrowRight } from 'lucide-react';
import { Card, Button, BrandMark, Pill, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth, canWrite, ROLE_LABELS } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';
import { useOnboarding } from '@/lib/onboarding';
import CreateTrialDialog, { TrialDraft } from './components/CreateTrialDialog';
import SystemHealth from './components/SystemHealth';

interface Trial {
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
  const [showMenu, setShowMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');
  const router = useRouter();
  const { user, logout } = useAuth();
  const writable = canWrite(user?.role);
  const toast = useToast();
  const { confirm } = useDialogs();
  const { open: openGuide } = useOnboarding();

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
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Card size="sm" className="overflow-hidden">
            <TableSkeleton rows={4} columns={6} />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      {/* Top Bar */}
      <div className="titlebar-drag titlebar-inset border-b border-[var(--border-subtle)] pr-6 py-3 flex items-center justify-between gap-4 bg-[var(--bg-card-solid)]">
        <div className="flex items-center gap-2.5 shrink-0">
          <BrandMark size={30} />
          <div className="hidden lg:block">
            <h1 className="text-[14px] font-semibold leading-tight">Omnia Pathology AI</h1>
            <p className="text-[10px] text-[var(--text-secondary)] leading-tight">Research Use Only</p>
          </div>
        </div>

        {/* Primary sections as pills. These were previously buried in the
            account dropdown, which put the audit trail and user management
            three clicks away from the screen a coordinator lives on. */}
        <nav className="titlebar-no-drag flex items-center gap-1 min-w-0 overflow-x-auto">
          <NavPill active label="Dashboard" onClick={() => {}} />
          <NavPill label="Patients" onClick={() => router.push('/dashboard/patients')} />
          {(user?.role === 'admin' || user?.role === 'monitor') && (
            <NavPill label="Audit Trail" onClick={() => router.push('/dashboard/audit')} />
          )}
          {user?.role === 'admin' && (
            <NavPill label="Users" onClick={() => router.push('/dashboard/users')} />
          )}
          {writable && (
            <NavPill label="Model" onClick={() => router.push('/dashboard/training')} />
          )}
        </nav>

        <div className="titlebar-no-drag flex items-center gap-2 shrink-0">
          {writable && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5" />
              New Trial
            </Button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowMenu(v => !v)}
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-[10px] hover:bg-[var(--skeleton-bg)] transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-[#007AFF]/10 flex items-center justify-center text-[11px] font-semibold text-[#007AFF] shrink-0">
                {(user?.full_name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="text-left hidden md:block">
                <p className="text-[12px] font-medium leading-tight">{user?.full_name}</p>
                <p className="text-[10px] text-[var(--text-secondary)] leading-tight">{user ? ROLE_LABELS[user.role] : ''}</p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <Card size="sm" className="absolute right-0 top-[calc(100%+6px)] w-[200px] z-50 p-1.5 shadow-xl">
                  {user?.role === 'admin' && (
                    <button
                      onClick={() => { setShowMenu(false); router.push('/dashboard/users'); }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[12px] hover:bg-[var(--skeleton-bg)] text-left"
                    >
                      <Users className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Manage Users
                    </button>
                  )}
                  {(user?.role === 'admin' || user?.role === 'monitor') && (
                    <button
                      onClick={() => { setShowMenu(false); router.push('/dashboard/audit'); }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[12px] hover:bg-[var(--skeleton-bg)] text-left"
                    >
                      <ScrollText className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Audit Trail
                    </button>
                  )}
                  {writable && (
                    <button
                      onClick={() => { setShowMenu(false); router.push('/dashboard/training'); }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[12px] hover:bg-[var(--skeleton-bg)] text-left"
                    >
                      <GraduationCap className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Model Training
                    </button>
                  )}
                  <button
                    onClick={() => { setShowMenu(false); openGuide(); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[12px] hover:bg-[var(--skeleton-bg)] text-left"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Guide &amp; Help
                  </button>
                  <button
                    onClick={() => { setShowMenu(false); router.push('/admin'); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[12px] hover:bg-[var(--skeleton-bg)] text-left"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> System Health
                  </button>
                  <div className="h-px bg-[var(--border-subtle)] my-1" />
                  <button
                    onClick={async () => { await logout(); router.push('/login'); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[12px] hover:bg-[#FF3B30]/10 text-[#FF3B30] text-left"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Sign Out
                  </button>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      <SystemHealth />

      {/* Greeting + at-a-glance figures.
          Rendered unconditionally: this is the page header, not a data
          widget. Hiding it until a trial exists meant a fresh install showed
          nothing but an empty state, so the dashboard looked unchanged on
          exactly the screen a new user sees first. Zero is a valid figure. */}
      <div className="max-w-6xl mx-auto px-6 pt-7 pb-1">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h2 className="text-[26px] font-semibold tracking-[-0.5px] leading-tight">
              {greeting}, <span className="text-[#007AFF]">{displayName}</span>
            </h2>
            <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
              {trials.length === 0
                ? 'No trials yet — create one to begin.'
                : totals.pending > 0
                  ? `${totals.pending} slide${totals.pending === 1 ? '' : 's'} awaiting your review`
                  : 'Everything analysed has been reviewed and signed'}
            </p>
          </div>

          {/* Figures read left-to-right in the order a coordinator checks
              them: how much work exists, how much is done, what is left. */}
          <div className="flex items-stretch gap-6">
            <Metric label="Patients" value={totals.patients} />
            <Divider />
            <Metric label="Slides analysed" value={totals.slides} />
            <Divider />
            <Metric
              label="Awaiting review"
              value={totals.pending}
              accent={totals.pending > 0 ? '#FF9500' : undefined}
            />
          </div>
        </div>
      </div>

      {/* Trial List */}
      <div className="max-w-6xl mx-auto px-6 py-6">
          {/* Overview row. Three cards: what is done, what needs a person,
              and how the portfolio is split. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            {/* Review progress — real completion, not a decorative gauge */}
            <div className="rounded-[16px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <p className="text-[13px] font-semibold">Review progress</p>
                <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                  {reviewedPct}%
                </span>
              </div>
              <div className="flex items-end justify-start gap-1.5 h-[72px] mb-3">
                {trialBars.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-secondary)]">No slides analysed yet.</p>
                ) : trialBars.map((b) => (
                  // Bars are capped in width and left-aligned. With flex-1 and
                  // a single trial the "chart" became one solid slab filling
                  // the card, which reads as a rendering fault rather than as
                  // one trial's progress.
                  <div key={b.id} className="flex-1 max-w-[40px] flex flex-col justify-end h-full min-w-[12px]" title={`${b.name}: ${b.confirmed}/${b.analyzed} signed`}>
                    <div className="w-full rounded-t-[5px] bg-[var(--skeleton-bg)] relative" style={{ height: '100%' }}>
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-t-[5px] bg-[#007AFF]"
                        style={{ height: `${b.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 text-[11px] text-[var(--text-secondary)]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-[2px] bg-[#007AFF]" /> Signed {totals.slides - totals.pending}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-[2px] bg-[var(--skeleton-bg)] border border-[var(--border-subtle)]" /> Pending {totals.pending}
                </span>
              </div>
            </div>

            {/* The one accent card — deliberately the only saturated surface on
                the page, so the eye lands on the outstanding work first. */}
            <div className="rounded-[16px] p-5 flex flex-col justify-between" style={{ background: 'linear-gradient(145deg, #007AFF 0%, #0A63D6 100%)' }}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-white/95">Needs a pathologist</p>
                  <span className="text-[10px] font-medium text-white/80 bg-white/15 rounded-full px-2 py-0.5">
                    {totals.active} active
                  </span>
                </div>
                <p className="text-[38px] font-semibold text-white leading-none tabular-nums mt-3">
                  {totals.pending}
                </p>
                <p className="text-[12px] text-white/85 leading-relaxed mt-2">
                  {totals.pending > 0
                    ? 'Analysed slides become part of the record only once a qualified pathologist confirms or corrects the grade.'
                    : 'No slides are waiting. Every analysed slide carries a signature.'}
                </p>
              </div>
              {firstPendingTrial && (
                <button
                  onClick={() => router.push(`/dashboard/trials/${firstPendingTrial.id}`)}
                  className="mt-4 self-start inline-flex items-center gap-1.5 text-[12px] font-medium text-[#007AFF] bg-white rounded-full px-3.5 py-1.5 hover:bg-white/90 transition-colors"
                >
                  Open {firstPendingTrial.name} <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Portfolio split */}
            <div className="rounded-[16px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] p-5">
              <p className="text-[13px] font-semibold mb-4">Portfolio</p>
              <div className="space-y-3">
                <PortfolioRow label="Trials" value={totals.trials} />
                <PortfolioRow label="Active" value={totals.active} accent="#34C759" />
                <PortfolioRow label="Closed" value={totals.trials - totals.active} />
                <PortfolioRow label="Open queries" value={totalOpenQueries} accent={totalOpenQueries > 0 ? '#FF9500' : undefined} />
              </div>
            </div>
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
          {/* Search + status filter */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by trial, sponsor, drug, or indication…"
                className="w-full pl-9 pr-3 py-2 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]"
              />
            </div>
            <div className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--skeleton-bg)]">
              {(['all', 'active', 'closed'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={
                    'px-3 py-1.5 rounded-[8px] text-[12px] font-medium capitalize transition-colors ' +
                    (statusFilter === s
                      ? 'bg-[var(--bg-card-solid)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]')
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {visibleTrials.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching trials"
              subtitle="Try a different search term or status filter."
            />
          ) : (
          <Card size="sm" className="overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--skeleton-bg)]">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Trial</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Indication</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Sites</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] text-right">Patients</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] text-right">Slides</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] text-right">Confirmed</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] w-[120px]">Progress</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrials.map((trial) => (
                  <tr
                    key={trial.id}
                    className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--skeleton-bg)] transition-colors cursor-pointer"
                    onClick={() => router.push(`/dashboard/trials/${trial.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold">{trial.name}</p>
                        {trial.phase && (
                          <span className="text-[10px] font-medium text-[var(--text-secondary)] bg-[var(--skeleton-bg)] rounded-full px-2 py-0.5 whitespace-nowrap">
                            {trial.phase}
                          </span>
                        )}
                      </div>
                      {/* The registry ID is the trial's real identifier, so it
                          sits with the name rather than being captured and
                          never shown. */}
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {trial.protocol_id ? `${trial.protocol_id} · ` : ''}{trial.sponsor} · {trial.drug}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">{trial.indication}</td>
                    <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">
                      {trial.sites && trial.sites.length > 0 ? `${trial.sites.length} site${trial.sites.length > 1 ? 's' : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-[13px] font-medium text-right tabular-nums">{trial.patient_count}</td>
                    <td className="px-4 py-3 text-[13px] font-medium text-right tabular-nums">{trial.slides_analyzed}</td>
                    <td className="px-4 py-3 text-[13px] font-medium text-right tabular-nums" style={{ color: '#34C759' }}>{trial.slides_confirmed}</td>
                    <td className="px-4 py-3">
                      <div className="h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#007AFF]"
                          style={{ width: `${trial.slides_analyzed > 0 ? (trial.slides_confirmed / trial.slides_analyzed) * 100 : 0}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Pill accent={trial.status === 'active' ? 'green' : 'gray'}>{trial.status}</Pill>
                        {!!openQueries[trial.id] && (
                          <Pill accent="orange">{openQueries[trial.id]} {openQueries[trial.id] === 1 ? 'query' : 'queries'}</Pill>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="View Patients"
                          className="p-1.5 rounded-[6px] hover:bg-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/trials/${trial.id}`); }}
                        >
                          <Users className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Export Corrections"
                          className="p-1.5 rounded-[6px] hover:bg-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          onClick={(e) => { e.stopPropagation(); exportCorrections(trial.id, trial.name); }}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {writable && (
                          <button
                            title={trial.status === 'closed' ? 'Reopen Trial' : 'Close Trial'}
                            className="p-1.5 rounded-[6px] hover:bg-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTrialStatus(trial.id, trial.name, trial.status === 'closed' ? 'active' : 'closed');
                            }}
                          >
                            {trial.status === 'closed'
                              ? <RotateCcw className="w-3.5 h-3.5" />
                              : <Archive className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {writable && <button
                          title="Delete"
                          className="p-1.5 rounded-[6px] hover:bg-[#FF3B30]/10 text-[var(--text-secondary)] hover:text-[#FF3B30] transition-colors"
                          onClick={(e) => { e.stopPropagation(); deleteTrial(trial.id, trial.name); }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
          </Card>
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
function NavPill({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        'px-3.5 py-1.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ' +
        (active
          ? 'bg-[#007AFF] text-white'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--skeleton-bg)]')
      }
    >
      {label}
    </button>
  );
}

/** A single headline figure in the greeting strip. */
function Metric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="min-w-[92px]">
      <p className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap">{label}</p>
      <p className="text-[24px] font-semibold tabular-nums leading-tight mt-0.5" style={{ color: accent }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function Divider() {
  return <div className="w-px self-stretch bg-[var(--border-subtle)]" aria-hidden="true" />;
}

function PortfolioRow({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums" style={{ color: accent }}>{value}</span>
    </div>
  );
}
