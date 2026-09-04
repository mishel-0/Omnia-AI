'use client';

/**
 * Batch analysis for a whole trial.
 *
 * Analysing slides one click at a time is fine for a case under review and
 * hopeless for a cohort — a sponsor handing over 1,500 subjects is tens of
 * thousands of slides. This queues the trial's unanalysed slides and reports
 * real progress while the backend works through them, one at a time, behind
 * the interactive path.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layers, Play, Square, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { apiFetch, apiSend } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';

interface Job {
  id: string;
  trial_id: string;
  created_by: string;
  created_at: string;
  finished_at: string | null;
  cancelled: boolean;
  total: number;
  counts: { pending: number; running: number; done: number; failed: number; skipped: number };
  progress: number;
  state: 'queued' | 'running' | 'finished';
  items?: { label: string; status: string; error: string }[];
}

export default function BatchPanel({ trialId, onFinished }: {
  trialId: string;
  onFinished: () => void;
}) {
  const toast = useToast();
  const { confirm } = useDialogs();
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Fires onFinished exactly once per run. Without this the completion poll
  // reloads the trial on every subsequent tick while the finished job is
  // still the most recent one.
  const notifiedRef = useRef<string | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const jobs: Job[] = await apiFetch('/api/batch/jobs').then(r => r.json());
      const mine = jobs.find(j => j.trial_id === trialId);
      if (!mine) return setJob(null);
      const full: Job = await apiFetch(`/api/batch/jobs/${mine.id}`).then(r => r.json());
      setJob(full);
      if (full.state === 'finished' && notifiedRef.current !== full.id) {
        notifiedRef.current = full.id;
        onFinished();
      }
    } catch { /* transient poll failure is fine */ }
  }, [trialId, onFinished]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  // Poll only while work is outstanding, so an idle trial page costs nothing.
  useEffect(() => {
    const live = job && job.state !== 'finished';
    if (live && !pollRef.current) {
      pollRef.current = setInterval(loadLatest, 2000);
    }
    if (!live && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [job, loadLatest]);

  const start = async () => {
    setBusy(true);
    try {
      const created: Job = await apiSend('/api/batch/trial', {
        method: 'POST',
        body: JSON.stringify({ trial_id: trialId }),
      });
      notifiedRef.current = null;
      toast.show(`Queued ${created.total} slide${created.total === 1 ? '' : 's'} for analysis`);
      loadLatest();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not queue this trial', 'error');
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!job) return;
    const ok = await confirm({
      title: 'Stop this batch?',
      message: 'Slides not yet started will be skipped. The slide currently being '
        + 'analysed finishes first — stopping mid-analysis would leave its record '
        + 'half-written. Already-analysed slides keep their results.',
      confirmLabel: 'Stop batch',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiSend(`/api/batch/jobs/${job.id}/cancel`, { method: 'POST' });
      loadLatest();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not stop the batch', 'error');
    }
  };

  const live = job && job.state !== 'finished';
  const pct = job ? Math.round(job.progress * 100) : 0;
  const failures = job?.items?.filter(i => i.status === 'failed') ?? [];

  return (
    <Card size="sm" className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
            <Layers className="w-[18px] h-[18px] text-[var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold">Analyse the whole trial</h2>
            <p className="text-[12px] text-[var(--text-secondary)] mt-1 leading-relaxed max-w-[520px]">
              Queues every slide that has not been analysed yet. Signed slides are never
              re-analysed. This runs behind interactive work, so you can keep reviewing
              cases while it goes — and it resumes on its own if the app restarts.
            </p>
          </div>
        </div>
        {live ? (
          <Button size="sm" variant="danger" onClick={cancel}>
            <Square className="w-3.5 h-3.5" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={start} disabled={busy}>
            <Play className="w-3.5 h-3.5" /> Analyse all
          </Button>
        )}
      </div>

      {job && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11.5px] mb-1.5">
            <span className="text-[var(--text-secondary)]">
              {job.state === 'finished'
                ? job.cancelled ? 'Stopped' : 'Complete'
                : `${job.counts.done + job.counts.failed + job.counts.skipped} of ${job.total}`}
            </span>
            <span className="tabular-nums font-medium">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${pct}%`,
                background: job.counts.failed > 0 ? '#FF9500' : 'var(--accent)',
              }}
            />
          </div>

          <div className="flex items-center gap-4 mt-3 flex-wrap text-[11.5px]">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#34C759]" />
              <span className="tabular-nums font-medium">{job.counts.done}</span>
              <span className="text-[var(--text-secondary)]">analysed</span>
            </span>
            {job.counts.failed > 0 && (
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-[#FF9500]" />
                <span className="tabular-nums font-medium">{job.counts.failed}</span>
                <span className="text-[var(--text-secondary)]">failed</span>
              </span>
            )}
            {(job.counts.pending + job.counts.running) > 0 && (
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span className="tabular-nums font-medium">
                  {job.counts.pending + job.counts.running}
                </span>
                <span className="text-[var(--text-secondary)]">remaining</span>
              </span>
            )}
            {job.counts.skipped > 0 && (
              <span className="text-[var(--text-secondary)] tabular-nums">
                {job.counts.skipped} skipped
              </span>
            )}
          </div>

          {/* Failures are named, not just counted. "3 failed" with no way to
              see which three means re-checking the whole cohort by hand. */}
          {failures.length > 0 && (
            <div className="mt-3 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-2.5">
              <p className="text-[11px] font-semibold mb-1.5">
                Could not analyse {failures.length} slide{failures.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-1 max-h-[132px] overflow-y-auto custom-scrollbar">
                {failures.map((f, i) => (
                  <li key={i} className="text-[11px] text-[var(--text-secondary)] leading-snug">
                    <span className="text-[var(--text-primary)]">{f.label || 'Slide'}</span>
                    {f.error ? ` — ${f.error}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
