'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, ScrollText, Filter } from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import AppBar from '../components/AppBar';

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
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Signed In',
  logout: 'Signed Out',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  deactivate: 'Deactivated',
  analyze: 'AI Analysis Run',
  train_start: 'Model Training Started',
  train_cancel: 'Model Training Cancelled',
  sign_confirm: 'E-Signed — Confirmed',
  sign_correct: 'E-Signed — Corrected',
  raise_query: 'Raised Query',
  respond_query: 'Responded to Query',
  close_query: 'Closed Query',
  reopen_query: 'Reopened Query',
};

export default function AuditPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const toast = useToast();

  const load = async () => {
    try {
      const res = await apiFetch('/api/audit/');
      if (res.status === 403) {
        router.push('/dashboard');
        return;
      }
      setEvents(await res.json());
    } catch (e) {
      console.error('Failed to load audit trail', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    try {
      const res = await apiFetch('/api/audit/export-csv');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audit_trail.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.show('Audit trail exported');
    } catch {
      toast.show('Failed to export audit trail', 'error');
    }
  };

  const filtered = actionFilter ? events.filter(e => e.action === actionFilter) : events;
  const actions = Array.from(new Set(events.map(e => e.action))).sort();

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      <AppBar />
        <div className="titlebar-inset border-b border-[var(--border-subtle)] pr-6 py-3.5 flex items-center justify-between bg-[var(--bg-card-solid)]">
          <div className="space-y-1.5">
            <div className="w-32 h-3.5 rounded-[4px] skeleton-shimmer" />
            <div className="w-64 h-2.5 rounded-[4px] skeleton-shimmer" />
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 py-6">
          <Card size="sm" className="overflow-hidden">
            <TableSkeleton rows={6} columns={5} />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      <div className="titlebar-inset border-b border-[var(--border-subtle)] pr-6 py-3.5 flex items-center justify-between bg-[var(--bg-card-solid)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="p-1.5 rounded-[8px] hover:bg-[var(--skeleton-bg)]">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-[15px] font-semibold">Audit Trail</h1>
            <p className="text-[11px] text-[var(--text-secondary)]">Immutable record of every action — 21 CFR Part 11</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Filter className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-[8px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[12px]"
            >
              <option value="">All actions</option>
              {actions.map(a => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
            </select>
          </div>
          <Button size="sm" variant="secondary" onClick={exportCsv}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {filtered.length === 0 ? (
          <EmptyState icon={ScrollText} title="No events recorded yet" />
        ) : (
          <Card size="sm" className="overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--skeleton-bg)]">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Timestamp</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">User</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Action</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Entity</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--skeleton-bg)] transition-colors">
                    <td className="px-4 py-2.5 text-[11px] text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-medium">{e.username}</td>
                    <td className="px-4 py-2.5 text-[12px]">{ACTION_LABELS[e.action] || e.action}</td>
                    <td className="px-4 py-2.5 text-[11px] text-[var(--text-secondary)] font-mono">{e.entity_type} · {e.entity_id}</td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--text-secondary)] max-w-[320px] truncate">{e.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
          </Card>
        )}
      </div>
    </div>
  );
}
