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

interface Biomarker { result: string; interpretation: string; }
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

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

/** Deterministic PRNG (Park-Miller) so the same slide always renders the same mock heatmap. */
function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

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

/** Illustrative mock heatmap over a synthetic H&E-toned viewport — not the real uploaded image.
 * Deterministic per slide so it looks stable, not randomly regenerated on every render. */
function SlideHeatmapPreview({ slide }: { slide: Slide }) {
  const rand = seededRandom(hashString(slide.id));
  const gradeGroup = slide.grade_group || 1;
  const regionCount = Math.min(slide.suspicious_regions || 8, 22);

  const blobs = Array.from({ length: 6 }).map(() => ({
    x: 10 + rand() * 80,
    y: 8 + rand() * 60,
    r: 6 + rand() * 10,
  }));
  const regions = Array.from({ length: regionCount }).map(() => ({
    x: 8 + rand() * 84,
    y: 8 + rand() * 60,
    r: 2.5 + rand() * 4,
    heat: Math.min(1, (gradeGroup / 5) * 0.55 + rand() * 0.5),
  }));

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Slide Preview</p>
        <span className="text-[9px] text-[var(--text-secondary)]/60">Simulated heatmap — illustrative only, not the uploaded image</span>
      </div>
      <div
        className="relative rounded-[10px] overflow-hidden border border-[var(--border-subtle)] max-w-[360px]"
        style={{ aspectRatio: '4 / 3', background: 'linear-gradient(135deg, #f3e0ea 0%, #e6cfe0 40%, #d9bfd8 100%)' }}
      >
        <svg viewBox="0 0 100 75" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          {blobs.map((b, i) => (
            <ellipse key={i} cx={b.x} cy={b.y} rx={b.r} ry={b.r * 0.7} fill="#c9a0c0" opacity={0.28} />
          ))}
          {regions.map((r, i) => (
            <circle key={i} cx={r.x} cy={r.y} r={r.r} fill={heatColor(r.heat)} opacity={0.55} />
          ))}
        </svg>
      </div>
      <div className="flex items-center gap-1.5 mt-2 max-w-[360px]">
        <span className="text-[9px] text-[var(--text-secondary)]">Low</span>
        <div className="h-1.5 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, #34C759, #FFCC00, #FF9500, #FF3B30)' }} />
        <span className="text-[9px] text-[var(--text-secondary)]">High tumor probability</span>
      </div>
    </div>
  );
}

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

  const addPatient = async () => {
    if (!patientForm.patient_id) return;
    try {
      await apiSend(`/api/trials/${trialId}/patients`, {
        method: 'POST',
        body: JSON.stringify(patientForm),
      });
      setShowAddPatient(false);
      setPatientForm({ patient_id: '', visit: 'Baseline', notes: '', site: '' });
      loadData();
      toast.show(`Patient ${patientForm.patient_id} added`);
    } catch (e) {
      console.error('Failed to add patient', e);
      toast.show(e instanceof Error ? e.message : 'Failed to add patient', 'error');
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
      const [res] = await Promise.all([
        apiFetch(`/api/trials/patients/${patientId}/slides/${slideId}/analyze`, { method: 'POST' }),
        minDelay,
      ]);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || 'Analysis failed');
      }
      loadData();
      toast.show(`AI analysis complete for ${filename} (prototype)`, 'info');
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
          ai_confidence: slide.confidence || 0,
          tumor_size_mm: slide.size_mm || 0,
          doctor_correction: slide.doctor_correction || null,
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
      <div className="border-b border-[var(--border-subtle)] px-6 py-3 bg-[var(--bg-card-solid)]">
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
        {patients.length === 0 ? (
          <EmptyState icon={FileText} title="No patients yet" subtitle={writable ? 'Add your first patient to begin.' : 'No patients have been added yet.'} />
        ) : (
          <Card size="sm" className="overflow-hidden divide-y divide-[var(--border-subtle)]">
            {patients.map((patient) => {
              const patientQueries = queries.filter(q => q.patient_uuid === patient.id);
              const openCount = patientQueries.filter(q => q.status !== 'closed').length;
              const isExpanded = !!expandedQueries[patient.id];
              return (
              <div key={patient.id}>
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
                  <table className="w-full text-left border-collapse">
                    <tbody>
                      {patient.slides.map((slide) => {
                        const analyzing = !!analyzingIds[slide.id];
                        const hasAI = !!slide.grade && !analyzing;
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
                              ) : !hasAI ? (
                                <span className="text-[11px] text-[var(--text-secondary)]">{analyzing ? '' : '—'}</span>
                              ) : writable ? (
                                <>
                                  <Button size="sm" className="!bg-[#34C759]/10 hover:!bg-[#34C759]/15 !text-[#34C759] !py-1 !px-2.5 !text-[11px]" onClick={() => { setEsign({ mode: 'confirm', patientId: patient.id, slideId: slide.id }); setEsignPassword(''); setEsignError(''); }}>Confirm</Button>
                                  <Button size="sm" className="!bg-[#FFCC00]/15 hover:!bg-[#FFCC00]/25 !text-[#8A6D00] !py-1 !px-2.5 !text-[11px]" onClick={async () => {
                                    const c = await prompt({
                                      title: 'Correct Grade',
                                      message: `Enter the correct grade for ${slide.filename}.`,
                                      placeholder: 'e.g. 4+3=7',
                                      confirmLabel: 'Continue',
                                    });
                                    if (c) { setEsign({ mode: 'correct', patientId: patient.id, slideId: slide.id, correction: c }); setEsignPassword(''); setEsignError(''); }
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
                                <FlaskConical className="w-3.5 h-3.5 text-[#FF9500]" />
                                <Pill accent="orange">Prototype — Simulated AI Output</Pill>
                                <span className="text-[10px] text-[var(--text-secondary)]">Will be replaced by the trained model when integrated.</span>
                              </div>

                              <SlideHeatmapPreview slide={slide} />

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
                                <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Key Pathological Findings</p>
                                <div className="grid grid-cols-4 gap-3">
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Tumor Size</p>
                                    <p className="text-[13px] font-semibold">{slide.size_mm?.toFixed(1)} mm</p>
                                  </div>
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Tumor Involvement <InfoHint term="Tumour Involvement" /></p>
                                    <p className="text-[13px] font-semibold">{slide.tumor_involvement_pct ?? '—'}%</p>
                                  </div>
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Perineural Invasion <InfoHint term="Perineural Invasion" /></p>
                                    <p className={`text-[13px] font-semibold ${slide.perineural_invasion ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                                      {slide.perineural_invasion === undefined ? '—' : slide.perineural_invasion ? 'Present' : 'Absent'}
                                    </p>
                                  </div>
                                  <div className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                                    <p className="text-[10px] text-[var(--text-secondary)]">Lymphovascular Invasion <InfoHint term="Lymphovascular Invasion" /></p>
                                    <p className={`text-[13px] font-semibold ${slide.lymphovascular_invasion ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                                      {slide.lymphovascular_invasion === undefined ? '—' : slide.lymphovascular_invasion ? 'Present' : 'Absent'}
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
                                    <Pill accent={slide.quality.tissue_quality === 'Adequate' ? 'green' : 'orange'}>Tissue: {slide.quality.tissue_quality}</Pill>
                                    <Pill accent={slide.quality.staining_quality === 'Optimal' ? 'green' : 'orange'}>Staining: {slide.quality.staining_quality}</Pill>
                                    <Pill accent={slide.quality.artifacts_detected === 'None' ? 'green' : 'orange'}>Artifacts: {slide.quality.artifacts_detected}</Pill>
                                  </div>
                                </div>
                              )}

                              <p className="text-[10px] text-[var(--text-secondary)]/70">
                                {slide.regions_analyzed?.toLocaleString()} regions analyzed · {slide.suspicious_regions} flagged · {slide.processing_time_s}s processing · {slide.model_version}
                              </p>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
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
            <h2 className="text-[17px] font-bold mb-4">Add Patient</h2>
            <div className="space-y-3">
              <input placeholder="Patient ID (e.g. 001)" value={patientForm.patient_id} onChange={e => setPatientForm({...patientForm, patient_id: e.target.value})} className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]" />
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
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setShowAddPatient(false)}>Cancel</Button>
              <Button onClick={addPatient}>Add</Button>
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
