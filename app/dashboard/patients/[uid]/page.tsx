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
  ShieldCheck, Download, Users,
} from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend } from '@/lib/auth';
import { useToast } from '@/lib/toast';

interface Slide {
  id: string;
  filename: string;
  /** Grade fields are stored flat on the slide record, not nested under an
   *  "analysis" object — reading s.analysis.grade_group silently showed no
   *  grade for every slide. */
  grade?: string | null;
  grade_group?: number | null;
  confirmed?: boolean;
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

  return (
    <div className="min-h-screen">
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
            {/* Identity strip */}
            <div className="flex items-end justify-between gap-6 flex-wrap mb-6">
              <div>
                <h2 className="text-[26px] font-semibold tracking-[-0.5px] leading-tight tabular-nums">{p.uid}</h2>
                <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
                  {[
                    p.initials || null,
                    p.year_of_birth ? `b. ${p.year_of_birth}` : null,
                    p.sex || null,
                    p.site || null,
                  ].filter(Boolean).join(' · ') || 'No profile details recorded'}
                </p>
              </div>
              <div className="flex items-stretch gap-6">
                <Metric label="Trials" value={data.totals.trials} />
                <Divider />
                <Metric label="Visits" value={data.totals.visits} />
                <Divider />
                <Metric label="Slides" value={data.totals.slides} />
                <Divider />
                <Metric label="Signed" value={data.totals.confirmed} accent="#34C759" />
              </div>
            </div>

            {p.notes && (
              <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] px-4 py-3 mb-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.6px] text-[var(--text-secondary)] mb-1">Notes</p>
                <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{p.notes}</p>
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
                            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#007AFF] hover:underline"
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

function Metric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="min-w-[68px]">
      <p className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap">{label}</p>
      <p className="text-[24px] font-semibold tabular-nums leading-tight mt-0.5" style={{ color: accent }}>{value}</p>
    </div>
  );
}

function Divider() {
  return <div className="w-px bg-[var(--border-subtle)] self-stretch" />;
}

function MiniStat({ label, text }: { label: string; text: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-[0.4px] text-[var(--text-secondary)]">{label}</p>
      <p className="text-[12.5px] font-medium tabular-nums">{text}</p>
    </div>
  );
}
