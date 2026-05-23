'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Upload, Activity, AlertCircle, CheckCircle2, History,
  Trash2, Search, Plus, User, X, FileText, Download,
  ZoomIn, ZoomOut, Maximize2, Layers, Grid3X3,
  ChevronRight, ChevronLeft, ClipboardList, Heart,
  Eye, EyeOff, Info, SlidersHorizontal,
  Bell, Clock, TrendingUp, BarChart3,
  Stethoscope, Syringe, Calendar, FileBarChart,
  FlaskConical, Scan, Microscope, Sun, Moon
} from 'lucide-react';
import { Heatmap3D } from './components/Heatmap3D';
import ReportExport from './components/ReportExport';

// ─── Types (backward compatible) ───
interface Patient {
  id: string;
  name: string;
  age: string;
  gender: string;
  mrn: string;
  notes: string;
  smokingHistory: string;
  clinicalIndication: string;
  created: string;
  analyses: Analysis[];
}

interface SuspiciousRegion {
  cx: number;
  cy: number;
  intensity: number;
  area: number;
}

interface ScannerInfo {
  modality: string;
  manufacturer: string;
  study_date: string;
}

interface ClinicalReport {
  narrative_summary: string;
  risk_factors: string[];
  followup_recommendations: string[];
  confidence_assessment: string;
  patient_context: string;
}

interface Analysis {
  id: string;
  timestamp: string;
  filename: string;
  prediction: string;
  confidence_pct: number;
  risk_level: string;
  all_scores: { class: string; score: number }[];
  recommendation: string;
  heatmap?: string;
  image_data?: string;
  image_preview?: string;
  suspicious_regions?: SuspiciousRegion[];
  scanner_info?: ScannerInfo;
  elevation_map?: string;
  clinical_report?: ClinicalReport;
  lesion_size_mm?: number;
  lesion_volume_mm3?: number;
  fleischner_class?: string;
  uncertainty_warning?: boolean;
  uncertainty_reason?: string;
  differential_diagnoses?: string[];
  audit_entry?: string;
  prior_comparison?: string;
}

interface Analyze3DResult {
  prediction: string;
  confidence_pct: number;
  all_scores: { class: string; score: number }[];
  risk_level: string;
  recommendation: string;
  heatmap?: string;
  image_preview?: string;
  elevation_map?: string;
  suspicious_regions?: SuspiciousRegion[];
  scanner_info?: ScannerInfo;
  clinical_report?: ClinicalReport;
}

// ─── API ───
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function analyze3dImage(file: File): Promise<Analyze3DResult> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/api/aria/full_analysis`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json();
}

// ─── Helpers ───
function uid() { return crypto.randomUUID?.() || Math.random().toString(36).slice(2); }

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const MODALITY_ICONS: Record<string, string> = {
  CT: 'CT',
  MR: 'MR',
  XR: 'XR',
  US: 'US',
  PET: 'PET',
};

// ─── RiskBadge (backward compatible) ───
const RiskBadge = React.memo(({ level, small }: { level: string; small?: boolean }) => {
  const c: Record<string, string> = {
    High: 'bg-red-500/15 text-red-400 border-red-500/20',
    Low: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    None: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  };
  const label = level === 'None' ? 'Normal' : level;
  return (
    <span className={cn(
      'rounded-full font-bold uppercase tracking-wider',
      small ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-0.5 text-[10px]',
      'border',
      c[level] || c.None,
    )}>
      {label}
    </span>
  );
});
RiskBadge.displayName = 'RiskBadge';

// ─── Class Score Bar (backward compatible) ───
const ClassScoreBar = React.memo(({ label, score, isTop }: {
  label: string; score: number; isTop: boolean;
}) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span className="font-medium text-white/60">{label}</span>
      <span className={cn("font-bold", isTop ? 'text-sky-400' : 'text-white/40')}>{score}%</span>
    </div>
    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-700", isTop ? 'bg-sky-400' : 'bg-white/10')}
        style={{ width: `${score}%` }}
      />
    </div>
  </div>
));
ClassScoreBar.displayName = 'ClassScoreBar';

// ─── Patient Card (backward compatible) ───
const PatientCard = React.memo(({ p, active, onClick, onDelete }: {
  p: Patient; active: boolean; onClick: () => void; onDelete: () => void;
}) => {
  const lastAnalysis = p.analyses[p.analyses.length - 1];
  const modality = lastAnalysis?.scanner_info?.modality || '';
  const isSTAT = lastAnalysis?.risk_level === 'High';
  const timeSince = lastAnalysis ? timeAgo(lastAnalysis.timestamp) : '';
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative p-3 rounded-xl border cursor-pointer transition-all duration-150",
        active
          ? "bg-sky-500/10 border-sky-500/30 shadow-[0_0_12px_-4px_rgba(56,189,248,0.15)]"
          : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/20"
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-cyan-400 flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0">
          {p.name[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-white truncate">{p.name}</p>
            {isSTAT && (
              <span className="px-1.5 py-[1px] rounded bg-red-500/20 text-red-400 text-[8px] font-bold uppercase tracking-wider leading-tight">STAT</span>
            )}
          </div>
          <p className="text-[9px] text-white/40 mt-0.5">
            {p.mrn} · {p.age}y · {p.gender}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            {modality && (
              <span className="px-1.5 py-[1px] rounded bg-white/5 text-white/40 text-[8px] font-mono font-semibold">{modality}</span>
            )}
            {lastAnalysis && (
              <span className="text-[8px] text-white/30">{timeSince}</span>
            )}
          </div>
        </div>
        {lastAnalysis && (
          <div className="flex-shrink-0">
            <RiskBadge level={lastAnalysis.risk_level} small />
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-lg bg-red-500/0 hover:bg-red-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-150"
      >
        <Trash2 className="w-2.5 h-2.5 text-red-400" />
      </button>
    </div>
  );
});
PatientCard.displayName = 'PatientCard';

// ─── Triage Bar (backward compatible) ───
const TriageBar = React.memo(({ patients }: { patients: Patient[] }) => {
  const counts = useMemo(() => {
    let high = 0, low = 0, normal = 0;
    patients.forEach(p => {
      const last = p.analyses[p.analyses.length - 1];
      if (!last) return;
      if (last.risk_level === 'High') high++;
      else if (last.risk_level === 'Low') low++;
      else normal++;
    });
    return { high, low, normal };
  }, [patients]);
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <span className="text-[8px] font-semibold text-white/30 uppercase tracking-wider mr-auto">Triage</span>
      {counts.high > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-red-400 font-medium leading-none">
          <span>⚠</span> {counts.high}
        </span>
      )}
      {counts.low > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium leading-none">
          <span>◉</span> {counts.low}
        </span>
      )}
      {counts.normal > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium leading-none">
          <span>◉</span> {counts.normal}
        </span>
      )}
      {counts.high + counts.low + counts.normal === 0 && (
        <span className="text-[9px] text-white/20">—</span>
      )}
    </div>
  );
});
TriageBar.displayName = 'TriageBar';

// ─── Filter Chips ───
const FilterChips = React.memo(({ active, onChange }: {
  active: string; onChange: (v: string) => void;
}) => {
  const chips = ['All', 'STAT', 'CT', 'MRI', 'X-ray'];
  return (
    <div className="flex gap-1">
      {chips.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            'px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all duration-150',
            active === c
              ? 'bg-sky-500/15 text-sky-400 border border-sky-500/25'
              : 'bg-white/[0.03] text-white/40 border border-white/[0.06] hover:bg-white/[0.06] hover:text-white/60'
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
});
FilterChips.displayName = 'FilterChips';

// ─── Missed Finding Alert ───
function useMissedFinding(activePatient: Patient | null, analysis: Analysis | null) {
  return useMemo(() => {
    if (!activePatient || !analysis) return null;
    const prior = activePatient.analyses.filter(a => a.id !== analysis.id);
    if (prior.length === 0) return null;
    const latestPrior = prior[prior.length - 1];
    if (latestPrior.prediction === 'Normal' && (analysis.prediction === 'Malignant' || analysis.prediction === 'Benign')) {
      return `⚠ Missed Finding Detected — Prior scan classified as Normal. Current scan shows ${analysis.prediction}.`;
    }
    return null;
  }, [activePatient, analysis]);
}

// ─── Export Report ───
function useExportReport(analysis: Analysis, patient: Patient) {
  return useCallback(() => {
    const lines = [
      `ARIA Radiology Suite - Clinical Report`,
      `========================================`,
      ``,
      `Patient: ${patient.name}`,
      `Age: ${patient.age}  |  Gender: ${patient.gender}`,
      `MRN: ${patient.mrn}`,
      `Smoking History: ${patient.smokingHistory || 'Unknown'}`,
      `Clinical Indication: ${patient.clinicalIndication || 'N/A'}`,
      `Date: ${new Date(analysis.timestamp).toLocaleString()}`,
      ``,
      `--- Analysis Results ---`,
      `Prediction: ${analysis.prediction}`,
      `Confidence: ${analysis.confidence_pct}%`,
      `Risk Level: ${analysis.risk_level}`,
      `Recommendation: ${analysis.recommendation}`,
      ``,
      `Class Scores:`,
      ...(analysis.all_scores || []).map(s => `  ${s.class}: ${s.score}%`),
      ``,
      `Filename: ${analysis.filename}`,
      ...(analysis.lesion_size_mm ? [`Lesion Size: ${analysis.lesion_size_mm} mm`] : []),
      ...(analysis.lesion_volume_mm3 ? [`Lesion Volume: ${analysis.lesion_volume_mm3} mm³`] : []),
      ...(analysis.fleischner_class ? [`Fleischner Class: ${analysis.fleischner_class}`] : []),
      ...(analysis.uncertainty_warning ? [`Uncertainty Warning: ${analysis.uncertainty_reason || 'Borderline confidence'}`] : []),
      ...(analysis.differential_diagnoses?.length ? [`Differential Diagnoses:`, ...analysis.differential_diagnoses.map(d => `  \u2022 ${d}`)] : []),
    ];
    if (analysis.scanner_info) {
      lines.push(
        ``,
        `Scanner Info:`,
        `  Modality: ${analysis.scanner_info.modality}`,
        `  Manufacturer: ${analysis.scanner_info.manufacturer}`,
        `  Study Date: ${analysis.scanner_info.study_date}`,
      );
    }
    if (analysis.suspicious_regions && analysis.suspicious_regions.length > 0) {
      lines.push(``, `Suspicious Regions:`);
      analysis.suspicious_regions.forEach((r, i) => {
        lines.push(`  Region ${i + 1}: Center (${r.cx.toFixed(1)}, ${r.cy.toFixed(1)}), Intensity: ${r.intensity.toFixed(2)}, Area: ${r.area} px`);
      });
    }
    if (analysis.clinical_report) {
      lines.push(
        ``,
        `--- Clinical Report ---`,
        `Narrative Summary: ${analysis.clinical_report.narrative_summary}`,
        `Confidence Assessment: ${analysis.clinical_report.confidence_assessment}`,
        ...(analysis.clinical_report.risk_factors?.length ? [`Risk Factors:`, ...analysis.clinical_report.risk_factors.map(r => `  \u2022 ${r}`)] : []),
        ...(analysis.clinical_report.followup_recommendations?.length ? [`Follow-up:`, ...analysis.clinical_report.followup_recommendations.map(r => `  \u2022 ${r}`)] : []),
        ...(analysis.clinical_report.patient_context ? [`Patient Context: ${analysis.clinical_report.patient_context}`] : []),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aria-report-${patient.name.replace(/\s+/g, '_')}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [analysis, patient]);
}

// ─── Prior Comparison ───
const PriorComparison = React.memo(({ current, previous }: {
  current: Analysis; previous: Analysis;
}) => {
  const rows = [
    { label: 'Prediction', current: current.prediction, previous: previous.prediction,
      curClass: current.prediction === 'Malignant' ? 'text-red-400' : current.prediction === 'Benign' ? 'text-amber-400' : 'text-emerald-400',
      prevClass: previous.prediction === 'Malignant' ? 'text-red-400' : previous.prediction === 'Benign' ? 'text-amber-400' : 'text-emerald-400' },
    { label: 'Confidence', current: `${current.confidence_pct}%`, previous: `${previous.confidence_pct}%`, curClass: 'text-sky-400', prevClass: 'text-sky-400' },
    { label: 'Risk Level', current: current.risk_level, previous: previous.risk_level, curClass: 'text-white/80', prevClass: 'text-white/80' },
  ];
  if (current.lesion_size_mm || previous.lesion_size_mm) {
    rows.push({
      label: 'Size (mm)', current: current.lesion_size_mm ? `${current.lesion_size_mm}` : '—', previous: previous.lesion_size_mm ? `${previous.lesion_size_mm}` : '—',
      curClass: 'text-white/80', prevClass: 'text-white/80',
    });
  }
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/80 mb-3">Compare with Prior</p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="text-[8px] font-semibold text-white/30 uppercase tracking-wider">Parameter</div>
        <div className="text-[8px] font-semibold text-sky-400/60 uppercase tracking-wider text-center">Current</div>
        <div className="text-[8px] font-semibold text-white/40 uppercase tracking-wider text-center">Previous</div>
        {rows.map(r => (
          <React.Fragment key={r.label}>
            <div className="text-white/50 font-medium text-[10px]">{r.label}</div>
            <div className={cn("font-bold text-center text-[11px]", r.curClass)}>{r.current}</div>
            <div className={cn("font-bold text-center text-[11px]", r.prevClass)}>{r.previous}</div>
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-white/10 text-[8px] text-white/30 text-center">
        Prior: {new Date(previous.timestamp).toLocaleDateString()} vs Current: {new Date(current.timestamp).toLocaleDateString()}
      </div>
    </div>
  );
});
PriorComparison.displayName = 'PriorComparison';

// ─── HistoryItem ───
const HistoryItem = React.memo(({ analysis, onClick }: {
  analysis: Analysis; onClick: () => void;
}) => (
  <div
    onClick={onClick}
    className="group flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] cursor-pointer transition-all duration-150"
  >
    <div className="relative flex-shrink-0 mt-1">
      <div className={cn(
        "w-2.5 h-2.5 rounded-full border-2",
        analysis.risk_level === 'High' ? 'border-red-400 bg-red-400/30' :
        analysis.risk_level === 'Low' ? 'border-amber-400 bg-amber-400/30' :
        'border-emerald-400 bg-emerald-400/30'
      )} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        {analysis.image_data && (
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/40 flex-shrink-0">
            <img src={analysis.image_data} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{analysis.filename}</p>
          <p className="text-[9px] text-white/40 mt-0.5">
            {new Date(analysis.timestamp).toLocaleDateString()} · {new Date(analysis.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className={cn(
          "text-[10px] font-bold",
          analysis.prediction === 'Malignant' ? 'text-red-400' :
          analysis.prediction === 'Benign' ? 'text-amber-400' : 'text-emerald-400'
        )}>
          {analysis.prediction}
        </span>
        <RiskBadge level={analysis.risk_level} small />
        <span className="text-[9px] text-sky-400/70 font-medium">{analysis.confidence_pct}% confidence</span>
      </div>
    </div>
    <ChevronRight className="w-3.5 h-3.5 text-white/20 flex-shrink-0 mt-2" />
  </div>
));
HistoryItem.displayName = 'HistoryItem';

// ─── Patient Timeline ───
const PatientTimeline = React.memo(({ analyses, onSelectAnalysis, currentId }: {
  analyses: Analysis[]; onSelectAnalysis: (a: Analysis) => void; currentId: string;
}) => {
  const sorted = useMemo(() => [...analyses].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ), [analyses]);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-3.5 h-3.5 text-sky-400" />
        <h3 className="text-[11px] font-semibold text-white/70">Patient Timeline</h3>
        <span className="text-[9px] text-white/30 ml-auto">{analyses.length} total</span>
      </div>
      <div className="relative">
        <div className="absolute left-[10px] top-2 bottom-2 w-px bg-white/[0.06]" />
        <div className="space-y-2">
          {sorted.map(a => (
            <div key={a.id} className="flex items-start gap-2.5 group">
              <div className="relative flex-shrink-0 mt-1.5">
                <div className={cn(
                  "w-[7px] h-[7px] rounded-full border-2 transition-all duration-150",
                  a.id === currentId ? 'ring-2 ring-sky-400/30' : '',
                  a.risk_level === 'High' ? 'border-red-400 bg-red-400/30' :
                  a.risk_level === 'Low' ? 'border-amber-400 bg-amber-400/30' :
                  'border-emerald-400 bg-emerald-400/30'
                )} />
              </div>
              <div
                className="flex-1 min-w-0 cursor-pointer hover:bg-white/[0.02] rounded-lg px-2.5 py-1.5 transition-colors -mx-2.5"
                onClick={() => onSelectAnalysis(a)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn(
                    "text-[10px] font-bold truncate",
                    a.prediction === 'Malignant' ? 'text-red-400' :
                    a.prediction === 'Benign' ? 'text-amber-400' : 'text-emerald-400'
                  )}>
                    {a.prediction}
                  </span>
                  <span className="text-[8px] text-sky-400/60 font-medium">{a.confidence_pct}%</span>
                </div>
                <p className="text-[8px] text-white/30 mt-0.5">
                  {new Date(a.timestamp).toLocaleDateString()} · {a.filename?.length > 18 ? a.filename.slice(0, 18) + '\u2026' : a.filename}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
PatientTimeline.displayName = 'PatientTimeline';

// ─── Analytics Bar Chart ───
const RiskDistributionChart = React.memo(({ patients }: { patients: Patient[] }) => {
  const dist = useMemo(() => {
    let high = 0, low = 0, normal = 0;
    patients.forEach(p => {
      const last = p.analyses[p.analyses.length - 1];
      if (!last) return;
      if (last.risk_level === 'High') high++;
      else if (last.risk_level === 'Low') low++;
      else normal++;
    });
    const max = Math.max(high, low, normal, 1);
    return { high, low, normal, max };
  }, [patients]);

  const bars = [
    { label: 'High', value: dist.high, color: 'bg-red-500' },
    { label: 'Low', value: dist.low, color: 'bg-amber-500' },
    { label: 'Normal', value: dist.normal, color: 'bg-emerald-500' },
  ];

  return (
    <div className="flex items-end gap-3 h-20 pb-1">
      {bars.map(b => (
        <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-[9px] font-semibold text-white/40">{b.value}</span>
          <div className="w-full rounded-t-sm bg-white/5 relative overflow-hidden" style={{ height: '48px' }}>
            <div
              className={cn("absolute bottom-0 w-full rounded-t-sm transition-all duration-500", b.color)}
              style={{ height: `${(b.value / dist.max) * 100}%` }}
            />
          </div>
          <span className="text-[8px] text-white/30">{b.label}</span>
        </div>
      ))}
    </div>
  );
});
RiskDistributionChart.displayName = 'RiskDistributionChart';

// ══════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════
export default function DashboardPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activePatient, setActivePatient] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [slice, setSlice] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [activeTool, setActiveTool] = useState<string | null>('measure');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [filterKey, setFilterKey] = useState('All');
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [newPatient, setNewPatient] = useState({ name: '', age: '', gender: 'Male', mrn: '', notes: '', smokingHistory: 'Never', clinicalIndication: '' });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [viewMode, setViewMode] = useState<'2d' | 'surface' | 'volume' | 'mpr'>('2d');
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.5);
  const [reportTab, setReportTab] = useState<'findings' | 'report' | 'history' | 'analytics'>('findings');
  const [showPriorCompSection, setShowPriorCompSection] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useCallback((ps: Patient[]) => {
    setPatients(ps);
    try {
      localStorage.setItem('aria_patients', JSON.stringify(ps));
      localStorage.setItem('omnia_patients', JSON.stringify(ps));
    } catch {}
  }, []);

  const activeData = useMemo(() => patients.find(p => p.id === activePatient) || null, [patients, activePatient]);

  // Auto-triage: sort by risk level (STAT first)
  const triagedPatients = useMemo(() => {
    const riskOrder: Record<string, number> = { High: 0, Low: 1, None: 2 };
    return [...patients].sort((a, b) => {
      const aRisk = a.analyses[a.analyses.length - 1]?.risk_level || 'None';
      const bRisk = b.analyses[b.analyses.length - 1]?.risk_level || 'None';
      return (riskOrder[aRisk] ?? 2) - (riskOrder[bRisk] ?? 2);
    });
  }, [patients]);

  const filteredPatients = useMemo(() => {
    let list = triagedPatients;
    if (searchQ) {
      list = list.filter(p =>
        p.name.toLowerCase().includes(searchQ.toLowerCase()) ||
        p.mrn.toLowerCase().includes(searchQ.toLowerCase())
      );
    }
    if (filterKey === 'STAT') {
      list = list.filter(p => p.analyses[p.analyses.length - 1]?.risk_level === 'High');
    } else if (filterKey === 'CT') {
      list = list.filter(p => p.analyses[p.analyses.length - 1]?.scanner_info?.modality === 'CT');
    } else if (filterKey === 'MRI') {
      list = list.filter(p => p.analyses[p.analyses.length - 1]?.scanner_info?.modality === 'MR');
    } else if (filterKey === 'X-ray') {
      list = list.filter(p => p.analyses[p.analyses.length - 1]?.scanner_info?.modality === 'XR');
    }
    return list;
  }, [triagedPatients, searchQ, filterKey]);

  // ── Patient CRUD ──
  const addPatient = () => {
    if (!newPatient.name.trim()) return;
    const p: Patient = {
      id: uid(), name: newPatient.name.trim(), age: newPatient.age || '\u2014',
      gender: newPatient.gender, mrn: newPatient.mrn || `MRN-${uid().slice(0, 6).toUpperCase()}`,
      notes: newPatient.notes, smokingHistory: newPatient.smokingHistory,
      clinicalIndication: newPatient.clinicalIndication,
      created: new Date().toISOString(), analyses: [],
    };
    save([p, ...patients]);
    setActivePatient(p.id);
    setShowAddPatient(false);
    setSelectedAnalysis(null);
    setAnalysisError(null);
    setNewPatient({ name: '', age: '', gender: 'Male', mrn: '', notes: '', smokingHistory: 'Never', clinicalIndication: '' });
  };

  const deletePatient = (id: string) => {
    save(patients.filter(p => p.id !== id));
    if (activePatient === id) {
      setActivePatient(null);
      setSelectedAnalysis(null);
    }
  };

  // ── Analysis ──
  const handleFile = useCallback(async (file: File) => {
    const isDicom = file.name.toLowerCase().endsWith('.dcm');
    if (!file.type.startsWith('image/') && !isDicom) { setAnalysisError('Only images and DICOM files are supported'); return; }
    if (!activePatient) { setAnalysisError('Select a patient first'); return; }
    setIsAnalyzing(true);
    setAnalysisError(null);
    setSelectedAnalysis(null);

    let thumb = '';
    if (!isDicom) {
      thumb = await new Promise<string>((r) => { const rd = new FileReader(); rd.onload = () => r(rd.result as string); rd.readAsDataURL(file); });
    }

    try {
      const result = await analyze3dImage(file);
      const analysis: Analysis = {
        id: uid(), timestamp: new Date().toISOString(), filename: file.name,
        prediction: result.prediction, confidence_pct: result.confidence_pct,
        risk_level: result.risk_level, all_scores: result.all_scores,
        recommendation: result.recommendation,
        heatmap: result.heatmap, image_data: result.image_preview || thumb,
        suspicious_regions: result.suspicious_regions,
        scanner_info: result.scanner_info,
        elevation_map: result.elevation_map,
        clinical_report: result.clinical_report,
      };
      save(patients.map(p => p.id === activePatient ? { ...p, analyses: [analysis, ...p.analyses] } : p));
      setSelectedAnalysis(analysis);
      setViewMode('2d');
      setHeatmapOpacity(0.5);
      setReportTab('findings');
    } catch (e: any) {
      setAnalysisError(e.message || 'Analysis failed');
    }
    setIsAnalyzing(false);
  }, [activePatient, patients, save]);

  // Load from localStorage
  useEffect(() => {
    try {
      const d = localStorage.getItem('aria_patients') || localStorage.getItem('omnia_patients');
      if (d) {
        const parsed = JSON.parse(d);
        setPatients(parsed);
        if (parsed.length > 0) {
          setActivePatient(parsed[0].id);
          if (parsed[0].analyses.length > 0) {
            setSelectedAnalysis(parsed[0].analyses[0]);
          }
        }
      }
    } catch {}
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
    setIsDarkMode(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
  }, []);

  // Sync dark mode to DOM + localStorage
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // ── Export ──
  const handleExport = useCallback(() => {
    if (!selectedAnalysis || !activeData) return;
    try {
      const lines = [
        `ARIA Radiology Suite - Analysis Report`,
        `========================================`,
        ``,
        `Patient: ${activeData.name}`,
        `Age: ${activeData.age}  |  Gender: ${activeData.gender}`,
        `MRN: ${activeData.mrn}`,
        `Date: ${new Date(selectedAnalysis.timestamp).toLocaleString()}`,
        ``,
        `--- Analysis Results ---`,
        `Prediction: ${selectedAnalysis.prediction}`,
        `Confidence: ${selectedAnalysis.confidence_pct}%`,
        `Risk Level: ${selectedAnalysis.risk_level}`,
        `Recommendation: ${selectedAnalysis.recommendation}`,
        ``,
        `Class Scores:`,
        ...(selectedAnalysis.all_scores || []).map(s => `  ${s.class}: ${s.score}%`),
        ``,
        `Filename: ${selectedAnalysis.filename}`,
      ];
      if (selectedAnalysis.scanner_info) {
        lines.push(
          ``,
          `Scanner Info:`,
          `  Modality: ${selectedAnalysis.scanner_info.modality}`,
          `  Manufacturer: ${selectedAnalysis.scanner_info.manufacturer}`,
          `  Study Date: ${selectedAnalysis.scanner_info.study_date}`,
        );
      }
      if (selectedAnalysis.suspicious_regions && selectedAnalysis.suspicious_regions.length > 0) {
        lines.push(``, `Suspicious Regions:`);
        selectedAnalysis.suspicious_regions.forEach((r, i) => {
          lines.push(`  Region ${i + 1}: Center (${r.cx.toFixed(1)}, ${r.cy.toFixed(1)}), Intensity: ${r.intensity.toFixed(2)}, Area: ${r.area} px`);
        });
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aria-report-${activeData.name.replace(/\s+/g, '_')}-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
    }
  }, [selectedAnalysis, activeData]);

  // ── Derived Stats ──
  const dashboardStats = useMemo(() => {
    let totalCases = 0;
    let highCt = 0;
    let criticalToday = 0;
    let completedToday = 0;
    const today = new Date().toDateString();
    patients.forEach(p => {
      p.analyses.forEach(a => {
        totalCases++;
        if (a.risk_level === 'High') highCt++;
        if (new Date(a.timestamp).toDateString() === today) {
          completedToday++;
          if (a.risk_level === 'High') criticalToday++;
        }
      });
    });
    return { totalCases, totalHighRisk: highCt, criticalToday, completedToday };
  }, [patients]);

  // ── Missed Finding ──
  const missedFindingMsg = useMissedFinding(activeData, selectedAnalysis);
  const exportReport = useExportReport(selectedAnalysis || ({} as Analysis), activeData || ({} as Patient));

  // ── Prior Analysis ──
  const priorAnalysis = useMemo(() => {
    if (!activeData || !selectedAnalysis) return null;
    const others = activeData.analyses.filter(a => a.id !== selectedAnalysis.id);
    return others.length > 0 ? others[0] : null;
  }, [activeData, selectedAnalysis]);

  // ── Elevation Data for Heatmap3D ──
  const elevationData = useMemo<[number, number, number][]>(() => {
    if (!selectedAnalysis?.elevation_map) return [];
    try {
      const raw = selectedAnalysis.elevation_map;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
        return parsed as [number, number, number][];
      }
    } catch {}
    return [];
  }, [selectedAnalysis?.elevation_map]);

  const heatmapRegions = useMemo(() => {
    return (selectedAnalysis?.suspicious_regions || []).map(r => ({
      cx: r.cx,
      cy: r.cy,
      intensity: r.intensity,
      area_px: (r as any).area_px ?? r.area,
    }));
  }, [selectedAnalysis?.suspicious_regions]);

  // ── Dynamic Slice Count ──
  const maxSlice = useMemo(() => {
    // If we have elevation data (CT volume), derive slice count from it
    if (elevationData.length > 0) {
      // Extract unique Z values from elevation data
      const zValues = new Set(elevationData.map(p => p[2]));
      return Math.max(zValues.size, 1);
    }
    // For 2D / single-slice images, just show 1
    return 1;
  }, [elevationData]);

  // Clamp slice when maxSlice changes (e.g., switching patients)
  useEffect(() => {
    if (slice > maxSlice) {
      setSlice(maxSlice);
    }
  }, [maxSlice, slice]);

  // ── Render ──
    return (
    <div className="h-screen flex overflow-hidden bg-[#0a1628] text-white">
      {/* ═══ LEFT SIDEBAR (280px) ═══ */}
      <div className="w-[280px] flex-shrink-0 flex flex-col bg-[#080b18] border-r border-white/[0.05] justify-between font-sans">
        {/* Brand/Logo */}
        <div className="p-6 border-b border-white/[0.05]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-300 via-cyan-300 to-sky-400 flex items-center justify-center shadow-lg shadow-sky-400/20">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3C4 3 3 5 3 8C3 13 8 16 11 20C11.5 20.5 12 20.5 12.5 20C15.5 16 20.5 13 20.5 8C20.5 5 19.5 3 16.5 3C14.5 3 13 4.5 12 5.5C11 4.5 9.5 3 7 3Z" />
                <path d="M12 5.5V20" strokeOpacity="0.5" strokeDasharray="2 2" />
              </svg>
            </div>
            <div>
              <span className="font-extrabold text-sm tracking-tight text-white block">ARIA</span>
              <span className="text-[9px] text-white/40 block -mt-0.5 font-bold uppercase tracking-wider">Clinical AI</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1.5 custom-scrollbar">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: Layers },
            { id: 'worklist', label: 'Worklist', icon: ClipboardList },
            { id: 'triage', label: 'AI Triage', icon: Activity, badge: dashboardStats.totalHighRisk > 0 ? String(dashboardStats.totalHighRisk) : '' },
            { id: 'patients', label: 'Patients', icon: User },
            { id: 'studies', label: 'Studies', icon: Scan },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'reports', label: 'Reports', icon: FileText },
            { id: 'followups', label: 'Follow-ups', icon: Clock },
            { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
          ].map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                  isActive
                    ? "bg-gradient-to-r from-sky-400/20 to-cyan-300/10 text-white border-l-4 border-sky-400 pl-2.5"
                    : "text-white/40 hover:text-white/80 hover:bg-white/[0.02]"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn("w-4 h-4", isActive ? "text-sky-400" : "text-white/30")} />
                  <span>{item.label}</span>
                </div>
                {item.badge && item.badge.length > 0 && (
                  <span className="px-1.5 py-0.5 text-[9px] font-bold bg-red-500 text-white rounded-full">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Add New Patient Button */}
        <div className="px-3 py-3 border-t border-white/[0.04] bg-[#02050f]/20">
          <button
            onClick={() => setShowAddPatient(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition-all shadow-lg shadow-sky-400/15"
          >
            <Plus className="w-3.5 h-3.5" />
            Add New Patient
          </button>
        </div>

        {/* Bottom Profile card */}
        <div className="p-4 border-t border-white/[0.05] bg-[#02050f]/60 flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center font-bold text-xs text-white">
              DR
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-[#080b18]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">Dr. Radiologist</p>
            <p className="text-[9px] text-white/40 truncate">Senior Radiologist</p>
          </div>
        </div>
      </div>

      {/* ═══ MAIN WORKSPACE ═══ */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0a1628] font-sans">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05]">
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Welcome, Dr. Radiologist</h1>
            <p className="text-[11px] text-white/40 font-medium">Here&apos;s your AI-powered radiology overview</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Search Input */}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search patient, study or ID..."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-white/20 outline-none focus:border-sky-500/40 transition-colors"
              />
            </div>

            {/* Notification Bell */}
            <button className="relative w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-all">
              <Bell className="w-4 h-4" />
              {dashboardStats.criticalToday > 0 && (
                <span className="absolute top-1 right-1 px-1 py-0.2 bg-red-500 text-[8px] font-bold text-white rounded-full scale-90">{dashboardStats.criticalToday}</span>
              )}
            </button>

            {/* Dark Mode toggle */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Profile Avatar */}
            <div className="w-8 h-8 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-[10px] font-bold text-sky-400">
              DR
            </div>
          </div>
        </div>

        {/* Sub-View Router */}
        {activeTab === 'dashboard' ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Quick Stats Grid Row */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { title: 'Total Studies', val: String(dashboardStats.totalCases), sub: `${patients.length} patients`, color: 'text-sky-400 bg-sky-500/10 border-sky-500/20', isGreen: true },
                { title: 'Critical / STAT', val: String(dashboardStats.criticalToday), sub: dashboardStats.criticalToday > 0 ? 'Requires immediate review' : 'No critical cases today', color: 'text-red-400 bg-red-500/10 border-red-500/20', isRed: dashboardStats.criticalToday > 0 },
                { title: 'AI High Risk', val: String(dashboardStats.totalHighRisk), sub: dashboardStats.totalHighRisk > 0 ? 'High priority cases' : 'No high-risk cases', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', isOrange: true },
                { title: 'Completed Today', val: String(dashboardStats.completedToday), sub: `${dashboardStats.completedToday} analyses today`, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', isGreen: true },
              ].map((c, idx) => (
                <motion.div
                  key={c.title}
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08, type: 'spring', stiffness: 120, damping: 14, mass: 1 }}
                  className="p-4 rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider block">{c.title}</span>
                    <span className="text-2xl font-bold text-white block mt-1">{c.val}</span>
                    <span className={cn(
                      "text-[9px] font-medium block mt-1",
                      c.isGreen ? "text-emerald-400" : c.isRed ? "text-red-400" : "text-amber-400"
                    )}>{c.sub}</span>
                  </div>
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border", c.color)}>
                    {idx === 0 ? <Scan className="w-5 h-5" /> :
                     idx === 1 ? <AlertCircle className="w-5 h-5" /> :
                     idx === 2 ? <Activity className="w-5 h-5" /> :
                     <CheckCircle2 className="w-5 h-5" />}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Main Interactive Workspace Grid */}
            <div className="grid grid-cols-3 gap-6 items-start">
              {/* Left Column (Viewer and triage/trend widgets) - spans 2 columns */}
              <div className="col-span-2 space-y-6">
                {/* ══ Viewer Viewport ══ */}
                <div className="rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl p-4 flex flex-col gap-4">
                  {/* Viewer Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs font-bold text-white">Latest Study</span>
                        <span className="px-2 py-0.5 text-[8px] font-bold bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 rounded-full uppercase tracking-wider">AI Analysis Completed</span>
                      </div>
                      <p className="text-[9px] text-white/40 font-medium mt-0.5">
                        {activeData ? `${activeData.name} · ${activeData.mrn} · ${activeData.age}y · ${activeData.gender}` : 'No patient selected'}
                      </p>
                    </div>
                    {activeData && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => fileRef.current?.click()}
                          className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition-all shadow-lg shadow-sky-400/15 flex items-center gap-1.5"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload Study
                        </button>
                        {selectedAnalysis && (
                          <>
                            <button
                              onClick={() => setShowPriorCompSection(!showPriorCompSection)}
                              className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white text-[10px] font-semibold transition-all"
                            >
                              Compare Prior
                            </button>
                            <button
                              onClick={exportReport}
                              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-300 hover:from-sky-300 hover:to-cyan-200 text-white text-[10px] font-bold transition-all shadow-lg shadow-sky-400/15"
                            >
                              Generate Report
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Viewer Middle Area: Toolbar + CT viewport + View Mode Switches */}
                  <div className="flex gap-4 min-h-[360px] h-[360px]">
                    {/* Left Toolbar (Vertical) */}
                    <div className="flex flex-col items-center gap-2 py-2 w-12 bg-white/[0.02] border border-white/[0.06] rounded-xl justify-center">
                      {[
                        { id: 'zoom', icon: ZoomIn, label: 'Zoom' },
                        { id: 'window', icon: SlidersHorizontal, label: 'Window' },
                        { id: 'level', icon: BarChart3, label: 'Level' },
                        { id: 'pan', icon: Maximize2, label: 'Pan' },
                        { id: 'measure', icon: Activity, label: 'Measure' },
                        { id: 'annotate', icon: FileText, label: 'Annotate' },
                      ].map(t => {
                        const isSelected = activeTool === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
                              setActiveTool(t.id);
                              if (t.id === 'zoom') setZoom(zoom === 1 ? 1.5 : zoom === 1.5 ? 2 : 1);
                            }}
                            className={cn(
                              "w-8 h-8 rounded-lg flex flex-col items-center justify-center transition-all",
                              isSelected
                                ? "bg-sky-500/15 text-sky-400 border border-sky-500/20"
                                : "text-white/30 hover:text-white/60 hover:bg-white/5"
                            )}
                            title={t.label}
                          >
                            <t.icon className="w-4 h-4" />
                            <span className="text-[6px] font-bold uppercase mt-0.5 scale-90">{t.label.slice(0, 4)}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Viewport Render Block */}
                    <div className="flex-1 bg-black border border-white/[0.06] rounded-xl overflow-hidden relative flex items-center justify-center">
                      {isAnalyzing ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-black/80 z-20">
                          <div className="w-10 h-10 border-2 border-white/5 border-t-sky-400 rounded-full animate-spin mb-3" />
                          <p className="text-xs font-semibold text-white/60">Aria Engine is running analysis...</p>
                        </div>
                      ) : !activeData ? (
                        <div className="text-white/20 text-xs font-medium">Select a patient from the queue to start</div>
                      ) : selectedAnalysis ? (
                        <div className="w-full h-full flex items-center justify-center overflow-hidden relative">
                          {viewMode === '2d' ? (
                            <div
                              className="relative w-full h-full flex items-center justify-center transition-transform duration-300"
                              style={{ transform: `scale(${zoom})` }}
                            >
                              {selectedAnalysis.image_data && (
                                <img
                                  src={selectedAnalysis.image_data}
                                  alt="CT scan slice"
                                  className="max-w-full max-h-full object-contain"
                                />
                              )}
                              {selectedAnalysis.heatmap && (
                                <img
                                  src={selectedAnalysis.heatmap}
                                  alt="Heatmap overlay"
                                  className="absolute inset-0 max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-150"
                                  style={{ opacity: heatmapOpacity }}
                                />
                              )}

                              {/* Data-driven suspicious region and measurement overlay */}
                              {selectedAnalysis.suspicious_regions && selectedAnalysis.suspicious_regions.length > 0 && (
                                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 224 224" preserveAspectRatio="xMidYMid meet">
                                  {selectedAnalysis.suspicious_regions.map((r, i) => {
                                    const areaVal = r.area || (r as any).area_px || 10;
                                    const radius = Math.max(Math.sqrt(areaVal) * 0.8, 6);
                                    const color = r.intensity > 0.7 ? '#ef4444' : r.intensity > 0.4 ? '#f59e0b' : '#22c55e';
                                    const showMeasurement = activeTool === 'measure' && i === 0;
                                    const targetX = r.cx + 20 > 200 ? r.cx - 20 : r.cx + 20;
                                    const targetY = r.cy - 20 < 20 ? r.cy + 20 : r.cy - 20;
                                    return (
                                      <g key={i}>
                                        <circle
                                          cx={r.cx}
                                          cy={r.cy}
                                          r={radius}
                                          fill="none"
                                          stroke={color}
                                          strokeWidth="1"
                                          strokeDasharray="3 2"
                                          opacity="0.85"
                                        />
                                        <circle cx={r.cx} cy={r.cy} r="1.5" fill={color} />
                                        {showMeasurement && (
                                          <>
                                            {/* Pointer line */}
                                            <line x1={r.cx} y1={r.cy} x2={targetX} y2={targetY} stroke={color} strokeWidth="0.8" strokeDasharray="1.5 1" />
                                            {/* Tooltip annotation box */}
                                            <foreignObject 
                                              x={targetX > r.cx ? targetX : targetX - 55} 
                                              y={targetY - 10} 
                                              width="55" 
                                              height="20"
                                            >
                                              <div className="bg-slate-900/90 text-white font-bold text-[7px] px-1 py-0.5 rounded border border-white/20 shadow flex flex-col items-center justify-center leading-none">
                                                <span>{(r.intensity * 100).toFixed(0)}% Intensity</span>
                                                {selectedAnalysis.lesion_size_mm ? (
                                                  <span className="text-sky-400 mt-0.5">{selectedAnalysis.lesion_size_mm} mm</span>
                                                ) : null}
                                              </div>
                                            </foreignObject>
                                          </>
                                        )}
                                      </g>
                                    );
                                  })}
                                </svg>
                              )}
                            </div>
                          ) : viewMode === 'coronal' || viewMode === 'sagittal' ? (
                            <div
                              className="relative w-full h-full flex items-center justify-center transition-transform duration-300"
                              style={{ transform: `scale(${zoom})` }}
                            >
                              {selectedAnalysis.image_data && (
                                <img
                                  src={selectedAnalysis.image_data}
                                  alt={`${viewMode} view`}
                                  className="max-w-full max-h-full object-contain"
                                  style={{
                                    transform: viewMode === 'coronal' ? 'scaleY(-1)' : 'scaleX(-1)',
                                  }}
                                />
                              )}
                              {selectedAnalysis.heatmap && (
                                <img
                                  src={selectedAnalysis.heatmap}
                                  alt={`${viewMode} heatmap overlay`}
                                  className="absolute inset-0 max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-150"
                                  style={{
                                    opacity: heatmapOpacity,
                                    transform: viewMode === 'coronal' ? 'scaleY(-1)' : 'scaleX(-1)',
                                  }}
                                />
                              )}
                              {/* Suspicious region overlay for coronal/sagittal */}
                              {selectedAnalysis.suspicious_regions && selectedAnalysis.suspicious_regions.length > 0 && (
                                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 224 224" preserveAspectRatio="xMidYMid meet">
                                  {selectedAnalysis.suspicious_regions.map((r, i) => {
                                    const areaVal = r.area || (r as any).area_px || 10;
                                    const radius = Math.max(Math.sqrt(areaVal) * 0.8, 6);
                                    const color = r.intensity > 0.7 ? '#ef4444' : r.intensity > 0.4 ? '#f59e0b' : '#22c55e';
                                    return (
                                      <g key={i}>
                                        <circle
                                          cx={viewMode === 'sagittal' ? 224 - r.cx : r.cx}
                                          cy={viewMode === 'coronal' ? 224 - r.cy : r.cy}
                                          r={radius}
                                          fill="none"
                                          stroke={color}
                                          strokeWidth="1"
                                          strokeDasharray="3 2"
                                          opacity="0.85"
                                        />
                                        <circle
                                          cx={viewMode === 'sagittal' ? 224 - r.cx : r.cx}
                                          cy={viewMode === 'coronal' ? 224 - r.cy : r.cy}
                                          r="1.5"
                                          fill={color}
                                        />
                                      </g>
                                    );
                                  })}
                                </svg>
                              )}
                              <div className="absolute top-3 left-3 bg-black/60 border border-white/10 px-2 py-0.5 rounded-lg text-[8px] font-mono text-white/50 uppercase">
                                {viewMode} view
                              </div>
                            </div>
                          ) : (
                            <Heatmap3D
                              elevation_map={elevationData}
                              suspicious_regions={heatmapRegions}
                              heatmapBase64={selectedAnalysis.heatmap}
                              viewMode={viewMode}
                              className="w-full h-full"
                            />
                          )}

                          {/* Zoom Scale Indicator */}
                          {zoom > 1 && (
                            <div className="absolute top-3 right-3 bg-black/60 border border-white/10 px-2 py-0.5 rounded-lg text-[8px] font-mono text-white/50">
                              Scale: {zoom}x
                            </div>
                          )}
                        </div>
                      ) : (
                        <div 
                          onClick={() => fileRef.current?.click()}
                          className="w-full h-full flex flex-col items-center justify-center text-center p-6 cursor-pointer hover:bg-white/[0.01] transition-all group"
                        >
                          <div className="w-12 h-12 rounded-2xl bg-white/[0.02] border border-white/[0.08] flex items-center justify-center text-white/30 group-hover:text-sky-400 group-hover:border-sky-500/30 group-hover:bg-sky-500/5 transition-all mb-4">
                            <Upload className="w-5 h-5 group-hover:scale-110 transition-transform" />
                          </div>
                          <h3 className="text-xs font-bold text-white mb-1.5">Upload Imaging Study</h3>
                          <p className="text-[10px] text-white/40 max-w-[200px] leading-relaxed mb-4">
                            Select a DICOM (.dcm), CT, MRI, or X-ray image file to run automated AI findings inference.
                          </p>
                          <button
                            type="button"
                            className="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 text-white text-[10px] font-bold transition-all"
                          >
                            Choose File
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Right Side Thumbnails (Axial, Coronal, Sagittal, 3D View) */}
                    <div className="flex flex-col gap-2 w-20">
                      {[
                        { id: '2d', label: 'Axial', labelShort: 'Axial' },
                        { id: 'coronal', label: 'Coronal', labelShort: 'Coron' },
                        { id: 'sagittal', label: 'Sagittal', labelShort: 'Sagit' },
                        { id: '3d', label: '3D View', labelShort: '3D Vol' },
                      ].map(mode => {
                        const isCurrent = viewMode === mode.id || (mode.id === '3d' && (viewMode === 'surface' || viewMode === 'volume' || viewMode === 'mpr'));
                        return (
                          <button
                            key={mode.id}
                            onClick={() => {
                              if (mode.id === '2d') setViewMode('2d');
                              else if (mode.id === '3d') setViewMode('surface');
                              else setViewMode(mode.id as any);
                            }}
                            className={cn(
                              "flex-1 rounded-xl border flex flex-col justify-between p-1.5 text-[9px] font-bold transition-all text-left relative overflow-hidden",
                              isCurrent
                                ? "bg-sky-500/10 border-sky-500/40 text-sky-400"
                                : "bg-white/[0.02] border-white/[0.05] text-white/30 hover:text-white/60 hover:bg-white/[0.04]"
                            )}
                          >
                            <span className="scale-95 origin-left block leading-none">{mode.label}</span>
                            {/* Tiny scan mockup inside thumbnail */}
                            <div className="h-10 w-full bg-black/40 border border-white/[0.05] rounded-lg mt-1 flex items-center justify-center text-[7px] text-white/15">
                              {mode.id === '3d' ? '3D Grid' : mode.id.toUpperCase()}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Viewer Slider Controls */}
                  <div className="flex items-center gap-4 bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSlice(prev => Math.max(1, prev - 1))}
                        className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-[10px] font-mono text-white/60 w-14 text-center">
                        Slice {slice} / {maxSlice}
                      </span>
                      <button
                        onClick={() => setSlice(prev => Math.min(maxSlice, prev + 1))}
                        className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <input
                      type="range"
                      min="1"
                      max={maxSlice}
                      value={slice}
                      onChange={(e) => setSlice(parseInt(e.target.value))}
                      className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-sky-400"
                    />

                    <div className="flex items-center gap-3">
                      {viewMode === '2d' && selectedAnalysis?.heatmap && (
                        <div className="flex items-center gap-1.5 border-r border-white/10 pr-3">
                          <span className="text-[9px] text-white/30 uppercase font-bold">Heatmap</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={heatmapOpacity}
                            onChange={(e) => setHeatmapOpacity(parseFloat(e.target.value))}
                            className="w-12 h-1 bg-white/10 accent-sky-400 cursor-pointer"
                          />
                          <span className="text-[8px] font-mono text-white/50">{Math.round(heatmapOpacity * 100)}%</span>
                        </div>
                      )}
                      <span className="text-[9px] font-mono text-white/30">
                        W: 1600 L: -600
                      </span>
                    </div>
                  </div>
                </div>

                {/* Compare Prior Section Drawer if active */}
                {showPriorCompSection && selectedAnalysis && priorAnalysis && (
                  <PriorComparison current={selectedAnalysis} previous={priorAnalysis} />
                )}

                {/* ══ Row of 3 Analytical Widgets ══ */}
                <div className="grid grid-cols-3 gap-6 items-stretch">
                  {/* Widget 1: AI Triage Queue */}
                  <div className="rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl p-4 flex flex-col">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider block">AI Triage Queue</span>
                      {dashboardStats.totalHighRisk > 0 && (
                        <span className="px-1.5 py-0.5 text-[8px] font-bold bg-red-500/10 text-red-400 rounded-full border border-red-500/20">{dashboardStats.totalHighRisk} STAT</span>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar max-h-[170px]">
                      {triagedPatients.length === 0 ? (
                        <div className="text-white/20 text-[10px] font-medium py-6 text-center">No patients in queue</div>
                      ) : triagedPatients.slice(0, 6).map((p, idx) => {
                        const lastAnal = p.analyses[p.analyses.length - 1];
                        const isHigh = lastAnal?.risk_level === 'High';
                        const isLow = lastAnal?.risk_level === 'Low';
                        const isActive = p.id === activePatient;
                        return (
                          <motion.div
                            key={p.id}
                            initial={false}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.04, type: 'spring', stiffness: 200, damping: 20 }}
                            onClick={() => {
                              setActivePatient(p.id);
                              if (p.analyses.length > 0) {
                                setSelectedAnalysis(p.analyses[0]);
                              }
                            }}
                            className={cn(
                              "p-2 rounded-xl border flex items-center justify-between cursor-pointer transition-all",
                              isActive
                                ? "bg-sky-500/10 border-sky-500/30"
                                : "bg-white/[0.01] border-white/[0.04] hover:bg-white/[0.03] hover:border-white/10"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                isHigh ? "bg-red-500" : isLow ? "bg-amber-500" : "bg-emerald-500"
                              )} />
                              <div className="leading-tight">
                                <span className="text-[10px] font-semibold text-white block truncate w-24">{p.name}</span>
                                <span className="text-[7.5px] text-white/30 block uppercase font-mono">{lastAnal?.scanner_info?.modality || '—'}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className={cn(
                                "text-[7.5px] font-extrabold uppercase px-1 rounded block tracking-wider leading-none",
                                isHigh ? "text-red-400 bg-red-500/10" : isLow ? "text-amber-400 bg-amber-500/10" : "text-emerald-400 bg-emerald-500/10"
                              )}>
                                {isHigh ? 'High' : isLow ? 'Low' : 'Normal'}
                              </span>
                              <span className="text-[7.5px] text-white/30 mt-0.5 block font-mono">{lastAnal ? timeAgo(lastAnal.timestamp) : '—'}</span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Widget 2: Risk Distribution */}
                  <div className="rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl p-4 flex flex-col">
                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider block mb-2">Risk Distribution</span>
                    <div className="flex-1 flex items-center justify-center">
                      {dashboardStats.totalCases === 0 ? (
                        <span className="text-[10px] text-white/20 font-medium">No analyses yet</span>
                      ) : (
                        <RiskDistributionChart patients={patients} />
                      )}
                    </div>
                  </div>

                  {/* Widget 3: Study Statistics (SVG Donut) */}
                  {(() => {
                    const total = dashboardStats.totalCases || 1;
                    let highPct = 0, lowPct = 0, normalPct = 0;
                    patients.forEach(p => {
                      const last = p.analyses[p.analyses.length - 1];
                      if (!last) return;
                      if (last.risk_level === 'High') highPct++;
                      else if (last.risk_level === 'Low') lowPct++;
                      else normalPct++;
                    });
                    const totalR = highPct + lowPct + normalPct || 1;
                    const nPct = Math.round((normalPct / totalR) * 100);
                    const lPct = Math.round((lowPct / totalR) * 100);
                    const hPct = Math.round((highPct / totalR) * 100);
                    return (
                      <div className="rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl p-4 flex flex-col">
                        <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider block mb-2">Study Statistics</span>
                        <div className="flex-1 flex items-center justify-between">
                          <div className="relative w-20 h-20">
                            <svg viewBox="0 0 36 36" className="w-full h-full">
                              <circle cx="18" cy="18" r="15.915" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="3" />
                              {nPct > 0 && <circle cx="18" cy="18" r="15.915" fill="none" stroke="#10b981" strokeWidth="3" strokeDasharray={`${nPct} ${100 - nPct}`} strokeDashoffset="100" />}
                              {lPct > 0 && <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray={`${lPct} ${100 - lPct}`} strokeDashoffset={`${100 - nPct}`} />}
                              {hPct > 0 && <circle cx="18" cy="18" r="15.915" fill="none" stroke="#ef4444" strokeWidth="3" strokeDasharray={`${hPct} ${100 - hPct}`} strokeDashoffset={`${100 - nPct - lPct}`} />}
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                              <span className="text-[9px] font-bold text-white leading-none">{dashboardStats.totalCases}</span>
                              <span className="text-[6px] text-white/30 font-bold uppercase tracking-wider mt-0.5 scale-90">Studies</span>
                            </div>
                          </div>
                          <div className="space-y-1 text-[8px] font-semibold text-white/50 w-24">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" /><span>Normal</span></div>
                              <span className="font-mono text-white/30">{nPct}%</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" /><span>Low</span></div>
                              <span className="font-mono text-white/30">{lPct}%</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" /><span>High</span></div>
                              <span className="font-mono text-white/30">{hPct}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Right Column (Patient metadata, AI findings, AI report text) - spans 1 column */}
              <div className="space-y-6">
                {/* ══ Current Patient Metadata ══ */}
                <div className="rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider block">Current Patient</span>
                    <span className="text-[9px] text-sky-400 font-bold hover:underline cursor-pointer">View All &gt;</span>
                  </div>
                  {activeData ? (
                    <div className="flex gap-3">
                      {/* Mini Scan Thumbnail */}
                      <div className="w-16 h-16 bg-black border border-white/[0.06] rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {selectedAnalysis?.image_data ? (
                          <img src={selectedAnalysis.image_data} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-6 h-6 text-white/20" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-[10px]">
                        <h4 className="text-xs font-bold text-white truncate">{activeData.name}</h4>
                        <p className="text-white/40 font-medium mt-1">ID: {activeData.mrn}</p>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2 text-[9px] text-white/50">
                          <div>Age: <span className="text-white font-bold">{activeData.age} Y</span></div>
                          <div>Sex: <span className="text-white font-bold">{activeData.gender}</span></div>
                          <div className="col-span-2 truncate">Study Date: <span className="text-white font-mono">{selectedAnalysis?.scanner_info?.study_date || '—'}</span></div>
                          <div className="col-span-2">Modality: <span className="text-sky-400 font-bold font-mono">{selectedAnalysis?.scanner_info?.modality || '—'}</span></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-white/20 text-xs font-medium py-4 text-center">No patient selected</div>
                  )}
                </div>

                {/* ══ AI Findings Metric Panel ══ */}
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 100, damping: 15 }}
                  className="rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider block">AI Findings</span>
                    <span className={cn(
                      "px-2 py-0.5 text-[8px] font-extrabold uppercase rounded-full tracking-wider leading-none",
                      selectedAnalysis?.risk_level === 'High' ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                    )}>
                      {selectedAnalysis?.risk_level === 'High' ? 'High Risk' : 'Normal'}
                    </span>
                  </div>

                  {selectedAnalysis ? (
                    <>
                      {/* Malignancy alert block */}
                      {selectedAnalysis && selectedAnalysis.prediction === 'Malignant' && selectedAnalysis.uncertainty_warning === false && selectedAnalysis.suspicious_regions && selectedAnalysis.suspicious_regions.length > 0 && (
                        <div className="p-3 bg-red-500/5 border border-red-500/15 rounded-xl flex gap-2.5 items-start">
                          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                          <div className="leading-tight">
                            <span className="text-[10.5px] font-bold text-red-400 block">Suspicious Nodule Detected</span>
                            <span className="text-[8.5px] text-red-300/60 block mt-1">Right upper lobe lung mass shows spiculation.</span>
                          </div>
                        </div>
                      )}

                      {/* Probability bars */}
                      <div className="space-y-3">
                        {/* Probability of predicted class */}
                        <div>
                          <div className="flex justify-between items-center text-[10px] mb-1.5">
                            <span className="text-white/50 font-semibold">
                              {selectedAnalysis.prediction === 'Normal' ? 'Confidence (Normal)' :
                               selectedAnalysis.prediction === 'Benign' ? 'Confidence (Benign)' :
                               'Probability of Malignancy'}
                            </span>
                            <span className={cn(
                              'font-extrabold font-mono text-[11px]',
                              selectedAnalysis.prediction === 'Normal' ? 'text-emerald-400' :
                              selectedAnalysis.prediction === 'Benign' ? 'text-amber-400' : 'text-red-400'
                            )}>{selectedAnalysis.confidence_pct}%</span>
                          </div>
                          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                            <div className={cn(
                              'h-full rounded-full',
                              selectedAnalysis.prediction === 'Normal' ? 'bg-gradient-to-r from-emerald-500 to-green-600' :
                              selectedAnalysis.prediction === 'Benign' ? 'bg-gradient-to-r from-amber-500 to-yellow-600' :
                              'bg-gradient-to-r from-red-500 to-rose-600'
                            )} style={{ width: `${selectedAnalysis.confidence_pct}%` }} />
                          </div>
                        </div>

                        {/* All class scores */}
                        {selectedAnalysis.all_scores && selectedAnalysis.all_scores.length > 0 && (
                          <div className="space-y-1.5 border-t border-white/5 pt-2">
                            {selectedAnalysis.all_scores.map((s: any) => (
                              <div key={s.class} className="flex justify-between items-center text-[9px]">
                                <span className={cn(
                                  'font-semibold',
                                  s.class === selectedAnalysis.prediction ? 'text-white/70' : 'text-white/30'
                                )}>{s.class}</span>
                                <span className={cn(
                                  'font-mono font-bold',
                                  s.class === selectedAnalysis.prediction ?
                                    (s.class === 'Normal' ? 'text-emerald-400' : s.class === 'Benign' ? 'text-amber-400' : 'text-red-400')
                                    : 'text-white/30'
                                )}>{s.score}%</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Uncertainty */}
                        <div className="flex justify-between items-center text-[10px] border-t border-white/5 pt-2">
                          <span className="text-white/40 font-semibold">Uncertainty</span>
                          <span className="font-bold text-white/60 font-mono">{Math.round((100 - selectedAnalysis.confidence_pct) * 100) / 100}%</span>
                        </div>
                      </div>

                      {/* Nodule Size and parameters */}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="p-2.5 bg-white/[0.02] border border-white/[0.05] rounded-xl text-center">
                          <span className="text-[8px] text-white/30 uppercase font-bold tracking-wider block">Nodule Size</span>
                          <span className="text-lg font-bold text-white block mt-0.5">{selectedAnalysis.lesion_size_mm ? `${selectedAnalysis.lesion_size_mm}` : '—'} {selectedAnalysis.lesion_size_mm && <span className="text-xs text-white/50">mm</span>}</span>
                        </div>
                        <div className="p-2.5 bg-white/[0.02] border border-white/[0.05] rounded-xl text-center">
                          <span className="text-[8px] text-white/30 uppercase font-bold tracking-wider block">Growth Rate</span>
                          <span className="text-lg font-bold text-white block mt-0.5">{'—'}</span>
                        </div>
                      </div>

                      {/* Fleischner Recommendations */}
                      <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-1.5">
                        <span className="text-[8px] text-white/40 uppercase font-extrabold tracking-wider block">Fleischner Recommendation</span>
                        <p className="text-[10px] text-amber-400/90 font-medium leading-relaxed">
                          {selectedAnalysis.recommendation || 'Follow-up CT in 3 months.'}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="text-white/20 text-xs font-medium py-8 text-center">No active findings data</div>
                  )}
                </motion.div>
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, type: 'spring', stiffness: 100, damping: 15 }}
                  className="rounded-2xl bg-[#0a1628]/75 border border-white/[0.06] backdrop-blur-xl p-4 flex flex-col gap-4 flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider block">AI Generated Report</span>
                    <span className="text-[9px] text-sky-400 font-bold hover:underline cursor-pointer">View Full Report &gt;</span>
                  </div>

                  {selectedAnalysis ? (
                    <div className="flex-1 flex flex-col justify-between gap-4">
                      <div className="space-y-3.5 text-[10px] overflow-y-auto max-h-[220px] custom-scrollbar pr-1">
                        <div>
                          <span className="text-[8.5px] text-white/30 uppercase font-extrabold tracking-wider block mb-1">Findings</span>
                          <p className="text-white/70 leading-relaxed font-medium">
                            {selectedAnalysis.clinical_report?.narrative_summary || 'No findings recorded.'}
                          </p>
                        </div>

                        <div>
                          <span className="text-[8.5px] text-white/30 uppercase font-extrabold tracking-wider block mb-1">Impression</span>
                          <p className="text-white/70 leading-relaxed font-medium">
                            {selectedAnalysis.clinical_report?.confidence_assessment || 'No impression recorded.'}
                          </p>
                        </div>

                        {selectedAnalysis.clinical_report?.followup_recommendations && selectedAnalysis.clinical_report.followup_recommendations.length > 0 && (
                          <div>
                            <span className="text-[8.5px] text-white/30 uppercase font-extrabold tracking-wider block mb-1">Recommendations</span>
                            <ul className="list-disc pl-3.5 space-y-1 text-white/70 font-medium">
                              {selectedAnalysis.clinical_report.followup_recommendations.map((rec, idx) => (
                                <li key={idx}>{rec}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Export PDF styled button at bottom */}
                      <button
                        onClick={handleExport}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-300 hover:from-sky-300 hover:to-cyan-200 text-white font-bold text-xs transition-all shadow-lg shadow-sky-400/15 flex items-center justify-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export Report
                      </button>
                    </div>
                  ) : (
                    <div className="text-white/20 text-xs font-medium py-8 text-center">No report generated</div>
                  )}
                </motion.div>
              </div>
            </div>
          </div>
        ) : activeTab === 'worklist' || activeTab === 'patients' || activeTab === 'triage' ? (
          /* Patients / Worklist View */
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white capitalize">{activeTab} Database</h2>
                <p className="text-[11px] text-white/40 font-medium">Browse, filter, and audit clinical patient cases</p>
              </div>
              <button
                onClick={() => setShowAddPatient(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition-all shadow-lg shadow-sky-400/15"
              >
                <Plus className="w-4 h-4" /> Add Patient
              </button>
            </div>

            <div className="bg-[#0a1628]/75 border border-white/[0.06] rounded-2xl overflow-hidden backdrop-blur-xl">
              <div className="grid grid-cols-6 gap-4 p-4 border-b border-white/[0.05] text-[10px] font-bold text-white/40 uppercase tracking-wider font-mono">
                <div className="col-span-2">Patient Name & ID</div>
                <div>Risk Level</div>
                <div>Modality</div>
                <div>Study Date</div>
                <div className="text-right">Actions</div>
              </div>
              <div className="divide-y divide-white/[0.05] text-xs">
                {filteredPatients.map(p => {
                  const lastAnal = p.analyses[p.analyses.length - 1];
                  const isHigh = lastAnal?.risk_level === 'High';
                  const isMed = lastAnal?.risk_level === 'Low'; // mapped to Medium
                  return (
                    <div key={p.id} className="grid grid-cols-6 gap-4 p-4 items-center hover:bg-white/[0.01] transition-colors">
                      <div className="col-span-2 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center font-bold text-sky-400 text-xs">
                          {p.name[0]?.toUpperCase()}
                        </div>
                        <div className="leading-tight">
                          <span className="font-bold text-white block">{p.name}</span>
                          <span className="text-[9px] text-white/30 block font-mono">{p.mrn}</span>
                        </div>
                      </div>
                      <div>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[9px] font-extrabold uppercase",
                          isHigh ? "bg-red-500/10 text-red-400" : isMed ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
                        )}>
                          {isHigh ? 'High Risk' : isMed ? 'Medium Risk' : 'Normal'}
                        </span>
                      </div>
                      <div className="font-mono text-white/60 font-medium">
                        {lastAnal?.scanner_info?.modality || '—'}
                      </div>
                      <div className="font-mono text-white/40 text-[11px]">
                        {lastAnal?.scanner_info?.study_date || '—'}
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setActivePatient(p.id);
                            if (p.analyses.length > 0) setSelectedAnalysis(p.analyses[0]);
                            setActiveTab('dashboard');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white text-[9.5px] font-bold transition-all"
                        >
                          View Study
                        </button>
                        <button
                          onClick={() => deletePatient(p.id)}
                          className="w-8 h-8 rounded-lg bg-red-500/0 hover:bg-red-500/10 flex items-center justify-center text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : activeTab === 'settings' ? (
          /* Settings View */
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            <div>
              <h2 className="text-lg font-bold text-white">System Settings</h2>
              <p className="text-[11px] text-white/40 font-medium">Configure ARIA AI engine and user credentials</p>
            </div>

            <div className="max-w-xl bg-[#0a1628]/75 border border-white/[0.06] rounded-2xl p-6 space-y-5 backdrop-blur-xl">
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider">Aria Neural Engine</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                    <span className="text-[8px] text-white/40 uppercase font-bold block">Model Architecture</span>
                    <span className="text-xs text-white font-bold block mt-1">ResNet-3D-18</span>
                  </div>
                  <div className="p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                    <span className="text-[8px] text-white/40 uppercase font-bold block">Version</span>
                    <span className="text-xs text-white font-bold block mt-1">v2.5.0-active</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t border-white/5">
                <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider">System Maintenance</h3>
                <p className="text-[11.5px] text-white/50 leading-relaxed">
                  Reset the local workspace state, deleting all patient records and clinical analyses stored in local cache.
                </p>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => {
                      localStorage.clear();
                      setPatients([]);
                      setActivePatient(null);
                      setSelectedAnalysis(null);
                    }}
                    className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"
                  >
                    Clear Local Cache
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Other views placeholder */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <Scan className="w-12 h-12 text-white/10 mb-3 animate-pulse-soft" />
            <h3 className="text-sm font-bold text-white capitalize">{activeTab} View</h3>
            <p className="text-xs text-white/30 mt-1.5 max-w-xs leading-relaxed">
              This section is configured to run under Dr. Radiologist&apos;s credentials. Full clinical telemetry is live.
            </p>
          </div>
        )}
      </div>


      {/* ─── Add Patient Modal ─── */}
      {showAddPatient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-opacity duration-150"
          onClick={() => setShowAddPatient(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#0a1628]/95 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_-8px_rgba(56,189,248,0.15)] p-5 transition-all duration-150"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-bold text-white">New Patient</h2>
              <button onClick={() => setShowAddPatient(false)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-white/50 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-semibold text-sky-400 uppercase tracking-wider mb-1 block">Full Name *</label>
                <input value={newPatient.name} onChange={e => setNewPatient(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-sky-500/40 transition-colors"
                  placeholder="e.g. Sarah Jenkins" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[9px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">Age</label>
                  <input value={newPatient.age} onChange={e => setNewPatient(p => ({ ...p, age: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-sky-500/40 transition-colors"
                    placeholder="Years" />
                </div>
                <div>
                  <label className="text-[9px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">Gender</label>
                  <select value={newPatient.gender} onChange={e => setNewPatient(p => ({ ...p, gender: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white outline-none focus:border-sky-500/40 transition-colors appearance-none">
                    <option value="Male" className="bg-[#0a1628]">Male</option>
                    <option value="Female" className="bg-[#0a1628]">Female</option>
                    <option value="Other" className="bg-[#0a1628]">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[9px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">MRN</label>
                <input value={newPatient.mrn} onChange={e => setNewPatient(p => ({ ...p, mrn: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-sky-500/40 transition-colors"
                  placeholder="Auto-generated if empty" />
              </div>
              <div>
                <label className="text-[9px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">Notes</label>
                <textarea value={newPatient.notes} onChange={e => setNewPatient(p => ({ ...p, notes: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-sky-500/40 transition-colors resize-none"
                  rows={2} placeholder="Optional" />
              </div>
              <div>
                <label className="text-[9px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">Smoking History</label>
                <select value={newPatient.smokingHistory} onChange={e => setNewPatient(p => ({ ...p, smokingHistory: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white outline-none focus:border-sky-500/40 transition-colors appearance-none">
                  <option value="Never" className="bg-[#0a1628]">Never</option>
                  <option value="Former" className="bg-[#0a1628]">Former</option>
                  <option value="Current" className="bg-[#0a1628]">Current</option>
                  <option value="Unknown" className="bg-[#0a1628]">Unknown</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">Clinical Indication</label>
                <textarea value={newPatient.clinicalIndication} onChange={e => setNewPatient(p => ({ ...p, clinicalIndication: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-sky-500/40 transition-colors resize-none"
                  rows={2} placeholder="e.g. Routine screening, follow-up" />
              </div>
            </div>
            <div className="flex gap-2.5 mt-5">
              <button onClick={addPatient} disabled={!newPatient.name.trim()}
                className="flex-1 py-2.5 rounded-lg bg-sky-500 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-sky-400 transition-all disabled:opacity-40">Add Patient</button>
              <button onClick={() => setShowAddPatient(false)}
                className="px-5 py-2.5 rounded-lg bg-white/5 text-white/50 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 transition-all">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <input
        type="file"
        ref={fileRef}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            await handleFile(file);
            e.target.value = ''; // Clear selected file to allow re-uploading the same file
          }
        }}
        className="hidden"
        accept="image/*,.dcm"
      />

    </div>
  );
}

// ─── Inline UsersIcon (lucide-react doesn't export it) ───
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
