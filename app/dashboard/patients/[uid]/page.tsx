'use client';

/**
 * Patient container — everything on file for one person.
 *
 * Laid out as nested groups rather than a flat table because that is the
 * actual shape of the data: a patient holds enrollments, an enrollment holds
 * visits, a visit holds slides. Flattening it forces the reader to
 * reconstruct that hierarchy mentally on every scan.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, FlaskConical, FileText, Layers, ChevronRight,
  ShieldCheck, Download, Users, Activity, Microscope, Ruler, TrendingUp,
} from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import AppBar from '../../components/AppBar';

interface Slide {
  id: string;
  filename: string;
  /** Grade fields are stored flat on the slide record, not nested under an
   *  "analysis" object — reading s.analysis.grade_group silently showed no
   *  grade for every slide. */
  grade?: string | null;
  grade_group?: number | null;
  confirmed?: boolean;
  /** The container endpoint has always returned the whole visit record, so
   *  these arrived on every slide and were simply never declared here — the
   *  clinical detail was on the wire and thrown away at the type boundary. */
  risk_group?: string | null;
  confidence?: number | null;
  tumor_involvement_pct?: number | null;
  perineural_invasion?: boolean | null;
  lymphovascular_invasion?: boolean | null;
  cribriform_pattern?: boolean | null;
  doctor_correction?: string | null;
  corrected_grade_group?: number | null;
  signed_by?: string | null;
  signed_at?: string | null;
}
interface Visit {
  id: string;
  visit: string;
  created: string;
  slides: Slide[];
}
interface Enrollment {
  trial_id: string;
  trial_name: string;
  protocol_id: string;
  phase: string;
  sponsor: string;
  drug: string;
  subject_code: string;
  visits: Visit[];
  visit_count: number;
  slide_count: number;
  analysed_count: number;
  confirmed_count: number;
}
interface Report {
  file: string;
  size: number;
  created: string;
  trial_name?: string;
  visit?: string;
  grade_group?: number;
}
interface Container {
  patient: {
    uid: string; initials: string; year_of_birth: number | null;
    sex: string; site: string; notes: string; created: string;
  };
  enrollments: Enrollment[];
  reports: Report[];
  totals: {
    trials: number; visits: number; slides: number;
    analysed: number; confirmed: number; reports: number;
  };
}

/** Every graded slide this patient has, oldest first.
 *
 * The grade a patient "has" at a timepoint is the pathologist's if they
 * corrected it, and the model's otherwise — a corrected slide must never
 * report the grade that was overruled. */
interface Point {
  date: string;
  visit: string;
  trial: string;
  slide: Slide;
  grade_group: number;
  corrected: boolean;
}

function timeline(enrollments: Enrollment[]): Point[] {
  const pts: Point[] = [];
  for (const e of enrollments) {
    for (const v of e.visits) {
      for (const s of v.slides) {
        const gg = s.corrected_grade_group ?? s.grade_group;
        if (gg === null || gg === undefined) continue;
        pts.push({
          date: v.created,
          visit: v.visit,
          trial: e.trial_name,
          slide: s,
          grade_group: gg,
          corrected: s.corrected_grade_group !== null && s.corrected_grade_group !== undefined,
        });
      }
    }
  }
  return pts.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

const RISK_TONE: Record<string, string> = {
  'Very Low': '#34C759', Low: '#34C759', Intermediate: '#FF9500',
  'Favorable Intermediate': '#FF9500', 'Unfavorable Intermediate': '#FF9500',
  High: '#FF3B30', 'Very High': '#FF3B30', Benign: '#34C759',
};

/** Grade group drives the colour everywhere it appears, so a reader learns one
 *  mapping rather than a different scale per card. 0–1 benign/low, 2–3 middle,
 *  4–5 high. */
function gradeTone(gg: number | null | undefined): string {
  if (gg === null || gg === undefined) return 'var(--text-secondary)';
  if (gg <= 1) return '#34C759';
  if (gg <= 3) return '#FF9500';
  return '#FF3B30';
}

/** A metric tile: big number, unit, and the change since baseline where one
 *  exists. Deliberately states the delta as a grade-group change and nothing
 *  more — a grade moving is a measurement, not evidence a treatment worked. */
function StatCard({
  icon: Icon, label, value, unit, delta, tone,
}: {
  icon: React.ElementType; label: string; value: string; unit?: string;
  delta?: { text: string; good: boolean | null } | null; tone?: string;
}) {
  return (
    <div className="rounded-[18px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: tone }}>
          {value}
          {unit && <span className="text-[13px] font-medium text-[var(--text-secondary)] ml-1">{unit}</span>}
        </p>
        {delta && (
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap"
            style={{
              color: delta.good === null ? 'var(--text-secondary)' : delta.good ? '#1a7a35' : '#c0392b',
              background: delta.good === null ? 'var(--skeleton-bg)'
                : delta.good ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.12)',
            }}
          >
            {delta.text}
          </span>
        )}
      </div>
    </div>
  );
}

/** Grade group across visits. Small enough to read at a glance, and plotted on
 *  the fixed 0–5 ISUP scale rather than auto-scaling — an auto-scaled axis makes
 *  a one-step change look dramatic, which is exactly the misreading to avoid. */
function GradeTimeline({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return (
      <p className="text-[12px] text-[var(--text-secondary)] py-8 text-center">
        No graded slides yet. The timeline appears once a slide has been analysed.
      </p>
    );
  }
  const w = 640, h = 150, padL = 26, padR = 12, padT = 12, padB = 26;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const x = (i: number) => points.length === 1
    ? padL + plotW / 2
    : padL + (i / (points.length - 1)) * plotW;
  const y = (gg: number) => padT + (1 - gg / 5) * plotH;

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.grade_group).toFixed(1)}`).join(' ');

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[420px] h-[170px]">
        {[0, 1, 2, 3, 4, 5].map(g => (
          <g key={g}>
            <line x1={padL} x2={w - padR} y1={y(g)} y2={y(g)}
                  stroke="var(--border-subtle)" strokeWidth="1" />
            <text x={padL - 7} y={y(g) + 3} textAnchor="end"
                  fontSize="9" fill="var(--text-secondary)">{g}</text>
          </g>
        ))}
        {points.length > 1 && (
          <polyline points={line} fill="none" stroke="var(--accent)"
                    strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.grade_group)} r="4.5"
                    fill={gradeTone(p.grade_group)} stroke="var(--bg-card-solid)" strokeWidth="2" />
            <text x={x(i)} y={h - 9} textAnchor="middle" fontSize="9"
                  fill="var(--text-secondary)">{p.visit}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Present / absent / not assessed — three states, never collapsed to two.
 *  "Not assessed" and "absent" are different clinical statements. */
function FindingRow({ label, value }: { label: string; value: boolean | null | undefined }) {
  const known = value === true || value === false;
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0">
      <span className="text-[12.5px]">{label}</span>
      <span
        className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full"
        style={{
          color: !known ? 'var(--text-secondary)' : value ? '#c0392b' : '#1a7a35',
          background: !known ? 'var(--skeleton-bg)'
            : value ? 'rgba(255,59,48,0.12)' : 'rgba(52,199,89,0.12)',
        }}
      >
        {!known ? 'Not assessed' : value ? 'Present' : 'Absent'}
      </span>
    </div>
  );
}

export default function PatientContainerPage() {
  const [data, setData] = useState<Container | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();
  const params = useParams();
  const uid = String(params?.uid || '');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setData(await apiSend(`/api/patients/${encodeURIComponent(uid)}/container`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this patient.');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  // The endpoint is authenticated, so the file must be fetched with the
  // session token rather than linked to directly — a plain href would 401.
  const openReport = async (file: string) => {
    try {
      const res = await apiFetch(
        `/api/patients/${encodeURIComponent(uid)}/reports/${encodeURIComponent(file)}`);
      if (!res.ok) throw new Error(`Could not open the report (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not open the report', 'error');
    }
  };

  const p = data?.patient;

  // Derived once here rather than inline in the JSX, so the "latest" grade has
  // exactly one definition on this page.
  const points = React.useMemo(() => timeline(data?.enrollments ?? []), [data]);
  const latest = points.length ? points[points.length - 1] : null;
  const baseline = points.length ? points[0] : null;

  // Reported only as a change in the measurement. A grade moving down is not
  // evidence a treatment worked — that is a conclusion drawn from a controlled
  // comparison across a population, not from one patient's biopsies, which also
  // sample different tissue each time.
  const gradeDelta = React.useMemo(() => {
    if (!latest || !baseline || latest === baseline) return null;
    const d = latest.grade_group - baseline.grade_group;
    if (d === 0) return { text: 'no change', good: null as boolean | null };
    return { text: `${d > 0 ? '+' : ''}${d} vs baseline`, good: d < 0 };
  }, [latest, baseline]);

  return (
    <div className="min-h-screen">
      <AppBar />
      <div className="titlebar-drag titlebar-inset border-b border-[var(--border-subtle)] flex items-center gap-4 pr-6 py-3">
        <button
          onClick={() => router.push('/dashboard/patients')}
          className="titlebar-no-drag inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Patients
        </button>
        <h1 className="text-[13px] font-semibold tabular-nums">{uid}</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <TableSkeleton />
        ) : error || !data || !p ? (
          <EmptyState
            icon={Users}
            title="Patient not found"
            subtitle={error || 'No patient is registered with that identifier.'}
            action={<Button onClick={() => router.push('/dashboard/patients')}>Back to patients</Button>}
          />
        ) : (
          <>
            {/* ── Metric row ──
                Latest reading per measure, with the change since this
                patient's first graded slide where there is one. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              <StatCard
                icon={Activity}
                label="ISUP Grade Group"
                value={latest ? String(latest.grade_group) : '—'}
                tone={gradeTone(latest?.grade_group)}
                delta={gradeDelta}
              />
              <StatCard
                icon={Microscope}
                label="Gleason"
                value={latest ? (latest.slide.doctor_correction || latest.slide.grade || '—') : '—'}
              />
              <StatCard
                icon={Ruler}
                label="Tumour involvement"
                value={latest?.slide.tumor_involvement_pct != null
                  ? String(latest.slide.tumor_involvement_pct) : '—'}
                unit={latest?.slide.tumor_involvement_pct != null ? '%' : undefined}
              />
              <StatCard
                icon={ShieldCheck}
                label="Slides signed"
                value={`${data.totals.confirmed}/${data.totals.slides}`}
                tone={data.totals.slides > 0 && data.totals.confirmed === data.totals.slides
                  ? '#34C759' : undefined}
              />
            </div>

            <div className="grid lg:grid-cols-3 gap-3 mb-6">
              {/* Identity */}
              <div className="rounded-[18px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] p-5">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-full bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center shrink-0">
                    <span className="text-[13px] font-bold text-[var(--accent)]">
                      {p.initials || '—'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-semibold tracking-[-0.3px] tabular-nums truncate">{p.uid}</h2>
                    <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
                      {[
                        p.sex || null,
                        p.year_of_birth ? `b. ${p.year_of_birth}` : null,
                      ].filter(Boolean).join(' · ') || 'No demographics recorded'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2.5">
                  {[
                    ['Site', p.site || '—'],
                    ['Registered', p.created ? new Date(p.created).toLocaleDateString() : '—'],
                    ['Trials', String(data.totals.trials)],
                    ['Visits', String(data.totals.visits)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <span className="text-[11.5px] text-[var(--text-secondary)]">{k}</span>
                      <span className="text-[12.5px] font-medium tabular-nums">{v}</span>
                    </div>
                  ))}
                </div>

                {p.notes && (
                  <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.6px] text-[var(--text-secondary)] mb-1">Notes</p>
                    <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{p.notes}</p>
                  </div>
                )}
              </div>

              {/* Grade over time — the reason the patient container exists */}
              <div className="lg:col-span-2 rounded-[18px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] p-5">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[var(--accent)]" />
                    <h3 className="text-[13.5px] font-semibold">Grade over time</h3>
                  </div>
                  <span className="text-[10.5px] text-[var(--text-secondary)]">ISUP 0–5</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                  Every graded slide for this patient, oldest first. A corrected slide
                  plots the pathologist&rsquo;s grade, not the model&rsquo;s.
                </p>
                <GradeTimeline points={points} />
              </div>
            </div>

            {/* Findings + risk, from the most recent graded slide */}
            {latest && (
              <div className="grid lg:grid-cols-3 gap-3 mb-6">
                <div className="lg:col-span-2 rounded-[18px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] p-5">
                  <h3 className="text-[13.5px] font-semibold mb-1">Latest findings</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] mb-2">
                    From {latest.visit} · {latest.date ? new Date(latest.date).toLocaleDateString() : '—'}
                  </p>
                  <FindingRow label="Perineural invasion (PNI)" value={latest.slide.perineural_invasion} />
                  <FindingRow label="Lymphovascular invasion (LVI)" value={latest.slide.lymphovascular_invasion} />
                  <FindingRow label="Cribriform pattern" value={latest.slide.cribriform_pattern} />
                </div>

                <div className="rounded-[18px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] p-5">
                  <h3 className="text-[13.5px] font-semibold mb-3">Risk category</h3>
                  <p className="text-[22px] font-semibold leading-tight"
                     style={{ color: RISK_TONE[latest.slide.risk_group || ''] || 'var(--text-primary)' }}>
                    {latest.slide.risk_group || '—'}
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                    {latest.corrected
                      ? 'Based on the pathologist’s corrected grade.'
                      : latest.slide.confirmed
                        ? 'Based on a grade the pathologist confirmed.'
                        : 'Based on the model’s grade — not yet reviewed.'}
                  </p>
                  {latest.slide.confidence != null && !latest.corrected && (
                    <p className="text-[11px] text-[var(--text-secondary)] mt-2 tabular-nums">
                      Model confidence {(latest.slide.confidence * 100).toFixed(0)}%
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Enrollments */}
            <SectionHeading icon={FlaskConical} title="Trial enrollments" count={data.enrollments.length} />
            {data.enrollments.length === 0 ? (
              <p className="text-[12.5px] text-[var(--text-secondary)] mb-6">
                This patient is not enrolled in any trial yet. Add them to a trial from that
                trial&rsquo;s page.
              </p>
            ) : (
              <div className="space-y-3 mb-8">
                {data.enrollments.map(e => (
                  <div key={e.trial_id} className="rounded-[16px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] overflow-hidden">
                    <button
                      onClick={() => router.push(`/dashboard/trials/${e.trial_id}`)}
                      className="w-full text-left px-5 py-4 hover:bg-[var(--skeleton-bg)] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[14px] font-semibold">{e.trial_name}</p>
                            {e.phase && (
                              <span className="text-[10px] font-medium text-[var(--text-secondary)] bg-[var(--skeleton-bg)] rounded-full px-2 py-0.5">{e.phase}</span>
                            )}
                          </div>
                          <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
                            {[e.protocol_id, e.sponsor, e.drug].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="flex items-center gap-5 shrink-0">
                          <MiniStat label="Subject code" text={e.subject_code} />
                          <MiniStat label="Visits" text={String(e.visit_count)} />
                          <MiniStat label="Slides" text={`${e.confirmed_count}/${e.slide_count} signed`} />
                          <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
                        </div>
                      </div>
                    </button>

                    {/* Visits within this enrollment */}
                    {e.visits.length > 0 && (
                      <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                        {e.visits.map(v => (
                          <div key={v.id} className="px-5 py-3 flex items-start gap-4">
                            <div className="w-[130px] shrink-0">
                              <p className="text-[12.5px] font-medium">{v.visit}</p>
                              <p className="text-[11px] text-[var(--text-secondary)]">
                                {v.created ? new Date(v.created).toLocaleDateString() : '—'}
                              </p>
                            </div>
                            <div className="flex-1 min-w-0">
                              {v.slides.length === 0 ? (
                                <p className="text-[11.5px] text-[var(--text-secondary)]">No slides uploaded.</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {v.slides.map(s => (
                                    <span
                                      key={s.id}
                                      title={s.filename}
                                      className="inline-flex items-center gap-1.5 text-[11px] rounded-full border border-[var(--border-subtle)] px-2.5 py-1 max-w-[240px]"
                                    >
                                      <Layers className="w-3 h-3 shrink-0 text-[var(--text-secondary)]" />
                                      <span className="truncate">{s.filename}</span>
                                      {/* Grade 0 is a real result (benign), so
                                          this checks for a value rather than
                                          truthiness — `!s.grade_group` would
                                          hide every benign slide. */}
                                      {s.grade_group !== undefined && s.grade_group !== null && (
                                        <span
                                          title={s.confirmed ? 'Signed by a pathologist' : 'Awaiting review'}
                                          className={
                                            'shrink-0 font-semibold ' +
                                            (s.confirmed ? 'text-[#34C759]' : 'text-[#FF9500]')
                                          }
                                        >
                                          GG{s.grade_group}{s.confirmed ? ' ✓' : ''}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Reports */}
            <SectionHeading icon={FileText} title="Reports on file" count={data.reports.length} />
            {data.reports.length === 0 ? (
              <p className="text-[12.5px] text-[var(--text-secondary)]">
                No reports have been filed for this patient yet. Reports generated from a
                signed slide are stored here automatically.
              </p>
            ) : (
              <Card size="sm" className="overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--skeleton-bg)]">
                      {['Report', 'Trial', 'Visit', 'Issued', ''].map((h, i) => (
                        <th key={i} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map(r => (
                      <tr key={r.file} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td className="px-4 py-3 text-[12.5px] font-medium truncate max-w-[260px]">{r.file}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">{r.trial_name || '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">{r.visit || '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">
                          {r.created ? new Date(r.created).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openReport(r.file)}
                            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:underline"
                          >
                            <Download className="w-3.5 h-3.5" /> Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </Card>
            )}

            <div className="flex items-start gap-2.5 mt-8 text-[11.5px] text-[var(--text-secondary)]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#34C759] shrink-0 mt-[1px]" />
              <p>
                Everything shown here is stored on this machine, in this patient&rsquo;s own
                folder. Nothing is transmitted anywhere.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.6px] text-[var(--text-secondary)]">{title}</h3>
      <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">({count})</span>
    </div>
  );
}

// Metric and Divider lived here to build the old inline identity strip. The
// header is now the StatCard row plus the identity card, so both are gone
// rather than left as dead code that looks like it is still in use.

function MiniStat({ label, text }: { label: string; text: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-[0.4px] text-[var(--text-secondary)]">{label}</p>
      <p className="text-[12.5px] font-medium tabular-nums">{text}</p>
    </div>
  );
}
