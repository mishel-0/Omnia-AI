'use client';

import React, { useEffect, useState } from 'react';
import { BarChart3, ChevronDown, ShieldCheck, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/auth';
import { Pill } from '@/components/ui';

interface ActionItem { priority: 'high' | 'medium' | 'low'; label: string; detail: string; }
interface SiteRow { site: string; slides: number; graded: number; signed: number; unsigned: number; }
interface Mover {
  patient_id: string; from_visit: string; to_visit: string;
  delta: number; direction: string; both_signed: boolean;
}
interface Insights {
  subject_count: number;
  graded_slide_count: number;
  signed_slide_count: number;
  unsigned_slide_count: number;
  grade_distribution: Record<string, number>;
  mean_confidence: number | null;
  low_confidence_count: number;
  trajectory_counts: Record<string, number>;
  subjects_with_paired_timepoints: number;
  significant_movers: Mover[];
  mean_attention_concentration: number | null;
  focal_count: number;
  diffuse_count: number;
  action_items: ActionItem[];
  scope_note: string;
  site_breakdown: SiteRow[];
  failed_analyses: { patient_id: string; visit: string; filename: string }[];
}

const PRIORITY: Record<string, 'red' | 'orange' | 'green'> = {
  high: 'red', medium: 'orange', low: 'green',
};

/** Trial-level analytics: cohort composition, trajectory spread, reviewer
 * workload and data readiness.
 *
 * Everything shown is computed from recorded grades, confidence, attention
 * and signature state. The scope note is rendered verbatim rather than
 * paraphrased — it is what keeps these figures from being read as evidence
 * about the drug itself. */
export function CohortInsights({ trialId }: { trialId: string }) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/trials/${trialId}/insights`);
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || 'Could not load insights');
        const j = await res.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load insights');
      }
    })();
    return () => { cancelled = true; };
  }, [trialId]);

  if (error) return null;      // analytics are supplementary; never block the page
  if (!data) return null;
  if (data.graded_slide_count === 0) return null;

  const maxGrade = Math.max(1, ...Object.values(data.grade_distribution));
  const t = data.trajectory_counts;

  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--skeleton-bg)] transition-colors text-left"
      >
        <span className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#007AFF]" />
          <span className="text-[13px] font-semibold">Cohort analytics</span>
          <span className="text-[10px] text-[var(--text-secondary)]">
            {data.subject_count} subject{data.subject_count === 1 ? '' : 's'} · {data.graded_slide_count} graded slides
          </span>
          {data.action_items.some(a => a.priority === 'high') && (
            <Pill accent="red" className="!text-[9px] !py-0.5">Action needed</Pill>
          )}
        </span>
        <ChevronDown className={'w-4 h-4 text-[var(--text-secondary)] transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Next actions</p>
            <div className="space-y-1.5">
              {data.action_items.map((a, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Pill accent={PRIORITY[a.priority]} className="!text-[9px] !py-0.5 shrink-0">{a.priority}</Pill>
                  <div>
                    <p className="text-[11.5px] font-medium">{a.label}</p>
                    <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{a.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Grade distribution</p>
              <div className="space-y-1">
                {Object.entries(data.grade_distribution).map(([g, n]) => (
                  <div key={g} className="flex items-center gap-2">
                    <span className="text-[10px] tabular-nums text-[var(--text-secondary)] w-8">GG {g}</span>
                    <div className="flex-1 h-3 rounded-[3px] bg-[var(--skeleton-bg)] overflow-hidden">
                      <div
                        className="h-full rounded-[3px]"
                        style={{
                          width: `${(n / maxGrade) * 100}%`,
                          background: Number(g) >= 4 ? '#FF3B30' : Number(g) >= 2 ? '#FF9500' : '#34C759',
                        }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums w-6 text-right">{n}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Subject trajectories</p>
              <div className="space-y-1 text-[11px]">
                <Row label="Grade rose" value={t.higher} color="#FF3B30" />
                <Row label="Grade fell" value={t.lower} color="#34C759" />
                <Row label="Unchanged" value={t.unchanged} />
                <Row label="Single timepoint only" value={t.single_timepoint} />
              </div>
              <p className="text-[9px] text-[var(--text-secondary)]/70 mt-2 leading-relaxed">
                {data.subjects_with_paired_timepoints} of {data.subject_count} subject
                {data.subject_count === 1 ? ' has' : 's have'} two or more graded visits — the
                minimum for any longitudinal comparison.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Signed" value={`${data.signed_slide_count}/${data.graded_slide_count}`} />
            <Stat label="Mean confidence" value={data.mean_confidence != null ? `${(data.mean_confidence * 100).toFixed(0)}%` : '—'} />
            <Stat label="Low-confidence" value={String(data.low_confidence_count)} />
          </div>

          {data.significant_movers.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1.5">
                Changes beyond the model&rsquo;s margin of error
              </p>
              <div className="space-y-1">
                {data.significant_movers.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                    <span className="font-medium">{m.patient_id}</span>
                    <span className="text-[var(--text-secondary)]">{m.from_visit} → {m.to_visit}</span>
                    <span style={{ color: m.delta > 0 ? '#FF3B30' : '#34C759' }} className="tabular-nums">
                      {m.delta > 0 ? `+${m.delta}` : m.delta} grade groups
                    </span>
                    {!m.both_signed && <span className="text-[9px] text-[#FF9500]">unsigned</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.site_breakdown.length > 1 && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1.5">By site</p>
              <div className="space-y-1">
                {data.site_breakdown.map((sr, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="flex-1 truncate">{sr.site}</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">{sr.graded} graded</span>
                    {sr.unsigned > 0 && (
                      <span className="tabular-nums text-[#FF9500]">{sr.unsigned} unsigned</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-[8px] bg-[var(--skeleton-bg)] px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{data.scope_note}</p>
          </div>

          <div className="flex items-start gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#34C759] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
              All analysis runs on this machine. Slides, grades and patient records never leave it —
              the application makes no outbound network requests and the model is bundled locally.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="tabular-nums font-medium" style={color && value > 0 ? { color } : undefined}>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--skeleton-bg)] px-3 py-2">
      <p className="text-[9px] text-[var(--text-secondary)] mb-0.5">{label}</p>
      <p className="text-[15px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
