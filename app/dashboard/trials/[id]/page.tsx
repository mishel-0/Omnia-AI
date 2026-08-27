'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Upload, Check, Download, FileText, Lock,
  MessageSquareWarning, ChevronDown, ChevronUp, X, Sparkles, FlaskConical, Trash2,
} from 'lucide-react';
import { Card, Button, Pill, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';
import { InfoHint, TrustDisclosure } from '@/lib/onboarding';
import { SubjectTimeline } from './SubjectTimeline';
import { CohortInsights } from './CohortInsights';
import { DrugProfile } from './DrugProfile';

interface Biomarker { result: string; interpretation: string; }
/** One sampled tile and how strongly the model's attention layer weighted it
 * when grading the slide. `attention` is normalised 0-1 across this slide's
 * own tiles; `attention_raw` is the underlying softmax weight. */
interface AttentionRegion { x: number; y: number; size: number; attention: number; attention_raw: number; }
interface SlideQuality { tissue_quality: string; staining_quality: string; artifacts_detected: string; }
interface Slide {
  id: string;
  filename: string;
  file_size?: number;
  status: string;
  grade?: string;
  grade_group?: number;
  size_mm?: number;
  confidence?: number;
  tumor_involvement_pct?: number;
  perineural_invasion?: boolean;
  lymphovascular_invasion?: boolean;
  cribriform_pattern?: boolean;
  risk_group?: string;
  biomarkers?: Record<string, Biomarker>;
  quality?: SlideQuality;
  regions_analyzed?: number;
  suspicious_regions?: number;
  processing_time_s?: number;
  model_version?: string;
  analysis_source?: 'mock' | 'ai' | null;
  model_error?: string;
  attention_regions?: AttentionRegion[];
  slide_width?: number;
  slide_height?: number;
  confirmed: boolean;
  doctor_correction?: string;
  signed_by?: string;
  signed_at?: string;
  signature_meaning?: string;
}

const RISK_ACCENT: Record<string, 'green' | 'blue' | 'orange' | 'red'> = {
  'Low': 'green',
  'Favorable Intermediate': 'blue',
  'Unfavorable Intermediate': 'orange',
  'High': 'red',
  'Very High': 'red',
};

interface Patient {
  id: string;
  patient_id: string;
  visit: string;
  status: string;
  slides: Slide[];
  notes: string;
  site?: string;
  created?: string;
}

interface Trial {
  id: string;
  name: string;
  sponsor: string;
  drug: string;
  indication: string;
  status: string;
  sites: string[];
  patient_count: number;
  slides_analyzed: number;
  slides_confirmed: number;
}

interface QueryResponse { by: string; text: string; at: string; }
interface TrialQuery {
  id: string;
  patient_uuid: string;
  slide_id: string | null;
  subject: string;
  description: string;
  status: 'open' | 'answered' | 'closed';
  raised_by: string;
  raised_at: string;
  responses: QueryResponse[];
  closed_by?: string;
  closed_at?: string;
}

type ESignAction =
  | { mode: 'confirm'; patientId: string; slideId: string }
  | { mode: 'correct'; patientId: string; slideId: string; correction: string };


/** Human-readable file size — real slides are GB, but small files must not read "0.0 MB". */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Stages surfaced while a slide is being analysed. Naming the actual work makes
 * the wait legible to a pathologist instead of an unexplained spinner. */
const ANALYSIS_STAGES = [
  'Reading whole-slide image',
  'Segmenting tissue regions',
  'Detecting glandular architecture',
  'Grading Gleason patterns',
  'Assessing biomarkers',
  'Compiling report',
];
const STAGE_MS = 600;

/** Animated "thinking" row shown in place of the result while analysis runs. */
function AnalyzingRow({ stage }: { stage: number }) {
  const pct = Math.round(((stage + 1) / ANALYSIS_STAGES.length) * 100);
  return (
    <div className="max-w-[380px]">
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-[#007AFF] animate-pulse shrink-0" />
        <span key={stage} className="text-[12px] text-[#007AFF] animate-[stage-in_0.35s_ease-out]">
          {ANALYSIS_STAGES[Math.min(stage, ANALYSIS_STAGES.length - 1)]}
          <span className="analysis-dots" />
        </span>
      </div>
      <div className="mt-2 h-[3px] rounded-full bg-[var(--border-subtle)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#007AFF] transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="h-2 rounded-[3px] skeleton-shimmer w-[85%]" />
        <div className="h-2 rounded-[3px] skeleton-shimmer w-[60%]" />
      </div>
    </div>
  );
}

function heatColor(heat: number): string {
  if (heat < 0.3) return '#34C759';
  if (heat < 0.55) return '#FFCC00';
  if (heat < 0.75) return '#FF9500';
  return '#FF3B30';
}

/** Real slide viewer: renders the actual uploaded whole-slide image and
 * overlays the model's genuine per-tile attention weights at the slide
 * coordinates they were computed from.
 *
 * The attention values come from the MIL pooling layer — they are the
 * weights the model actually used to decide this slide's grade, so a hot
 * region is literally "this tile drove the prediction". That is a real
 * explainability signal, NOT a tumor-probability map: the model was never
 * trained on per-pixel tumor annotations, only slide-level grades. The
 * label wording below reflects that distinction deliberately. */
function SlideHeatmapPreview({ slide, patientId }: { slide: Slide; patientId: string }) {
  const [imgUrl, setImgUrl] = React.useState<string | null>(null);
  const [imgError, setImgError] = React.useState<string | null>(null);
  const [showHeat, setShowHeat] = React.useState(true);
  const [zoom, setZoom] = React.useState(1);
  const [hovered, setHovered] = React.useState<number | null>(null);

  const regions = slide.attention_regions || [];
  const sw = slide.slide_width || 0;
  const sh = slide.slide_height || 0;

  React.useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/trials/patients/${patientId}/slides/${slide.id}/thumbnail`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail || `Could not load slide image (${res.status})`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setImgUrl(url);
      } catch (e) {
        if (!cancelled) setImgError(e instanceof Error ? e.message : 'Could not load slide image');
      }
    })();
    // Blob URLs leak until explicitly revoked — release on unmount.
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [patientId, slide.id]);

  const canOverlay = regions.length > 0 && sw > 0 && sh > 0;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Slide Viewer</p>
        {canOverlay ? (
          <span className="text-[9px] text-[var(--text-secondary)]/70">
            Actual slide · {regions.length} analysed regions, shaded by how much each drove the model&rsquo;s grade
          </span>
        ) : (
          <span className="text-[9px] text-[var(--text-secondary)]/70">Actual uploaded slide</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {canOverlay && (
            <button
              onClick={() => setShowHeat((v) => !v)}
              className="px-2 py-0.5 rounded-[6px] text-[10px] font-medium border border-[var(--border-subtle)] hover:bg-[var(--border-medium)] transition-colors"
            >
              {showHeat ? 'Hide attention' : 'Show attention'}
            </button>
          )}
          <button
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
            disabled={zoom <= 1}
            className="px-2 py-0.5 rounded-[6px] text-[10px] font-medium border border-[var(--border-subtle)] hover:bg-[var(--border-medium)] transition-colors disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="text-[10px] tabular-nums text-[var(--text-secondary)] w-8 text-center">{zoom.toFixed(1)}×</span>
          <button
            onClick={() => setZoom((z) => Math.min(6, +(z + 0.5).toFixed(1)))}
            disabled={zoom >= 6}
            className="px-2 py-0.5 rounded-[6px] text-[10px] font-medium border border-[var(--border-subtle)] hover:bg-[var(--border-medium)] transition-colors disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div
        className="relative rounded-[10px] overflow-auto border border-[var(--border-subtle)] bg-[var(--skeleton-bg)]"
        style={{ maxHeight: 460 }}
      >
        {imgError ? (
          <div className="p-6 text-[11px] text-[#FF3B30]">{imgError}</div>
        ) : !imgUrl ? (
          <div className="p-6 text-[11px] text-[var(--text-secondary)]">Loading slide…</div>
        ) : (
          <div style={{ width: `${zoom * 100}%`, position: 'relative', lineHeight: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgUrl} alt={`Whole-slide image for ${slide.filename}`} style={{ width: '100%', display: 'block' }} />
            {showHeat && canOverlay && (
              <svg
                viewBox={`0 0 ${sw} ${sh}`}
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full"
                style={{ pointerEvents: 'none' }}
              >
                {regions.map((r, i) => {
                  // Tiles are 128px on a slide tens of thousands of px wide —
                  // drawn at true scale they'd be invisible specks, so scale
                  // the marker with the slide while keeping the centre honest.
                  const rad = Math.max(sw, sh) * 0.012 * (0.55 + 0.45 * r.attention);
                  return (
                    <circle
                      key={i}
                      cx={r.x + r.size / 2}
                      cy={r.y + r.size / 2}
                      r={rad}
                      fill={heatColor(r.attention)}
                      opacity={hovered === null ? 0.42 + 0.3 * r.attention : hovered === i ? 0.85 : 0.12}
                      stroke={hovered === i ? '#fff' : 'none'}
                      strokeWidth={Math.max(sw, sh) * 0.002}
                      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <title>{`Region ${i + 1} — attention ${(r.attention * 100).toFixed(0)}% (slide x=${r.x}, y=${r.y})`}</title>
                    </circle>
                  );
                })}
              </svg>
            )}
          </div>
        )}
      </div>

      {canOverlay && (
        <>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[9px] text-[var(--text-secondary)]">Lower influence</span>
            <div className="h-1.5 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, #34C759, #FFCC00, #FF9500, #FF3B30)' }} />
            <span className="text-[9px] text-[var(--text-secondary)]">Drove the grade most</span>
          </div>
          <p className="text-[9px] text-[var(--text-secondary)]/70 mt-1.5 leading-relaxed">
            Attention shows which sampled regions the model weighted when grading this slide. It is not a
            tumour-probability map &mdash; the model was trained on slide-level grades only, never on
            per-region tumour annotations.
          </p>
        </>
      )}
      {sw > 0 && (
        <p className="text-[9px] text-[var(--text-secondary)]/60 mt-1">
          Full slide {sw.toLocaleString()} × {sh.toLocaleString()} px · preview downsampled for display
        </p>
      )}
    </div>
  );
}

/** The six ISUP grade groups, with the plain-language meaning a report
 *  carries. Text must match GRADE_TEXT_BY_GROUP in backend/trials.py, which
 *  is what the server validates a correction against. */
const GRADE_GROUPS: { group: number; text: string; meaning: string }[] = [
  { group: 0, text: 'Benign / no tumor identified', meaning: 'No cancer identified' },
  { group: 1, text: '3+3=6', meaning: 'Grade group 1 — low risk' },
  { group: 2, text: '3+4=7', meaning: 'Grade group 2 — favourable intermediate' },
  { group: 3, text: '4+3=7', meaning: 'Grade group 3 — unfavourable intermediate' },
  { group: 4, text: '4+4=8', meaning: 'Grade group 4 — high risk' },
  { group: 5, text: '4+5=9', meaning: 'Grade group 5 — very high risk' },
];

export default function TrialDetail() {
  const params = useParams();
  const router = useRouter();
  const trialId = params.id as string;
  const { user } = useAuth();
  const writable = canWrite(user?.role);
  const toast = useToast();
  const { prompt, confirm } = useDialogs();

  const [trial, setTrial] = useState<Trial | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [queries, setQueries] = useState<TrialQuery[]>([]);
  const [expandedQueries, setExpandedQueries] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [patientForm, setPatientForm] = useState({ patient_id: '', visit: 'Baseline', notes: '', site: '' });
  // Enrolling an already-registered patient is what makes one person's record
  // span trials; without it every enrollment would create a new patient and
  // the cross-trial container could never hold more than one.
  const [correcting, setCorrecting] = useState<{ patientId: string; slideId: string; filename: string; current: string } | null>(null);
  const [enrolMode, setEnrolMode] = useState<'new' | 'existing'>('new');
  const [registry, setRegistry] = useState<{ uid: string; initials: string; year_of_birth: number | null }[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [newProfile, setNewProfile] = useState({ initials: '', year_of_birth: '', sex: '' });
  const [addError, setAddError] = useState('');
  const [addingPatient, setAddingPatient] = useState(false);

  // Records arrive one-per-visit and in no particular order. Group them by
  // subject and put each subject's visits in chronological order, so the
  // list reads as a timeline per person rather than scattered rows.
  const orderedPatients = React.useMemo(() => {
    const rank = (visit: string): number => {
      const v = (visit || '').trim();
      if (/\bscreen/i.test(v)) return -1;
      if (/\b(baseline|bl|pre[- ]?treat|c1d1)\b/i.test(v)) return 0;
      const m = v.match(/\b(day|week|month|year)s?\s*[-#]?\s*(\d+)/i);
      if (m) {
        const unit = { day: 1, week: 7, month: 30.44, year: 365.25 }[m[1].toLowerCase() as 'day' | 'week' | 'month' | 'year'];
        return Number(m[2]) * unit;
      }
      const bare = v.match(/^\s*(\d+)\s*$/);
      if (bare) return Number(bare[1]) * 7;
      return Number.POSITIVE_INFINITY;  // unrecognised labels sort last
    };
    return [...patients].sort((a, b) => {
      const s = a.patient_id.trim().toLowerCase().localeCompare(b.patient_id.trim().toLowerCase());
      if (s !== 0) return s;
      const r = rank(a.visit) - rank(b.visit);
      if (r !== 0 && Number.isFinite(r)) return r;
      return (a.created || '').localeCompare(b.created || '');
    });
  }, [patients]);

  const [esign, setEsign] = useState<ESignAction | null>(null);
  const [esignPassword, setEsignPassword] = useState('');
  const [esignError, setEsignError] = useState('');
  const [esignBusy, setEsignBusy] = useState(false);

  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [flagForm, setFlagForm] = useState({ subject: '', description: '' });
  const [respondText, setRespondText] = useState<Record<string, string>>({});
  const [analyzingIds, setAnalyzingIds] = useState<Record<string, boolean>>({});
  const [analysisStage, setAnalysisStage] = useState<Record<string, number>>({});
  const [expandedSlides, setExpandedSlides] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    try {
      const [tRes, pRes, qRes] = await Promise.all([
        apiFetch(`/api/trials/${trialId}`),
        apiFetch(`/api/trials/${trialId}/patients`),
        apiFetch(`/api/queries/?trial_id=${trialId}`),
      ]);
      setTrial(await tRes.json());
      setPatients(await pRes.json());
      setQueries(await qRes.json());
    } catch (e) {
      console.error('Failed to load trial data', e);
    } finally {
      setLoading(false);
    }
  }, [trialId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!showAddPatient) return;
    setAddError('');
    apiSend('/api/patients/')
      .then(d => setRegistry(Array.isArray(d) ? d : []))
      .catch(() => setRegistry([]));
  }, [showAddPatient]);

  const addPatient = async () => {
    if (addingPatient) return;
    setAddError('');
    if (enrolMode === 'existing' && !selectedUid) {
      setAddError('Choose which registered patient this visit belongs to.');
      return;
    }
    const year = newProfile.year_of_birth.trim();
    if (enrolMode === 'new' && year && !/^\d{4}$/.test(year)) {
      setAddError('Year of birth should be a four-digit year, or left blank.');
      return;
    }
    setAddingPatient(true);
    try {
      // The subject code is optional; the server falls back to the generated
      // patient ID so a visit is never filed without an identifier.
      const body: Record<string, unknown> = { ...patientForm };
      if (enrolMode === 'existing') {
        body.patient_uid = selectedUid;
      } else {
        body.profile = {
          initials: newProfile.initials.trim().toUpperCase(),
          year_of_birth: year ? Number(year) : null,
          sex: newProfile.sex,
          site: patientForm.site,
        };
      }
      const created = await apiSend(`/api/trials/${trialId}/patients`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setShowAddPatient(false);
      setPatientForm({ patient_id: '', visit: 'Baseline', notes: '', site: '' });
      setNewProfile({ initials: '', year_of_birth: '', sex: '' });
      setSelectedUid(''); setEnrolMode('new');
      loadData();
      toast.show(`Patient ${created?.patient_uid || created?.patient_id || ''} added`);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add patient');
    } finally {
      setAddingPatient(false);
    }
  };

  const handleDrop = async (patientId: string, files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.svs')) continue;
      try {
        const formData = new FormData();
        formData.append('file', file);
        const slide = await apiSend(`/api/trials/patients/${patientId}/slides`, {
          method: 'POST',
          body: formData,
        });
        loadData();
        toast.show(`${file.name} uploaded`);
        runAnalysis(patientId, slide.id, file.name);
      } catch (e) {
        console.error('Failed to upload slide', e);
        toast.show(e instanceof Error ? e.message : `Failed to upload ${file.name}`, 'error');
      }
    }
  };

  const runAnalysis = async (patientId: string, slideId: string, filename: string) => {
    setAnalyzingIds((prev) => ({ ...prev, [slideId]: true }));
    setAnalysisStage((prev) => ({ ...prev, [slideId]: 0 }));

    // Step the visible stage text so the wait reads as real work being done,
    // rather than an opaque spinner.
    const stageTimer = setInterval(() => {
      setAnalysisStage((prev) => {
        const at = prev[slideId] ?? 0;
        if (at >= ANALYSIS_STAGES.length - 1) return prev;
        return { ...prev, [slideId]: at + 1 };
      });
    }, STAGE_MS);

    const minDelay = new Promise((resolve) =>
      setTimeout(resolve, STAGE_MS * ANALYSIS_STAGES.length),
    );
    try {
      // A 503 means the machine is saturated, not that the slide is bad —
      // the backend sends Retry-After for exactly this. Previously nothing
      // handled it, so a busy machine showed the pathologist a hard error
      // and silently dropped the analysis. Wait and retry instead.
      const MAX_BUSY_RETRIES = 3;
      let res: Response | null = null;
      for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt++) {
        const [r] = await Promise.all([
          apiFetch(`/api/trials/patients/${patientId}/slides/${slideId}/analyze`, { method: 'POST' }),
          attempt === 0 ? minDelay : Promise.resolve(),
        ]);
        if (r.status !== 503 || attempt === MAX_BUSY_RETRIES) { res = r; break; }
        const retryAfter = Number(r.headers.get('Retry-After')) || 30;
        toast.show(
          `${filename}: the analysis engine is busy. Retrying automatically in ${retryAfter}s…`,
          'info',
        );
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      }
      if (!res) throw new Error('Analysis could not be started');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 503) {
          throw new Error(
            `The analysis engine is still busy after several attempts. ${filename} was not analysed — try again once other analyses have finished.`,
          );
        }
        throw new Error(body?.detail || 'Analysis failed');
      }
      const body = await res.json().catch(() => null);
      loadData();
      // The backend returns 200 with the slide even when the real model
      // failed (status: "analysis_failed") — a failed run isn't an HTTP
      // error, it's a normal response describing an unsuccessful analysis.
      // Check the slide's own status rather than assume 200 means success.
      if (body?.status === 'analysis_failed') {
        toast.show(body?.model_error ? `AI analysis failed for ${filename}: ${body.model_error}` : `AI analysis failed for ${filename}`, 'error');
      } else {
        toast.show(`AI analysis complete for ${filename}`, 'info');
      }
    } catch (e) {
      console.error('Failed to analyze slide', e);
      toast.show(e instanceof Error ? e.message : `AI analysis failed for ${filename}`, 'error');
    } finally {
      clearInterval(stageTimer);
      setAnalyzingIds((prev) => {
        const next = { ...prev };
        delete next[slideId];
        return next;
      });
      setAnalysisStage((prev) => {
        const next = { ...prev };
        delete next[slideId];
        return next;
      });
    }
  };

  const removePatient = async (patient: Patient) => {
    const ok = await confirm({
      title: 'Delete Patient',
      message: `Remove patient ${patient.patient_id} and their uploaded slides? This cannot be undone.`,
      confirmLabel: 'Delete Patient',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiSend(`/api/trials/patients/${patient.id}`, { method: 'DELETE' });
      loadData();
      toast.show(`Patient ${patient.patient_id} deleted`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to delete patient', 'error');
    }
  };

  const removeSlide = async (patientId: string, slide: Slide) => {
    const ok = await confirm({
      title: 'Delete Slide',
      message: `Remove ${slide.filename}? This deletes the stored file and cannot be undone.`,
      confirmLabel: 'Delete Slide',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiSend(`/api/trials/patients/${patientId}/slides/${slide.id}`, { method: 'DELETE' });
      loadData();
      toast.show(`${slide.filename} deleted`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to delete slide', 'error');
    }
  };

  const submitESign = async () => {
    if (!esign || !esignPassword) return;
    setEsignBusy(true);
    setEsignError('');
    try {
      const path = esign.mode === 'confirm' ? '/api/trials/slides/confirm' : '/api/trials/slides/correct';
      const body = esign.mode === 'confirm'
        ? { patient_id: esign.patientId, slide_id: esign.slideId, password: esignPassword }
        : { patient_id: esign.patientId, slide_id: esign.slideId, correction: esign.correction, password: esignPassword };
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setEsignError(data.detail || 'Signature failed.');
        setEsignBusy(false);
        return;
      }
      setEsign(null);
      setEsignPassword('');
      setEsignBusy(false);
      loadData();
      toast.show(esign.mode === 'confirm' ? 'Slide confirmed and signed' : 'Correction recorded and signed');
    } catch {
      setEsignError('Could not connect to backend.');
      setEsignBusy(false);
    }
  };

  const downloadPatientReport = async (patient: Patient, slide: Slide) => {
    try {
      const res = await apiFetch('/api/reports/patient', {
        method: 'POST',
        body: JSON.stringify({
          trial_name: trial?.name || '',
          sponsor: trial?.sponsor || '',
          drug: trial?.drug || '',
          patient_id: patient.patient_id,
          visit: patient.visit,
          slide_filename: slide.filename,
          analysis_date: new Date().toISOString().split('T')[0],
          ai_grade: slide.grade || '',
          ai_confidence: slide.confidence ?? null,
          tumor_size_mm: slide.size_mm ?? null,
          doctor_correction: slide.doctor_correction || null,
          // Sent explicitly so the PDF reports the real review state. It used
          // to be inferred from whether a correction existed, so a slide
          // confirmed unchanged printed as "Awaiting Review".
          confirmed: !!slide.confirmed,
          signed_by: slide.signed_by || '',
          signed_at: slide.signed_at || '',
          grade_group: slide.grade_group ?? null,
          risk_group: slide.risk_group || '',
          tumor_involvement_pct: slide.tumor_involvement_pct ?? null,
          perineural_invasion: slide.perineural_invasion ?? null,
          lymphovascular_invasion: slide.lymphovascular_invasion ?? null,
          cribriform_pattern: slide.cribriform_pattern ?? null,
          biomarkers: slide.biomarkers || {},
          quality: slide.quality || {},
          regions_analyzed: slide.regions_analyzed ?? null,
          suspicious_regions: slide.suspicious_regions ?? null,
          processing_time_s: slide.processing_time_s ?? null,
          model_version: slide.model_version || '',
        }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${patient.patient_id}_${slide.filename.replace('.svs', '')}_report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show('Report downloaded');
    } catch (e) {
      console.error('Failed to download report', e);
      toast.show('Failed to generate report', 'error');
    }
  };

  const downloadTrialSummary = async () => {
    try {
      const res = await apiFetch(`/api/reports/trial/${trialId}/summary`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${trial?.name || 'trial'}_summary.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show('Trial summary downloaded');
    } catch (e) {
      console.error('Failed to download summary', e);
      toast.show('Failed to generate trial summary', 'error');
    }
  };

  const downloadCsv = async (kind: 'export-corrections-csv' | 'export-patients-csv', suffix: string) => {
    try {
      const res = await apiFetch(`/api/trials/${trialId}/${kind}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${trial?.name || 'trial'}_${suffix}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show('CSV exported');
    } catch {
      toast.show('Failed to export CSV', 'error');
    }
  };

  const raiseQuery = async () => {
    if (!flagFor || !flagForm.subject || !flagForm.description) return;
    try {
      await apiSend('/api/queries/', {
        method: 'POST',
        body: JSON.stringify({ trial_id: trialId, patient_uuid: flagFor, subject: flagForm.subject, description: flagForm.description }),
      });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to raise query', 'error');
      return;
    }
    setFlagFor(null);
    setFlagForm({ subject: '', description: '' });
    loadData();
    toast.show('Query raised');
  };

  const respondQuery = async (queryId: string) => {
    const text = respondText[queryId];
    if (!text) return;
    try {
      await apiSend(`/api/queries/${queryId}/respond`, { method: 'POST', body: JSON.stringify({ text }) });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to add response', 'error');
      return;
    }
    setRespondText({ ...respondText, [queryId]: '' });
    loadData();
    toast.show('Response added');
  };

  const closeQuery = async (queryId: string) => {
    try {
      await apiSend(`/api/queries/${queryId}/close`, { method: 'POST' });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to close query', 'error');
      return;
    }
    loadData();
    toast.show('Query closed');
  };

  const reopenQuery = async (queryId: string) => {
    try {
      await apiSend(`/api/queries/${queryId}/reopen`, { method: 'POST' });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to reopen query', 'error');
      return;
    }
    loadData();
    toast.show('Query reopened', 'info');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
        <div className="border-b border-[var(--border-subtle)] px-6 py-3 bg-[var(--bg-card-solid)]">
          <div className="w-24 h-2.5 rounded-[4px] skeleton-shimmer mb-2.5" />
          <div className="w-48 h-3.5 rounded-[4px] skeleton-shimmer mb-1.5" />
          <div className="w-64 h-2.5 rounded-[4px] skeleton-shimmer" />
        </div>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <Card size="sm" className="overflow-hidden">
            <TableSkeleton rows={4} columns={4} />
          </Card>
        </div>
      </div>
    );
  }

  if (!trial) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-[var(--text-secondary)]">Trial not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      {/* Header */}
      <div className="titlebar-inset border-b border-[var(--border-subtle)] pr-6 py-3 bg-[var(--bg-card-solid)]">
        <button onClick={() => router.push('/dashboard')} className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-1.5 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Trials
        </button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[16px] font-semibold">{trial.name}</h1>
            <p className="text-[12px] text-[var(--text-secondary)]">
              {trial.sponsor} — {trial.drug} — {trial.indication}
              {trial.sites?.length > 0 && ` — ${trial.sites.length} site${trial.sites.length > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-[var(--text-secondary)] mr-1">
              {trial.slides_confirmed}/{trial.slides_analyzed} confirmed
            </span>
            <Button size="sm" variant="secondary" onClick={() => downloadCsv('export-patients-csv', 'patients')}>
              <Download className="w-3.5 h-3.5" /> Patients CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadCsv('export-corrections-csv', 'corrections')}>
              <Download className="w-3.5 h-3.5" /> Corrections CSV
            </Button>
            <Button size="sm" className="!bg-[#34C759] hover:!bg-[#2CAB4E] !text-white" onClick={downloadTrialSummary}>
              <Download className="w-3.5 h-3.5" /> Trial Summary PDF
            </Button>
            {writable && (
              <Button size="sm" onClick={() => setShowAddPatient(true)}>
                <Plus className="w-3.5 h-3.5" /> Add Patient
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Patient List */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        <DrugProfile trialId={trialId} writable={writable} />
        {patients.length > 0 && <CohortInsights trialId={trialId} />}
        {patients.length === 0 ? (
          <EmptyState icon={FileText} title="No patients yet" subtitle={writable ? 'Add your first patient to begin.' : 'No patients have been added yet.'} />
        ) : (
          <Card size="sm" className="overflow-hidden divide-y divide-[var(--border-subtle)]">
            {orderedPatients.map((patient, idx) => {
              const patientQueries = queries.filter(q => q.patient_uuid === patient.id);
              const openCount = patientQueries.filter(q => q.status !== 'closed').length;
              const isExpanded = !!expandedQueries[patient.id];
              // Each stored record is one visit. Group them so a subject reads
              // as a single longitudinal entity rather than unrelated rows,
              // and show the trajectory once, above that subject's visits.
              const sameSubject = (p: Patient) =>
                p.patient_id.trim().toLowerCase() === patient.patient_id.trim().toLowerCase();
              const isFirstVisitOfSubject = orderedPatients.findIndex(sameSubject) === idx;
              const subjectVisitCount = orderedPatients.filter(sameSubject).length;
              return (
              <div key={patient.id}>
                {isFirstVisitOfSubject && subjectVisitCount > 1 && (
                  <div className="px-4 pt-4">
                    <SubjectTimeline trialId={trialId} patientId={patient.patient_id} />
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 bg-[var(--skeleton-bg)]">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-semibold">Patient {patient.patient_id}</span>
                    {patient.site && <span className="text-[11px] text-[var(--text-secondary)]">{patient.site}</span>}
                    <span className="text-[11px] text-[var(--text-secondary)]">{patient.visit}</span>
                    <Pill accent={patient.status === 'reviewed' ? 'green' : patient.slides.length > 0 ? 'blue' : 'gray'}>
                      {patient.status === 'reviewed' ? 'Reviewed' : patient.slides.length > 0 ? 'Pending Review' : 'No Slides'}
                    </Pill>
                    <button
                      onClick={() => setExpandedQueries({ ...expandedQueries, [patient.id]: !isExpanded })}
                      className="flex items-center gap-1 text-[11px] font-medium transition-colors"
                      style={{ color: openCount > 0 ? '#FF9500' : 'var(--text-secondary)' }}
                    >
                      <MessageSquareWarning className="w-3.5 h-3.5" />
                      {patientQueries.length > 0 ? `${openCount} open ${openCount === 1 ? 'query' : 'queries'}` : 'Queries'}
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setFlagFor(patient.id); setFlagForm({ subject: '', description: '' }); }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[11px] font-semibold bg-[#FF9500]/10 text-[#FF9500] hover:bg-[#FF9500]/15 transition-colors"
                    >
                      <MessageSquareWarning className="w-3 h-3" /> Flag Query
                    </button>
                    {writable && (
                      <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[11px] font-semibold bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/15 transition-colors">
                        <Upload className="w-3 h-3" />
                        Upload .svs
                        <input type="file" accept=".svs" multiple className="hidden" onChange={(e) => e.target.files && handleDrop(patient.id, e.target.files)} />
                      </label>
                    )}
                    {writable && (
                      <button
                        title="Delete patient"
                        onClick={() => removePatient(patient)}
                        className="p-1.5 rounded-[6px] text-[var(--text-secondary)] hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 py-3 bg-[var(--bg-primary)] border-t border-[var(--border-subtle)] space-y-2.5">
                    {patientQueries.length === 0 && (
                      <p className="text-[12px] text-[var(--text-secondary)]">No queries raised for this patient.</p>
                    )}
                    {patientQueries.map(q => (
                      <div key={q.id} className="rounded-[10px] border border-[var(--border-subtle)] p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold">{q.subject}</span>
                            <Pill accent={q.status === 'closed' ? 'gray' : q.status === 'answered' ? 'blue' : 'orange'}>{q.status}</Pill>
                          </div>
                          <span className="text-[10px] text-[var(--text-secondary)]">Raised by {q.raised_by} · {new Date(q.raised_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] mb-2">{q.description}</p>
                        {q.responses.length > 0 && (
                          <div className="space-y-1.5 mb-2 pl-3 border-l-2 border-[var(--border-subtle)]">
                            {q.responses.map((r, i) => (
                              <p key={i} className="text-[11px]"><span className="font-semibold">{r.by}:</span> {r.text}</p>
                            ))}
                          </div>
                        )}
                        {q.status !== 'closed' ? (
                          <div className="flex items-center gap-2">
                            <input
                              placeholder="Write a response…"
                              value={respondText[q.id] || ''}
                              onChange={e => setRespondText({ ...respondText, [q.id]: e.target.value })}
                              onKeyDown={e => e.key === 'Enter' && respondQuery(q.id)}
                              className="flex-1 px-2.5 py-1.5 rounded-[8px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[12px]"
                            />
                            <Button size="sm" variant="secondary" onClick={() => respondQuery(q.id)}>Respond</Button>
                            <Button size="sm" variant="ghost" onClick={() => closeQuery(q.id)}>Close</Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[var(--text-secondary)]">Closed by {q.closed_by} · {q.closed_at && new Date(q.closed_at).toLocaleDateString()}</span>
                            <Button size="sm" variant="ghost" onClick={() => reopenQuery(q.id)}>Reopen</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {patient.slides.length > 0 && (
                  <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[640px]">
                    <tbody>
                      {patient.slides.map((slide) => {
                        const analyzing = !!analyzingIds[slide.id];
                        const hasAI = !!slide.grade && !analyzing;
                        const analysisFailed = slide.status === 'analysis_failed' && !analyzing;
                        const isExpanded = !!expandedSlides[slide.id];
                        return (
                        <React.Fragment key={slide.id}>
                        <tr className="border-t border-[var(--border-subtle)] hover:bg-[var(--skeleton-bg)]/50 transition-colors">
                          <td className="pl-8 pr-3 py-2 w-8">
                            <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                          </td>
                          <td className="px-3 py-2 text-[12px]">
                            {slide.filename}
                            {typeof slide.file_size === 'number' && (
                              <span className="text-[10px] text-[var(--text-secondary)]/60"> · {formatBytes(slide.file_size)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                            <span className="inline-flex items-center gap-1.5">
                              {analyzing ? (
                                <AnalyzingRow stage={analysisStage[slide.id] ?? 0} />
                              ) : slide.confirmed ? (
                                `Confirmed: ${slide.doctor_correction || slide.grade || 'N/A'}`
                              ) : slide.grade ? (
                                <>
                                  {`AI: ${slide.grade} ${slide.grade_group ? `· Grade Group ${slide.grade_group}` : ''} ${slide.confidence ? `(${(slide.confidence * 100).toFixed(0)}%)` : ''}`}
                                </>
                              ) : analysisFailed ? (
                                <span className="text-[#FF3B30]" title={slide.model_error}>Analysis failed{slide.model_error ? `: ${slide.model_error}` : ''}</span>
                              ) : (
                                'Awaiting analysis'
                              )}
                              {hasAI && slide.risk_group && (
                                <Pill accent={RISK_ACCENT[slide.risk_group] || 'gray'} className="!text-[9px] !py-0.5">{slide.risk_group}</Pill>
                              )}
                            </span>
                            {slide.confirmed && slide.signed_by && (
                              <span className="text-[10px] text-[var(--text-secondary)]/70"> · e-signed by {slide.signed_by}</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-end gap-1.5">
                              {hasAI && (
                                <button
                                  title={isExpanded ? 'Hide the full AI pathology report' : 'View the full AI pathology report'}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[11px] font-semibold bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/15 transition-colors whitespace-nowrap"
                                  onClick={() => setExpandedSlides({ ...expandedSlides, [slide.id]: !isExpanded })}
                                >
                                  <Sparkles className="w-3 h-3" />
                                  {isExpanded ? 'Hide AI Report' : 'AI Report'}
                                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>
                              )}
                              <button
                                title="Download PDF report"
                                className="p-1.5 rounded-[6px] hover:bg-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                onClick={() => downloadPatientReport(patient, slide)}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              {writable && !slide.confirmed && !analyzing && (
                                <button
                                  title="Delete slide"
                                  className="p-1.5 rounded-[6px] text-[var(--text-secondary)] hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 transition-colors"
                                  onClick={() => removeSlide(patient.id, slide)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {slide.confirmed ? (
                                <span className="text-[11px] text-[#34C759] flex items-center gap-1 font-medium pr-1"><Check className="w-3.5 h-3.5" /> Done</span>
                              ) : analysisFailed ? (
                                writable ? (
                                  <Button size="sm" className="!bg-[#FF3B30]/10 hover:!bg-[#FF3B30]/15 !text-[#FF3B30] !py-1 !px-2.5 !text-[11px]" onClick={() => runAnalysis(patient.id, slide.id, slide.filename)}>Retry Analysis</Button>
                                ) : (
                                  <span className="text-[11px] text-[#FF3B30]">Failed</span>
                                )
                              ) : !hasAI ? (
                                <span className="text-[11px] text-[var(--text-secondary)]">{analyzing ? '' : '—'}</span>
                              ) : writable ? (
                                <>
                                  <Button size="sm" className="!bg-[#34C759]/10 hover:!bg-[#34C759]/15 !text-[#34C759] !py-1 !px-2.5 !text-[11px]" onClick={() => { setEsign({ mode: 'confirm', patientId: patient.id, slideId: slide.id }); setEsignPassword(''); setEsignError(''); }}>Confirm</Button>
                                  {/* A correction is a training label, so it
                                      must be one of the six grade groups.
                                      Free text accepted "4+3=7", "Gleason
                                      4+3" and typos alike, and none of those
                                      resolve to a usable label. */}
                                  <Button size="sm" className="!bg-[#FFCC00]/15 hover:!bg-[#FFCC00]/25 !text-[#8A6D00] !py-1 !px-2.5 !text-[11px]" onClick={() => {
                                    setCorrecting({ patientId: patient.id, slideId: slide.id, filename: slide.filename, current: slide.grade || '' });
                                  }}>Correct</Button>
                                </>
                              ) : (
                                <span className="text-[11px] text-[var(--text-secondary)]">Awaiting review</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && hasAI && (
                          <tr className="border-t border-[var(--border-subtle)] bg-[var(--skeleton-bg)]/40">
                            <td colSpan={4} className="px-8 py-4">
                              <div className="flex items-center gap-2 mb-4 flex-wrap">
                                {slide.analysis_source === 'ai' ? (
                                  <>
                                    <Pill accent="blue">AI-Assessed Grade</Pill>
                                    <span className="text-[10px] text-[var(--text-secondary)]">
                                      Gleason grade, WHO/ISUP group and confidence are produced by the trained model
                                      (single-fold, QWK 0.7996). Measurements the model does not produce are shown as
                                      &ldquo;Not assessed&rdquo;.
                                    </span>
                                  </>
                                ) : (
                                  // Records analysed before the trained model was integrated still hold
                                  // the old generated values. They must not be presented as model output.
                                  <>
                                    <FlaskConical className="w-3.5 h-3.5 text-[#FF9500]" />
                                    <Pill accent="orange">Superseded result</Pill>
                                    <span className="text-[10px] text-[var(--text-secondary)]">
                                      Produced before the trained model was integrated. Re-analyse this slide for a
                                      model-generated result.
                                    </span>
                                  </>
                                )}
                              </div>

                              <SlideHeatmapPreview slide={slide} patientId={patient.id} />

                              <TrustDisclosure signed={slide.confirmed} />

                              {/* Grade summary */}
                              <div className="grid grid-cols-4 gap-6 mb-5">
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">Gleason Grade <InfoHint term="Gleason Grade" /></p>
                                  <p className="text-[16px] font-bold">{slide.doctor_correction || slide.grade}</p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">WHO/ISUP Grade Group <InfoHint term="WHO/ISUP Grade Group" /></p>
                                  <p className="text-[16px] font-bold">{slide.grade_group ?? '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">Risk Category <InfoHint term="Risk Category" /></p>
                                  {slide.risk_group ? (
                                    <Pill accent={RISK_ACCENT[slide.risk_group] || 'gray'}>{slide.risk_group}</Pill>
                                  ) : <p className="text-[13px]">—</p>}
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">Confidence</p>
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 flex-1 rounded-full bg-[var(--border-subtle)] overflow-hidden max-w-[80px]">
                                      <div className="h-full rounded-full bg-[#007AFF]" style={{ width: `${(slide.confidence || 0) * 100}%` }} />
                                    </div>
                                    <span className="text-[12px] font-medium tabular-nums">{((slide.confidence || 0) * 100).toFixed(0)}%</span>
                                  </div>
                                </div>
                              </div>

                              {/* Key pathological findings */}
                              <div className="mb-5">
                                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">
                                  Key Pathological Findings
                                  {slide.analysis_source === 'ai' && (
                                    <span className="ml-2 normal-case tracking-normal font-normal text-[var(--text-secondary)]">— not produced by this model</span>
                                  )}
                                </p>
                                <div className="grid grid-cols-4 gap-3">
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Tumor Size</p>
                                    <p className="text-[13px] font-semibold">{slide.size_mm != null ? `${slide.size_mm.toFixed(1)} mm` : 'Not assessed'}</p>
                                  </div>
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Tumor Involvement <InfoHint term="Tumour Involvement" /></p>
                                    <p className="text-[13px] font-semibold">{slide.tumor_involvement_pct != null ? `${slide.tumor_involvement_pct}%` : 'Not assessed'}</p>
                                  </div>
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Perineural Invasion <InfoHint term="Perineural Invasion" /></p>
                                    <p className={`text-[13px] font-semibold ${slide.perineural_invasion == null ? '' : slide.perineural_invasion ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                                      {slide.perineural_invasion == null ? 'Not assessed' : slide.perineural_invasion ? 'Present' : 'Absent'}
                                    </p>
                                  </div>
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Lymphovascular Invasion <InfoHint term="Lymphovascular Invasion" /></p>
                                    <p className={`text-[13px] font-semibold ${slide.lymphovascular_invasion == null ? '' : slide.lymphovascular_invasion ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                                      {slide.lymphovascular_invasion == null ? 'Not assessed' : slide.lymphovascular_invasion ? 'Present' : 'Absent'}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {slide.biomarkers && Object.keys(slide.biomarkers).length > 0 && (
                                <div className="mb-5">
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Biomarker Panel</p>
                                  <div className="grid grid-cols-3 gap-3">
                                    {Object.entries(slide.biomarkers).map(([name, bio]) => (
                                      <div key={name} className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                        <p className="text-[10px] text-[var(--text-secondary)]">{name} <InfoHint term={name} /></p>
                                        <p className="text-[13px] font-semibold">{bio.result}</p>
                                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">{bio.interpretation}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {slide.quality && (
                                <div className="mb-3">
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Quality Control</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Pill accent={slide.quality.tissue_quality === 'Adequate' ? 'green' : slide.quality.tissue_quality === 'Not assessed' ? 'gray' : 'orange'}>Tissue: {slide.quality.tissue_quality}</Pill>
                                    <Pill accent={slide.quality.staining_quality === 'Optimal' ? 'green' : slide.quality.staining_quality === 'Not assessed' ? 'gray' : 'orange'}>Staining: {slide.quality.staining_quality}</Pill>
                                    <Pill accent={slide.quality.artifacts_detected === 'None' ? 'green' : slide.quality.artifacts_detected === 'Not assessed' ? 'gray' : 'orange'}>Artifacts: {slide.quality.artifacts_detected}</Pill>
                                  </div>
                                </div>
                              )}

                              <p className="text-[10px] text-[var(--text-secondary)]/70">
                                {slide.regions_analyzed?.toLocaleString()} regions analyzed · {slide.suspicious_regions != null ? `${slide.suspicious_regions} flagged` : 'flagging not assessed'} · {slide.processing_time_s}s processing · {slide.model_version}
                              </p>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            );})}
          </Card>
        )}
      </div>

      {/* Add Patient Modal */}
      {showAddPatient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowAddPatient(false)}>
          <Card size="lg" className="w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold mb-1">Add a visit</h2>
            <p className="text-[12px] text-[var(--text-secondary)] mb-4">
              Every visit belongs to a registered patient. Register a new one, or enrol
              someone already on file.
            </p>

            {/* Mode switch. "Existing" is what lets one person's record span
                several trials. */}
            <div className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--skeleton-bg)] mb-4">
              {([['new', 'New patient'], ['existing', 'Existing patient']] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => { setEnrolMode(m); setAddError(''); }}
                  className={
                    'flex-1 px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-colors ' +
                    (enrolMode === m
                      ? 'bg-[var(--bg-card-solid)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]')
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {enrolMode === 'existing' ? (
                registry.length === 0 ? (
                  <p className="text-[12px] text-[var(--text-secondary)] rounded-[10px] border border-[var(--border-subtle)] px-3 py-2.5">
                    No patients are registered yet. Use &ldquo;New patient&rdquo; instead.
                  </p>
                ) : (
                  <div>
                    <label htmlFor="ap-uid" className="block text-[12.5px] font-medium mb-1.5">Registered patient</label>
                    <select
                      id="ap-uid" value={selectedUid}
                      onChange={e => { setSelectedUid(e.target.value); setAddError(''); }}
                      className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
                    >
                      <option value="">Select a patient…</option>
                      {registry.map(r => (
                        <option key={r.uid} value={r.uid}>
                          {r.uid}{r.initials ? ` · ${r.initials}` : ''}{r.year_of_birth ? ` · b. ${r.year_of_birth}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="ap-initials" className="block text-[12.5px] font-medium mb-1.5">Initials</label>
                    <input id="ap-initials" maxLength={4} placeholder="AB" value={newProfile.initials}
                      onChange={e => setNewProfile({...newProfile, initials: e.target.value})}
                      className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]" />
                  </div>
                  <div>
                    <label htmlFor="ap-yob" className="block text-[12.5px] font-medium mb-1.5">Birth year</label>
                    <input id="ap-yob" inputMode="numeric" placeholder="1958" value={newProfile.year_of_birth}
                      onChange={e => setNewProfile({...newProfile, year_of_birth: e.target.value})}
                      className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]" />
                  </div>
                  <div>
                    <label htmlFor="ap-sex" className="block text-[12.5px] font-medium mb-1.5">Sex</label>
                    <select id="ap-sex" value={newProfile.sex}
                      onChange={e => setNewProfile({...newProfile, sex: e.target.value})}
                      className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]">
                      <option value="">—</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="ap-code" className="block text-[12.5px] font-medium mb-1.5">Subject code</label>
                <input id="ap-code" placeholder="Optional — e.g. S-001" value={patientForm.patient_id} onChange={e => setPatientForm({...patientForm, patient_id: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]" />
                <p className="text-[11px] text-[var(--text-secondary)] mt-1.5">This site&rsquo;s own label for the patient in this trial. The generated patient ID is used if left blank.</p>
              </div>
              {trial.sites?.length > 0 ? (
                <select value={patientForm.site} onChange={e => setPatientForm({...patientForm, site: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]">
                  <option value="">Select site (optional)</option>
                  {trial.sites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input placeholder="Site (optional)" value={patientForm.site} onChange={e => setPatientForm({...patientForm, site: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]" />
              )}
              <select value={patientForm.visit} onChange={e => setPatientForm({...patientForm, visit: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]">
                <option value="Baseline">Baseline (Week 0)</option>
                <option value="Week 6">Week 6</option>
                <option value="Week 12">Week 12</option>
                <option value="Week 24">Week 24</option>
                <option value="End of Treatment">End of Treatment</option>
                <option value="Follow-up">Follow-up</option>
              </select>
              <input placeholder="Notes (optional)" value={patientForm.notes} onChange={e => setPatientForm({...patientForm, notes: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]" />
            </div>
            {addError && (
              <p role="alert" className="text-[12px] text-[#FF3B30] mt-3">{addError}</p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setShowAddPatient(false)} disabled={addingPatient}>Cancel</Button>
              <Button onClick={addPatient} disabled={addingPatient}>{addingPatient ? 'Adding…' : 'Add'}</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Correct grade — a selection, not free text */}
      {correcting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setCorrecting(null)}>
          <Card size="lg" className="w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold mb-1">Correct the grade</h2>
            <p className="text-[12px] text-[var(--text-secondary)] mb-1">{correcting.filename}</p>
            {correcting.current && (
              <p className="text-[12px] text-[var(--text-secondary)] mb-4">
                Omnia reported <strong className="text-[var(--text-primary)]">{correcting.current}</strong>. Choose the correct grade.
              </p>
            )}
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto custom-scrollbar">
              {GRADE_GROUPS.map(g => (
                <button
                  key={g.group}
                  onClick={() => {
                    setEsign({ mode: 'correct', patientId: correcting.patientId, slideId: correcting.slideId, correction: g.text });
                    setEsignPassword(''); setEsignError(''); setCorrecting(null);
                  }}
                  className="w-full text-left px-3.5 py-2.5 rounded-[10px] border border-[var(--border-medium)] hover:border-[#007AFF] hover:bg-[#007AFF]/[0.04] transition-colors"
                >
                  <p className="text-[13px] font-semibold">{g.text}</p>
                  <p className="text-[11px] text-[var(--text-secondary)]">{g.meaning}</p>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] mt-3 leading-relaxed">
              Your correction is recorded against your signature and becomes a teaching example for
              this site&rsquo;s model.
            </p>
            <div className="flex justify-end mt-4">
              <Button variant="ghost" onClick={() => setCorrecting(null)}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Flag Query Modal */}
      {flagFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setFlagFor(null)}>
          <Card size="lg" className="w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold mb-4">Flag Query</h2>
            <div className="space-y-3">
              <input placeholder="Subject (e.g. Slide label mismatch)" value={flagForm.subject} onChange={e => setFlagForm({...flagForm, subject: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]" />
              <textarea placeholder="Describe the discrepancy…" value={flagForm.description} onChange={e => setFlagForm({...flagForm, description: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] resize-none h-24" />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setFlagFor(null)}>Cancel</Button>
              <Button onClick={raiseQuery}>Raise Query</Button>
            </div>
          </Card>
        </div>
      )}

      {/* E-Signature Modal */}
      {esign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => !esignBusy && setEsign(null)}>
          <Card size="lg" className="w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[var(--text-secondary)]" />
                <h2 className="text-[16px] font-bold">Electronic Signature</h2>
              </div>
              <button onClick={() => setEsign(null)} className="p-1 rounded-[6px] hover:bg-[var(--skeleton-bg)]"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] mb-4">
              By entering your password, you certify this action as: <span className="font-semibold text-[var(--text-primary)]">
                {esign.mode === 'confirm' ? 'Reviewed and Approved' : `Reviewed and Corrected (${esign.correction})`}
              </span>
            </p>
            <input
              type="password"
              autoFocus
              placeholder="Enter your password"
              value={esignPassword}
              onChange={e => setEsignPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitESign()}
              className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
            />
            {esignError && <p className="text-[12px] text-[#FF3B30] mt-2">{esignError}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setEsign(null)} disabled={esignBusy}>Cancel</Button>
              <Button onClick={submitESign} disabled={esignBusy || !esignPassword}>{esignBusy ? 'Signing…' : 'Sign & Submit'}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
