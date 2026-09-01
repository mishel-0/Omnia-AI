'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Zap, Database, GraduationCap,
  Play, Square, CheckCircle2, AlertTriangle, FlaskConical, Info, History, ShieldCheck,
} from 'lucide-react';
import { Card, Button, Pill, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';
import NetworkPanel from './NetworkPanel';
import AppBar from '../components/AppBar';

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
  progress: number; loss: number | null;
  /** Agreement with the pathologist on held-out slides (quadratic weighted kappa). */
  qwk?: number | null;
  eta_seconds: number | null; message: string; examples: number;
  started_by?: string; started_at?: string; finished_at?: string;
  /** Whether this run's result actually replaced the model in use. A run can
   *  finish successfully and still not be promoted, if it did not improve. */
  promoted?: boolean | null;
  baseline_qwk?: number | null;
  finetuned_qwk?: number | null;
  train_size?: number; val_size?: number; best_epoch?: number;
  history?: { epoch: number; loss: number; qwk: number }[];
}

interface ActiveModel {
  source: 'shipped' | 'finetuned';
  description: string;
  qwk?: number | null;
  baseline_qwk?: number | null;
  examples_used?: number | null;
  activated?: string | null;
}
interface Readiness {
  hardware: Hardware; profile: Profile; dataset: Dataset;
  estimate: Estimate; active_run: Run | null;
}


/** A small "?" that reveals a plain-language explanation on hover or focus.
 *
 * The audience for this screen is a pathologist, not an ML engineer. Terms
 * like epoch, held-out set and kappa are unavoidable — they are what the
 * numbers mean — so each one carries its definition next to it rather than
 * assuming the reader already has it.
 */
function InfoDot({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle">
      <button
        type="button"
        aria-label={text}
        className="w-[13px] h-[13px] rounded-full border border-[var(--border-medium)] text-[9px] leading-none font-semibold text-[var(--text-secondary)] flex items-center justify-center hover:border-[var(--accent)] hover:text-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-colors"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+7px)] w-[260px] rounded-[10px] bg-[var(--bg-card-solid)] border border-[var(--border-medium)] shadow-xl px-3 py-2 text-[11px] leading-relaxed font-normal normal-case tracking-normal text-[var(--text-primary)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50"
      >
        {text}
      </span>
    </span>
  );
}

/** Mirrors TILE in backend/grading_model.py — the model's fixed input size. */
const TILE_PX = 128;

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
function LossChart({ history }: { history: { epoch: number; loss: number; qwk: number }[] }) {
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
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function TrainingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { confirm } = useDialogs();
  const writable = canWrite(user?.role);

  const [data, setData] = useState<Readiness | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [rd, hist, model] = await Promise.all([
        apiFetch('/api/training/readiness').then(r => r.json()),
        apiFetch('/api/training/runs').then(r => r.json()),
        apiFetch('/api/training/model').then(r => r.json()),
      ]);
      setData(rd);
      setRun(rd.active_run);
      setRuns(Array.isArray(hist) ? hist : []);
      setActiveModel(model);
    } catch (e) {
      console.error('Failed to load training info', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const revertModel = async () => {
    const ok = await confirm({
      title: 'Use the supplied model?',
      message: 'Grading will go back to the model Omnia shipped with. Your fine-tuned model is kept on file and is not deleted, so you can run training again at any time.',
      confirmLabel: 'Use supplied model',
    });
    if (!ok) return;
    try {
      setActiveModel(await apiSend('/api/training/model/revert', { method: 'POST' }));
      toast.show('Now grading with the supplied model');
      loadAll();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not switch models', 'error');
    }
  };

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
        <AppBar />
        <div className="titlebar-inset border-b border-[var(--border-subtle)] pr-6 py-3.5 bg-[var(--bg-card-solid)]">
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
      <AppBar />
      <div className="titlebar-inset border-b border-[var(--border-subtle)] pr-6 py-3.5 flex items-center gap-3 bg-[var(--bg-card-solid)]">
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
        {/* Which model is grading right now. This is the first thing a
            pathologist needs from this screen — not the hardware, not the
            history — because it determines how to read every result the app
            has produced. */}
        <Card size="sm" className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-[#34C759]/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-[18px] h-[18px] text-[#34C759]" />
              </div>
              <div>
                <h2 className="text-[14px] font-semibold flex items-center gap-1.5">
                  Model in use now
                  <InfoDot text="The grading model every slide analysis currently runs through. Training does not change this unless the result is measurably better than what you have." />
                </h2>
                {activeModel ? (
                  <>
                    <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed max-w-[560px]">
                      {activeModel.description}
                    </p>
                    {activeModel.source === 'finetuned' && (
                      <p className="text-[11.5px] text-[var(--text-secondary)] mt-2 leading-relaxed">
                        Agreement with your pathologists on slides it was not trained on:{' '}
                        <strong className="text-[var(--text-primary)] tabular-nums">
                          {activeModel.qwk?.toFixed(3) ?? '—'}
                        </strong>
                        {activeModel.baseline_qwk != null && (
                          <> (the supplied model scored <span className="tabular-nums">{activeModel.baseline_qwk.toFixed(3)}</span> on the same slides)</>
                        )}
                        {activeModel.examples_used ? <> · built from {activeModel.examples_used} reviewed slides</> : null}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1.5">Checking…</p>
                )}
              </div>
            </div>
            {activeModel?.source === 'finetuned' && writable && (
              <Button size="sm" variant="secondary" onClick={revertModel}>
                Use the supplied model
              </Button>
            )}
          </div>
        </Card>

        {/* What this is — knowledge first, so the page is self-explanatory */}
        <Card size="sm" className="p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
              <GraduationCap className="w-[18px] h-[18px] text-[var(--accent)]" />
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

              {/* The safeguard, in the words a clinician would use to decide
                  whether to trust the feature at all. */}
              <div className="mt-3.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-3">
                <p className="text-[12px] font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#34C759]" />
                  Training can only improve grading, never quietly worsen it
                </p>
                <p className="text-[11.5px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                  Omnia trains on part of your signed slides and then tests the result on the rest —
                  slides the new model has never seen. The new model replaces the one in use{' '}
                  <strong className="text-[var(--text-primary)]">only if it matches your
                  pathologists more closely</strong> than the current one on those held-back slides.
                  If it does not, the run is recorded and the result is discarded. You can also
                  return to the supplied model at any time.
                </p>
              </div>

              <div className="mt-3 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-3">
                <p className="text-[12px] font-semibold">What training does not change</p>
                <p className="text-[11.5px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                  Omnia adapts how the model weighs and scores what it sees. It does not rebuild the
                  model&rsquo;s underlying image recognition, which was trained on many thousands of
                  slides — a few dozen local slides are not enough to redo that safely, and
                  attempting it would make grading worse rather than better. Every grade still
                  requires a pathologist&rsquo;s signature before it becomes part of the record.
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Federated network — send this device's fine-tune to be merged
            with other sites' corrections, never their raw data. */}
        <NetworkPanel />

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
                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1">
                  Usable <InfoDot text="Slides a pathologist has signed off, either by confirming the model's grade or by correcting it. Only signed slides can be used as teaching examples, because only they carry a grade a person stands behind." />
                </p>
                <p className="text-[20px] font-bold tabular-nums">{dataset.usable_examples}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1">
                  Corrections <InfoDot text="Slides where the pathologist disagreed with the model and entered a different grade. These are the most informative examples: they show exactly where the model is currently wrong." />
                </p>
                <p className="text-[20px] font-bold tabular-nums" style={{ color: '#FF9500' }}>{dataset.corrections}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1">
                  Agreements <InfoDot text="Slides where the pathologist accepted the model's grade unchanged. These matter too — they teach the model to keep getting right what it already gets right." />
                </p>
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
              {/* These are the settings the run will ACTUALLY use. The panel
                  previously advertised a tile size and batch size taken from a
                  generic hardware profile, neither of which the real
                  fine-tuning path reads — tile size is fixed by the model's
                  architecture, and batch size is derived from how many slides
                  you have. Showing settings that have no effect is worse than
                  showing none. */}
              <h2 className="text-[13px] font-semibold">How this run will be configured</h2>
            </div>
            <div className="space-y-2">
              {[
                ['Epochs', String(profile.epochs), 'How many times the model reviews the whole set of signed slides. More passes let it learn more, up to the point where it starts memorising instead.'],
                ['Held back for testing', '30%', 'The share of your signed slides kept aside to check the result. These are never trained on, so they are an honest test of whether the model improved.'],
                ['Tile size', `${TILE_PX} × ${TILE_PX} px`, 'Fixed by the model itself — this is the size it was built to read, so it is not adjustable.'],
                ['Batch size', 'Chosen automatically', 'Set from how many slides you have, so small datasets still train stably.'],
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
                      : run.state === 'failed' ? '#FF3B30' : 'var(--accent)',
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
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1">
                    Loss <InfoDot text="How far the model's answers are from the pathologist's during training. It should fall as a run progresses. It is a training diagnostic only — judge the result by Agreement, not by this." />
                  </p>
                  <p className="text-[13px] font-semibold tabular-nums">{run.loss ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] flex items-center gap-1">
                    Agreement <InfoDot text="How closely the model's grades match your pathologists' grades on slides it was not trained on. 1.00 is perfect agreement; 0 is no better than chance. Measured with quadratic weighted kappa, the standard measure for grading scales." />
                  </p>
                  <p className="text-[13px] font-semibold tabular-nums">
                    {run.qwk != null ? run.qwk.toFixed(3) : '—'}
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
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-[var(--skeleton-bg)] border-b border-[var(--border-subtle)]">
                  {['Started', 'By', 'Examples', 'Epochs', 'Final loss', 'Agreement', 'Model', 'Result'].map(h => (
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
                      {r.finetuned_qwk != null ? r.finetuned_qwk.toFixed(3) : r.qwk != null ? r.qwk.toFixed(3) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Whether the model actually changed. A completed run
                          that was not promoted must not read as an update. */}
                      {r.promoted === true
                        ? <Pill accent="green">Model updated</Pill>
                        : r.promoted === false
                          ? <Pill accent="gray">No change</Pill>
                          : <span className="text-[11px] text-[var(--text-secondary)]">—</span>}
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
              </div>
          </Card>
        )}
      </div>
    </div>
  );
}
