'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Zap, Database, GraduationCap,
  Play, Square, CheckCircle2, AlertTriangle, FlaskConical, Info, History,
} from 'lucide-react';
import { Card, Button, Pill, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';

interface Hardware {
  os: string; arch: string; cpu_name: string;
  cpu_cores_logical: number; cpu_cores_performance: number | null;
  ram_gb: number | null; gpu_name: string; gpu_cores: number | null;
  accelerator: string; free_disk_gb: number | null;
}
interface Profile {
  tier: 'workstation' | 'capable' | 'limited' | 'insufficient';
  label: string; summary: string;
  tile_size: number; batch_size: number; epochs: number;
  precision: string; notes: string[];
}
interface Dataset {
  total_slides: number; usable_examples: number; corrections: number;
  agreements: number; minimum_required: number; ready: boolean;
  per_trial: { trial: string; examples: number; corrections: number }[];
}
interface Estimate { total_tiles: number; estimated_human: string; tiles_per_slide: number; }
interface Run {
  id: string; state: string; epoch: number; epochs_total: number;
  progress: number; loss: number | null; accuracy: number | null;
  eta_seconds: number | null; message: string; examples: number;
  started_by?: string; started_at?: string; finished_at?: string;
  simulated?: boolean;
  history?: { epoch: number; loss: number; accuracy: number }[];
}
interface Readiness {
  hardware: Hardware; profile: Profile; dataset: Dataset;
  estimate: Estimate; active_run: Run | null;
}

const TIER_ACCENT: Record<Profile['tier'], 'green' | 'blue' | 'orange' | 'red'> = {
  workstation: 'green', capable: 'blue', limited: 'orange', insufficient: 'red',
};

function humanEta(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds <= 0) return 'finishing';
  if (seconds < 60) return `${seconds}s remaining`;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  if (m < 60) return `${m}m ${s}s remaining`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m remaining`;
}

/** Small sparkline of the loss curve so the run is legible at a glance. */
function LossChart({ history }: { history: { epoch: number; loss: number; accuracy: number }[] }) {
  if (history.length < 2) return null;
  const w = 100, h = 34;
  const losses = history.map(p => p.loss);
  const max = Math.max(...losses), min = Math.min(...losses);
  const span = max - min || 1;
  const pts = history.map((p, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((p.loss - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1.5">
        Training loss
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[42px]" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#007AFF" strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function TrainingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const writable = canWrite(user?.role);

  const [data, setData] = useState<Readiness | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [rd, hist] = await Promise.all([
        apiFetch('/api/training/readiness').then(r => r.json()),
        apiFetch('/api/training/runs').then(r => r.json()),
      ]);
      setData(rd);
      setRun(rd.active_run);
      setRuns(Array.isArray(hist) ? hist : []);
    } catch (e) {
      console.error('Failed to load training info', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll only while a run is active, so an idle page costs nothing.
  useEffect(() => {
    const active = run?.state === 'running';
    if (active && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await apiFetch('/api/training/status').then(r => r.json());
          setRun(s.state === 'idle' ? null : s);
          if (s.state && s.state !== 'running') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            loadAll();
            if (s.state === 'completed') toast.show('Training run complete', 'success');
            if (s.state === 'cancelled') toast.show('Training cancelled', 'info');
            if (s.state === 'failed') toast.show(`Training failed: ${s.message}`, 'error');
          }
        } catch { /* transient poll failure is fine */ }
      }, 1000);
    }
    if (!active && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [run?.state, loadAll, toast]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await apiSend('/api/training/start', { method: 'POST' });
      setRun(r);
      toast.show('Training started');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not start training', 'error');
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await apiSend('/api/training/cancel', { method: 'POST' });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not cancel', 'error');
    } finally { setBusy(false); }
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
        <div className="border-b border-[var(--border-subtle)] px-6 py-3.5 bg-[var(--bg-card-solid)]">
          <div className="w-44 h-3.5 rounded-[4px] skeleton-shimmer mb-1.5" />
          <div className="w-64 h-2.5 rounded-[4px] skeleton-shimmer" />
        </div>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <Card size="sm" className="overflow-hidden"><TableSkeleton rows={4} columns={4} /></Card>
        </div>
      </div>
    );
  }

  const { hardware: hw, profile, dataset, estimate } = data;
  const active = run?.state === 'running';
  const pct = Math.round((run?.progress ?? 0) * 100);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      <div className="border-b border-[var(--border-subtle)] px-6 py-3.5 flex items-center gap-3 bg-[var(--bg-card-solid)]">
        <button onClick={() => router.push('/dashboard')} className="p-1.5 rounded-[8px] hover:bg-[var(--skeleton-bg)]">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-[15px] font-semibold">Model Training</h1>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Fine-tune the grading model on your own reviewed slides
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* What this is — knowledge first, so the page is self-explanatory */}
        <Card size="sm" className="p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[#007AFF]/10 flex items-center justify-center shrink-0">
              <GraduationCap className="w-[18px] h-[18px] text-[#007AFF]" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold">What training does</h2>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Every slide you <strong className="text-[var(--text-primary)]">Confirm</strong> or{' '}
                <strong className="text-[var(--text-primary)]">Correct</strong> becomes a labelled
                example. Fine-tuning adapts the grading model to your scanner, your stain protocol,
                and your reporting conventions — the cases where a general-purpose model most often
                disagrees with a local pathologist. Corrections are the most valuable examples,
                because they teach the model where it was wrong.
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-2 leading-relaxed">
                Training runs entirely on this machine. No slide or patient data leaves the device.
              </p>
            </div>
          </div>
        </Card>

        {run?.simulated !== false && (
          <div className="rounded-[10px] border border-[#FF9500]/30 bg-[#FF9500]/[0.06] p-4">
            <div className="flex items-start gap-3">
              <FlaskConical className="w-4 h-4 text-[#FF9500] shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-semibold text-[#FF9500]">Prototype — training is simulated</p>
                <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                  Hardware detection, dataset readiness, and time estimates below are real. The
                  optimisation loop itself is simulated and updates no model weights, because the
                  grading model has not been integrated yet. Everything around it is production code.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Hardware */}
        <Card size="sm" className="p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-[13px] font-semibold">This machine</h2>
            <Pill accent={TIER_ACCENT[profile.tier]}>{profile.label}</Pill>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Cpu, label: 'Processor', value: hw.cpu_name,
                sub: `${hw.cpu_cores_logical} cores${hw.cpu_cores_performance ? ` · ${hw.cpu_cores_performance} performance` : ''}` },
              { icon: MemoryStick, label: 'Memory', value: hw.ram_gb ? `${hw.ram_gb} GB` : 'Unknown', sub: hw.os },
              { icon: Zap, label: 'Accelerator', value: hw.accelerator,
                sub: hw.gpu_name ? `${hw.gpu_name}${hw.gpu_cores ? ` · ${hw.gpu_cores} GPU cores` : ''}` : 'No discrete GPU' },
              { icon: HardDrive, label: 'Free disk', value: hw.free_disk_gb ? `${hw.free_disk_gb} GB` : 'Unknown',
                sub: 'Checkpoints need ~5–10 GB' },
            ].map((s) => (
              <div key={s.label} className="rounded-[10px] border border-[var(--border-subtle)] px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <s.icon className="w-3 h-3 text-[var(--text-secondary)]" />
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{s.label}</p>
                </div>
                <p className="text-[13px] font-semibold leading-tight">{s.value}</p>
                <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 leading-snug">{s.sub}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-[var(--text-secondary)] mt-3">{profile.summary}</p>
          {profile.notes.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {profile.notes.map((n) => (
                <div key={n} className="flex items-start gap-2">
                  <AlertTriangle className="w-3 h-3 text-[#FF9500] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[var(--text-secondary)]">{n}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Dataset + recommended settings */}
        <div className="grid md:grid-cols-2 gap-5">
          <Card size="sm" className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <h2 className="text-[13px] font-semibold">Training data</h2>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Usable</p>
                <p className="text-[20px] font-bold tabular-nums">{dataset.usable_examples}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Corrections</p>
                <p className="text-[20px] font-bold tabular-nums" style={{ color: '#FF9500' }}>{dataset.corrections}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Agreements</p>
                <p className="text-[20px] font-bold tabular-nums">{dataset.agreements}</p>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (dataset.usable_examples / dataset.minimum_required) * 100)}%`,
                  background: dataset.ready ? '#34C759' : '#FF9500',
                }}
              />
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] mt-2">
              {dataset.ready
                ? `Ready to train — minimum of ${dataset.minimum_required} reviewed slides met.`
                : `${dataset.minimum_required - dataset.usable_examples} more reviewed slides needed (minimum ${dataset.minimum_required}). Fewer than that overfits instead of improving accuracy.`}
            </p>
          </Card>

          <Card size="sm" className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <h2 className="text-[13px] font-semibold">Recommended settings</h2>
            </div>
            <div className="space-y-2">
              {[
                ['Tile size', `${profile.tile_size} × ${profile.tile_size} px`, 'Slides are cut into tiles; larger tiles capture more architecture but need more memory.'],
                ['Batch size', String(profile.batch_size), 'Tiles processed at once. Chosen to fit your available memory.'],
                ['Epochs', String(profile.epochs), 'Full passes over the dataset.'],
                ['Precision', profile.precision, 'Mixed precision trains faster on supported accelerators.'],
              ].map(([k, v, why]) => (
                <div key={k} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-medium">{k}</p>
                    <p className="text-[10px] text-[var(--text-secondary)] leading-snug">{why}</p>
                  </div>
                  <p className="text-[12px] font-semibold tabular-nums whitespace-nowrap">{v}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Run control + live progress */}
        <Card size="sm" className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div>
              <h2 className="text-[13px] font-semibold">
                {active ? 'Training in progress' : 'Start a training run'}
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                {active
                  ? run?.message
                  : dataset.ready
                    ? `Estimated ${estimate.estimated_human} on this machine · ${estimate.total_tiles.toLocaleString()} tiles`
                    : 'Review more slides before training.'}
              </p>
            </div>
            {writable && (active ? (
              <Button variant="danger" size="sm" onClick={cancel} disabled={busy}>
                <Square className="w-3.5 h-3.5" /> Stop Training
              </Button>
            ) : (
              <Button size="sm" onClick={start} disabled={busy || !dataset.ready}>
                <Play className="w-3.5 h-3.5" /> Start Training
              </Button>
            ))}
          </div>

          {run && (
            <>
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-[var(--text-secondary)]">
                  Epoch {run.epoch} of {run.epochs_total}
                </span>
                <span className="tabular-nums font-medium">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: run.state === 'completed' ? '#34C759'
                      : run.state === 'failed' ? '#FF3B30' : '#007AFF',
                  }}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</p>
                  <p className="text-[13px] font-semibold capitalize flex items-center gap-1.5">
                    {run.state === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-[#34C759]" />}
                    {run.state}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Time left</p>
                  <p className="text-[13px] font-semibold">{active ? humanEta(run.eta_seconds) : '—'}</p>
                  {run.simulated !== false && (
                    <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                      Simulated run. On real training this machine would take ~{estimate.estimated_human}.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Loss</p>
                  <p className="text-[13px] font-semibold tabular-nums">{run.loss ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Accuracy</p>
                  <p className="text-[13px] font-semibold tabular-nums">
                    {run.accuracy != null ? `${(run.accuracy * 100).toFixed(1)}%` : '—'}
                  </p>
                </div>
              </div>
              {run.history && run.history.length > 1 && (
                <div className="mt-4"><LossChart history={run.history} /></div>
              )}
            </>
          )}
        </Card>

        {/* History */}
        {runs.length > 0 && (
          <Card size="sm" className="overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
              <History className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <h2 className="text-[13px] font-semibold">Previous runs</h2>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--skeleton-bg)] border-b border-[var(--border-subtle)]">
                  {['Started', 'By', 'Examples', 'Epochs', 'Final loss', 'Accuracy', 'Result'].map(h => (
                    <th key={h} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="px-4 py-2.5 text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                      {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[12px]">{r.started_by || '—'}</td>
                    <td className="px-4 py-2.5 text-[12px] tabular-nums">{r.examples}</td>
                    <td className="px-4 py-2.5 text-[12px] tabular-nums">{r.epoch}/{r.epochs_total}</td>
                    <td className="px-4 py-2.5 text-[12px] tabular-nums">{r.loss ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[12px] tabular-nums">
                      {r.accuracy != null ? `${(r.accuracy * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill accent={r.state === 'completed' ? 'green' : r.state === 'failed' ? 'red' : 'gray'}>
                        {r.state}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
