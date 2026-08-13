'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FlaskConical, Users, Download, Trash2, ShieldCheck, ScrollText, LogOut, ChevronDown, Search, Archive, RotateCcw, BookOpen, GraduationCap } from 'lucide-react';
import { Card, Button, BrandMark, Pill, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth, canWrite, ROLE_LABELS } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';
import { useOnboarding } from '@/lib/onboarding';

interface Trial {
  id: string;
  name: string;
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
  const [form, setForm] = useState({ name: '', sponsor: '', drug: '', indication: '', notes: '', sites: '' });
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

  const createTrial = async () => {
    if (!form.name || !form.sponsor || !form.drug) return;
    try {
      const sites = form.sites.split(',').map(s => s.trim()).filter(Boolean);
      await apiSend('/api/trials/', {
        method: 'POST',
        body: JSON.stringify({ ...form, sites }),
      });
      setShowCreate(false);
      setForm({ name: '', sponsor: '', drug: '', indication: '', notes: '', sites: '' });
      loadTrials();
      toast.show(`Trial "${form.name}" created`);
    } catch (e) {
      console.error('Failed to create trial', e);
      toast.show(e instanceof Error ? e.message : 'Failed to create trial', 'error');
    }
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
    return [t.name, t.sponsor, t.drug, t.indication]
      .some((f) => (f || '').toLowerCase().includes(q));
  });

  const totals = {
    trials: trials.length,
    active: trials.filter((t) => t.status === 'active').length,
    patients: trials.reduce((n, t) => n + (t.patient_count || 0), 0),
    slides: trials.reduce((n, t) => n + (t.slides_analyzed || 0), 0),
    pending: trials.reduce((n, t) => n + Math.max(0, (t.slides_analyzed || 0) - (t.slides_confirmed || 0)), 0),
  };

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
      <div className="border-b border-[var(--border-subtle)] px-6 py-3.5 flex items-center justify-between bg-[var(--bg-card-solid)]">
        <div className="flex items-center gap-3">
          <BrandMark size={32} />
          <div>
            <h1 className="text-[15px] font-semibold">Omnia Pathology AI</h1>
            <p className="text-[11px] text-[var(--text-secondary)]">Clinical Trial Pathology Suite — Research Use Only</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
                  {(user?.role === 'admin' || user?.role === 'pathologist') && (
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

      {/* Trial List */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {trials.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="No trials yet"
            subtitle={writable ? 'Create your first clinical trial to get started.' : 'No trials have been created yet.'}
            action={writable ? <Button size="lg" onClick={() => setShowCreate(true)}>Create Trial</Button> : undefined}
          />
        ) : (
          <>
          {/* Portfolio summary — the numbers a coordinator checks first */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {[
              { label: 'Trials', value: totals.trials },
              { label: 'Active', value: totals.active },
              { label: 'Patients', value: totals.patients },
              { label: 'Slides', value: totals.slides },
              { label: 'Awaiting Review', value: totals.pending, accent: totals.pending > 0 ? '#FF9500' : undefined },
            ].map((s) => (
              <Card key={s.label} size="sm" className="px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{s.label}</p>
                <p className="text-[20px] font-bold tabular-nums mt-0.5" style={{ color: s.accent }}>{s.value}</p>
              </Card>
            ))}
          </div>

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
            <table className="w-full text-left border-collapse">
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
                      <p className="text-[13px] font-semibold">{trial.name}</p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{trial.sponsor} · {trial.drug}</p>
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
          </Card>
          )}
          </>
        )}
      </div>

      {/* Create Trial Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowCreate(false)}>
          <Card size="lg" className="w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold mb-4">Create New Trial</h2>
            <div className="space-y-3">
              <input
                placeholder="Trial name (e.g. ALK-427)"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <input
                placeholder="Sponsor (e.g. Roche)"
                value={form.sponsor}
                onChange={e => setForm({ ...form, sponsor: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <input
                placeholder="Drug (e.g. Tecentriq)"
                value={form.drug}
                onChange={e => setForm({ ...form, drug: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <input
                placeholder="Indication (e.g. Lung Cancer)"
                value={form.indication}
                onChange={e => setForm({ ...form, indication: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <input
                placeholder="Sites (comma-separated, e.g. Site A - Boston, Site B - Chicago)"
                value={form.sites}
                onChange={e => setForm({ ...form, sites: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <textarea
                placeholder="Notes (optional)"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] resize-none h-20"
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={createTrial}>Create Trial</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
