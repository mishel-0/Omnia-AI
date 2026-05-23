'use client';

import React, { forwardRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { FileText, Printer } from 'lucide-react';

// ─── Full Analysis Type (extends the base type with optional fields) ───
interface SuspiciousRegion {
  cx: number;
  cy: number;
  intensity: number;
  area_px: number;
}

interface ScannerInfo {
  modality?: string;
  manufacturer?: string;
  model?: string;
  kvp?: number;
  exposure?: number;
  [key: string]: unknown;
}

interface AllScore {
  class: string;
  score: number;
}

export interface Analysis {
  id: string;
  timestamp: string;
  filename: string;
  prediction: string;
  confidence_pct: number;
  risk_level: string;
  all_scores: AllScore[];
  recommendation: string;
  heatmap?: string;
  image_data?: string;
  suspicious_regions?: SuspiciousRegion[];
  scanner_info?: ScannerInfo;
  elevation_map?: string;
}

// ─── Patient Info (optional, for richer reports) ───
export interface PatientInfo {
  name: string;
  age?: string;
  gender?: string;
  mrn?: string;
  dob?: string;
  notes?: string;
}

// ─── Props ───
interface ReportExportProps {
  analysis: Analysis;
  patient?: PatientInfo | null;
  /** Hide elements outside the report during print */
  className?: string;
}

// ─── Color Helpers ───
const riskColors: Record<string, { text: string; bg: string; border: string; badge: string }> = {
  High: {
    text: 'text-red-500 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800/40',
    badge: 'bg-red-500 text-white',
  },
  Low: {
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800/40',
    badge: 'bg-amber-500 text-white',
  },
  None: {
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800/40',
    badge: 'bg-emerald-500 text-white',
  },
};

const scoreBarColors = [
  'bg-sky-500 dark:bg-sky-400',
  'bg-cyan-500 dark:bg-cyan-400',
  'bg-blue-500 dark:bg-blue-400',
  'bg-rose-500 dark:bg-rose-400',
  'bg-amber-500 dark:bg-amber-400',
  'bg-teal-500 dark:bg-teal-400',
  'bg-sky-600 dark:bg-sky-500',
  'bg-orange-500 dark:bg-orange-400',
];

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ═══════════════════════════════════════════════════
//  Report Content (the printable view)
// ═══════════════════════════════════════════════════

const ReportContent = forwardRef<HTMLDivElement, ReportExportProps>(
  function ReportContent({ analysis, patient, className }, ref) {
    const risk = riskColors[analysis.risk_level] || riskColors.None;

    // Determine which image to show: heatmap preferred, fallback to source image
    const displayImage = analysis.heatmap || analysis.image_data || null;

    return (
      <div
        ref={ref}
        className={cn(
          'bg-white dark:bg-slate-950 text-slate-900 dark:text-white',
          className,
        )}
      >
        {/* ── Print Styles ── */}
        <style>{`
          @media print {
            @page {
              size: A4 portrait;
              margin: 18mm 15mm 15mm 15mm;
            }
            body {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }
            .no-print { display: none !important; }
            .print-break-inside { break-inside: avoid; page-break-inside: avoid; }
            .print-break-before { break-before: page; }
          }
        `}</style>

        {/* ── Header / Brand ── */}
        <div className="flex items-center justify-between pb-5 mb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">Omnia AI</h1>
              <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Radiology Report</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Report Generated</p>
            <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{formatTimestamp(new Date().toISOString())}</p>
          </div>
        </div>

        {/* ── Patient & Scan Info Side by Side ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6 print-break-inside">
          {/* Patient Info */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-3">Patient Information</p>
            {patient ? (
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[10px] text-slate-400">Name</span>
                  <span className="text-[11px] font-semibold text-slate-900 dark:text-white">{patient.name}</span>
                </div>
                {patient.mrn && (
                  <div className="flex justify-between">
                    <span className="text-[10px] text-slate-400">MRN</span>
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{patient.mrn}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  {patient.age && (
                    <>
                      <span className="text-[10px] text-slate-400">Age</span>
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{patient.age}</span>
                    </>
                  )}
                  {patient.gender && (
                    <>
                      <span className="text-[10px] text-slate-400">Gender</span>
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{patient.gender}</span>
                    </>
                  )}
                  {patient.dob && (
                    <>
                      <span className="text-[10px] text-slate-400">DOB</span>
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{patient.dob}</span>
                    </>
                  )}
                </div>
                {patient.notes && (
                  <div className="pt-1.5 mt-1.5 border-t border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] text-slate-400 block mb-0.5">Notes</span>
                    <span className="text-[10px] text-slate-600 dark:text-slate-400 italic">{patient.notes}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 italic">—</p>
            )}
          </div>

          {/* Scan Info */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-3">Scan Information</p>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[10px] text-slate-400">Filename</span>
                <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate ml-4 max-w-[200px]">{analysis.filename}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-slate-400">Analysis ID</span>
                <span className="text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300">{analysis.id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-slate-400">Date Analyzed</span>
                <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{formatTimestamp(analysis.timestamp)}</span>
              </div>
              {analysis.scanner_info && (
                <>
                  {analysis.scanner_info.modality && (
                    <div className="flex justify-between">
                      <span className="text-[10px] text-slate-400">Modality</span>
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{analysis.scanner_info.modality}</span>
                    </div>
                  )}
                  {analysis.scanner_info.manufacturer && (
                    <div className="flex justify-between">
                      <span className="text-[10px] text-slate-400">Manufacturer</span>
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{analysis.scanner_info.manufacturer}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Prediction ── */}
        <div className="flex items-start justify-between gap-4 mb-5 print-break-inside">
          <div className="flex-1">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-1">AI Diagnosis</p>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{analysis.prediction}</h2>
          </div>
          <div className={cn('px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider', risk.badge)}>
            {analysis.risk_level === 'None' ? 'Normal' : analysis.risk_level}
          </div>
        </div>

        {/* ── Confidence Bar (primary prediction) ── */}
        <div className="mb-6 print-break-inside">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Confidence</span>
            <span className="text-sm font-bold text-slate-900 dark:text-white">{analysis.confidence_pct}%</span>
          </div>
          <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${analysis.confidence_pct}%` }}
            />
          </div>
        </div>

        {/* ── All Class Scores (colored bars) ── */}
        <div className="mb-6 print-break-inside">
          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-3">Class Probabilities</p>
          <div className="space-y-2.5">
            {analysis.all_scores.map((s, i) => (
              <div key={s.class}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[11px] font-semibold',
                        s.class === analysis.prediction
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-600 dark:text-slate-400',
                      )}
                    >
                      {s.class}
                    </span>
                    {s.class === analysis.prediction && (
                      <span className="text-[7px] font-bold uppercase tracking-widest text-blue-500 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded">
                        Primary
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {s.score}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      s.class === analysis.prediction
                        ? 'bg-blue-500'
                        : scoreBarColors[i % scoreBarColors.length],
                    )}
                    style={{ width: `${s.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Recommendation ── */}
        <div
          className={cn(
            'rounded-xl border p-4 mb-6 print-break-inside',
            risk.border,
            risk.bg,
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={cn('w-1.5 h-1.5 rounded-full', risk.text === 'text-red-500 dark:text-red-400' ? 'bg-red-500' : risk.text === 'text-amber-600 dark:text-amber-400' ? 'bg-amber-500' : 'bg-emerald-500')} />
            <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Clinical Recommendation</span>
          </div>
          <p className="text-[12px] font-medium leading-relaxed text-slate-700 dark:text-slate-300">
            {analysis.recommendation}
          </p>
        </div>

        {/* ── Heatmap / Scan Image ── */}
        {displayImage && (
          <div className="mb-6 print-break-inside">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              {analysis.heatmap ? 'Grad-CAM Heatmap Overlay' : 'Source Scan'}
            </p>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-2">
              <img
                src={displayImage}
                alt={analysis.heatmap ? 'Grad-CAM heatmap overlay' : 'Source medical image'}
                className="max-w-full max-h-[420px] object-contain rounded-lg"
                style={{ imageRendering: 'auto' }}
              />
            </div>
          </div>
        )}

        {/* ── Elevation Map ── */}
        {analysis.elevation_map && (
          <div className="mb-6 print-break-inside">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-2">Elevation Map</p>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-2">
              <img
                src={analysis.elevation_map}
                alt="Elevation map"
                className="max-w-full max-h-[320px] object-contain rounded-lg"
              />
            </div>
          </div>
        )}

        {/* ── Suspicious Regions ── */}
        {analysis.suspicious_regions && analysis.suspicious_regions.length > 0 && (
          <div className="mb-6 print-break-inside">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-3">
              Suspicious Regions
              <span className="ml-1.5 text-slate-400 font-medium normal-case">({analysis.suspicious_regions.length} detected)</span>
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/80">
                    <th className="text-[8px] font-bold uppercase tracking-widest text-slate-400 px-3 py-2.5">#</th>
                    <th className="text-[8px] font-bold uppercase tracking-widest text-slate-400 px-3 py-2.5">Coordinates (X, Y)</th>
                    <th className="text-[8px] font-bold uppercase tracking-widest text-slate-400 px-3 py-2.5">Intensity</th>
                    <th className="text-[8px] font-bold uppercase tracking-widest text-slate-400 px-3 py-2.5 text-right">Area (px²)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {analysis.suspicious_regions.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                      <td className="text-[11px] font-mono font-medium text-slate-500 px-3 py-2">{i + 1}</td>
                      <td className="text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300 px-3 py-2">
                        ({r.cx.toFixed(1)}, {r.cy.toFixed(1)})
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(r.intensity * 100, 100)}%`,
                                backgroundColor:
                                  r.intensity > 0.7
                                    ? '#EF4444'
                                    : r.intensity > 0.4
                                      ? '#F59E0B'
                                      : '#10B981',
                              }}
                            />
                          </div>
                          <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 w-12 text-right">
                            {(r.intensity * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300 px-3 py-2 text-right">
                        {r.area_px.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="pt-5 mt-4 border-t border-slate-200 dark:border-slate-800 text-center print-break-inside">
          <p className="text-[8px] font-semibold text-slate-400 uppercase tracking-widest">
            Omnia AI — Radiology Report &middot; Analysis {analysis.id.slice(0, 8)}
          </p>
          <p className="text-[7px] text-slate-300 mt-1">
            This report was generated by an AI assistant and should be reviewed by a qualified radiologist.
          </p>
        </div>
      </div>
    );
  },
);

ReportContent.displayName = 'ReportContent';

// ═══════════════════════════════════════════════════
//  Print Button Component
// ═══════════════════════════════════════════════════

interface PrintReportButtonProps {
  /** Optional callback before window.print() */
  onBeforePrint?: () => void;
  /** Optional callback after print dialog closes */
  onAfterPrint?: () => void;
  className?: string;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function PrintReportButton({
  onBeforePrint,
  onAfterPrint,
  className,
  label = 'Print Report',
  variant = 'default',
  size = 'md',
  disabled = false,
}: PrintReportButtonProps) {
  const handlePrint = useCallback(() => {
    onBeforePrint?.();
    // Small delay to let any state updates flush
    setTimeout(() => {
      window.print();
      onAfterPrint?.();
    }, 100);
  }, [onBeforePrint, onAfterPrint]);

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-[10px] gap-1.5',
    md: 'px-4 py-2 text-[11px] gap-2',
    lg: 'px-5 py-2.5 text-[12px] gap-2',
  };

  const variantStyles = {
    default:
      'bg-blue-500 text-white shadow-sm hover:bg-blue-600 active:bg-blue-700 border border-blue-500',
    outline:
      'bg-transparent text-blue-500 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 active:bg-blue-100 dark:active:bg-blue-950/60',
    ghost:
      'bg-transparent text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 active:bg-blue-100 dark:active:bg-blue-950/60 border border-transparent',
  };

  return (
    <button
      onClick={handlePrint}
      disabled={disabled}
      className={cn(
        'no-print inline-flex items-center justify-center rounded-xl font-bold uppercase tracking-wider transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-1 dark:focus:ring-offset-slate-950',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        sizeStyles[size],
        variantStyles[variant],
        className,
      )}
    >
      <Printer className="w-3.5 h-3.5 flex-shrink-0" />
      {label}
    </button>
  );
}

PrintReportButton.displayName = 'PrintReportButton';

// ═══════════════════════════════════════════════════
//  Main Export: ReportExport (wraps printable content)
// ═══════════════════════════════════════════════════

const ReportExport = forwardRef<HTMLDivElement, ReportExportProps>(
  function ReportExport(props, ref) {
    return <ReportContent ref={ref} {...props} />;
  },
);

ReportExport.displayName = 'ReportExport';

export default ReportExport;
