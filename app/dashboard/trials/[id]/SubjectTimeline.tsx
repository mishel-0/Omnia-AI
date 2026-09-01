'use client';

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, Activity } from 'lucide-react';
import { apiFetch } from '@/lib/auth';
import { Pill } from '@/components/ui';

interface Timepoint {
  patient_uuid: string;
  visit: string;
  visit_day: number | null;
  site?: string;
  status?: string;
  slide_count: number;
  graded: boolean;
  grade_group?: number;
  grade?: string;
  signed?: boolean;
  confidence?: number;
  filename?: string;
}
interface Change {
  from_visit: string; to_visit: string;
  from_grade_group: number; to_grade_group: number;
  delta: number;
  direction: 'increase' | 'decrease' | 'no_change';
  exceeds_noise_floor: boolean;
  both_signed: boolean;
}
interface Timeline {
  patient_id: string;
  visit_count: number;
  graded_visit_count: number;
  timepoints: Timepoint[];
  changes: Change[];
  trajectory: string;
  overall_delta?: number;
  headline: string;
  detail: string;
  caveats: string[];
  provisional: boolean;
}

/** Longitudinal view for one subject: every visit in time order, and how the
 * recorded grade moved between them.
 *
 * Deliberately describes trajectory, never treatment response — grade change
 * across repeat biopsies is confounded by which tissue each biopsy sampled,
 * and ISUP grade is not a validated response endpoint. The caveats returned
 * by the backend are rendered, not summarised away. */
export function SubjectTimeline({ trialId, patientId }: { trialId: string; patientId: string }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCaveats, setShowCaveats] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(
          `/api/trials/${trialId}/subjects/${encodeURIComponent(patientId)}/timeline`,
        );
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || 'Could not load timeline');
        const j = await res.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load timeline');
      }
    })();
    return () => { cancelled = true; };
  }, [trialId, patientId]);

  if (error) return <p className="text-[11px] text-[#FF3B30]">{error}</p>;
  if (!data) return <p className="text-[11px] text-[var(--text-secondary)]">Loading timeline…</p>;

  const TrendIcon = data.trajectory === 'higher' ? TrendingUp
    : data.trajectory === 'lower' ? TrendingDown : Minus;
  // Higher grade = worse disease, so a rise is red and a fall green. Neither
  // colour implies the therapy caused the move.
  const trendColor = data.trajectory === 'higher' ? '#FF3B30'
    : data.trajectory === 'lower' ? '#34C759' : 'var(--text-secondary)';

  const graded = data.timepoints.filter(t => t.graded);
  const maxGG = 5;

  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 mb-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Activity className="w-3.5 h-3.5 text-[var(--accent)]" />
        <p className="text-[12px] font-semibold">Subject {data.patient_id} — grade over time</p>
        <span className="text-[10px] text-[var(--text-secondary)]">
          {data.visit_count} visit{data.visit_count === 1 ? '' : 's'} · {data.graded_visit_count} graded
        </span>
        {data.provisional && (
          <Pill accent="orange" className="!text-[9px] !py-0.5">Includes unsigned grades</Pill>
        )}
      </div>

      <div className="flex items-start gap-2 mb-4">
        <TrendIcon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: trendColor }} />
        <div>
          <p className="text-[13px] font-medium">{data.headline}</p>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{data.detail}</p>
        </div>
      </div>

      {graded.length > 0 && (
        <div className="mb-4">
          <div className="flex items-end gap-3 overflow-x-auto pb-2">
            {graded.map((t, i) => (
              <div key={i} className="flex flex-col items-center gap-1 min-w-[64px]">
                <span className="text-[10px] tabular-nums text-[var(--text-secondary)]">
                  GG {t.grade_group}
                </span>
                <div
                  className="w-8 rounded-t-[4px]"
                  style={{
                    // Bar height encodes grade group; a taller bar is a
                    // higher (worse) grade.
                    height: `${12 + ((t.grade_group ?? 0) / maxGG) * 64}px`,
                    background: (t.grade_group ?? 0) >= 4 ? '#FF3B30'
                      : (t.grade_group ?? 0) >= 2 ? '#FF9500' : '#34C759',
                    opacity: t.signed ? 1 : 0.45,
                  }}
                  title={`${t.visit} — Grade Group ${t.grade_group}${t.signed ? ' (signed)' : ' (unsigned)'}`}
                />
                <span className="text-[9px] text-[var(--text-secondary)] text-center leading-tight max-w-[64px] truncate" title={t.visit}>
                  {t.visit}
                </span>
                {!t.signed && <span className="text-[8px] text-[#FF9500]">unsigned</span>}
              </div>
            ))}
          </div>
          <p className="text-[9px] text-[var(--text-secondary)]/70">
            Taller bar = higher grade group. Faded bars are not yet pathologist-signed.
          </p>
        </div>
      )}

      {data.changes.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1.5">
            Change between visits
          </p>
          <div className="space-y-1">
            {data.changes.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                <span className="text-[var(--text-secondary)]">{c.from_visit} → {c.to_visit}</span>
                <span className="tabular-nums font-medium">
                  GG {c.from_grade_group} → {c.to_grade_group}
                </span>
                <span
                  className="tabular-nums"
                  style={{ color: c.delta > 0 ? '#FF3B30' : c.delta < 0 ? '#34C759' : 'var(--text-secondary)' }}
                >
                  {c.delta > 0 ? `+${c.delta}` : c.delta === 0 ? 'no change' : c.delta}
                </span>
                {c.delta !== 0 && !c.exceeds_noise_floor && (
                  <span className="text-[9px] text-[var(--text-secondary)]/80">within margin of error</span>
                )}
                {c.exceeds_noise_floor && (
                  <Pill accent="orange" className="!text-[9px] !py-0.5">Worth review</Pill>
                )}
                {!c.both_signed && (
                  <span className="text-[9px] text-[#FF9500]">unsigned</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.caveats.length > 0 && (
        <div className="rounded-[8px] border border-[var(--border-subtle)] overflow-hidden">
          <button
            onClick={() => setShowCaveats(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-[var(--skeleton-bg)] transition-colors text-left"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-[#FF9500] shrink-0" />
              <span className="text-[11px] font-medium">How to read this — and what it does not show</span>
            </span>
            <ChevronDown className={'w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform ' + (showCaveats ? 'rotate-180' : '')} />
          </button>
          {showCaveats && (
            <div className="px-3 pb-3 pt-0.5 space-y-2">
              <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">
                This is a record of graded results over time. It is <strong>not</strong> an
                assessment of whether treatment is working.
              </p>
              {data.caveats.map((c, i) => (
                <p key={i} className="text-[10.5px] text-[var(--text-secondary)] leading-relaxed pl-3 border-l-2 border-[var(--border-subtle)]">
                  {c}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
