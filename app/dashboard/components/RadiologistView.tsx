'use client';

import React, { useState, useCallback, memo } from 'react';
import { UploadCloud, Activity, AlertCircle, CheckCircle2, Zap, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PredictionResult {
  prediction: string;
  confidence: number;
  confidence_pct: number;
  all_scores: { class: string; score: number }[];
  risk_level: string;
}

interface HistoryItem {
  id: string;
  timestamp: string;
  filename: string;
  result: PredictionResult;
}

const API_BASE = 'http://localhost:8000';

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    High: 'bg-red-500/10 text-red-500 border-red-500/20',
    Low: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    None: 'bg-green-500/10 text-green-500 border-green-500/20',
  };
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border', colors[level] || 'bg-slate-500/10 text-slate-500')}>
      {level}
    </span>
  );
}

function PredictionCard({ result }: { result: PredictionResult }) {
  const riskColors: Record<string, string> = {
    High: 'bg-red-500',
    Low: 'bg-amber-500',
    None: 'bg-green-500',
  };

  return (
    <div className="space-y-4">
      {/* Prediction Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-accent/70 mb-1">AI Diagnosis</p>
          <h2 className="text-xl font-black text-primary">{result.prediction}</h2>
        </div>
        <RiskBadge level={result.risk_level} />
      </div>

      {/* Confidence Bar */}
      <div className="p-4 rounded-2xl bg-black/5 dark:bg-white/[0.03] border border-black/5 dark:border-white/10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-text-secondary">Confidence</span>
          <span className="text-xs font-black text-primary">{result.confidence_pct}%</span>
        </div>
        <div className="h-2 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-700"
            style={{ width: `${result.confidence_pct}%` }}
          />
        </div>
      </div>

      {/* Risk Assessment */}
      <div className="p-4 rounded-2xl bg-black/5 dark:bg-white/[0.03] border border-black/5 dark:border-white/10">
        <div className="flex items-center gap-2 mb-2">
          {result.risk_level === 'High' ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : result.risk_level === 'Low' ? (
            <AlertCircle className="w-4 h-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          )}
          <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Risk Level</span>
        </div>
        <span className={cn(
          'text-lg font-black',
          result.risk_level === 'High' ? 'text-red-500' :
          result.risk_level === 'Low' ? 'text-amber-500' :
          'text-green-500'
        )}>
          {result.risk_level}
        </span>
      </div>

      {/* All Class Scores */}
      <div className="p-4 rounded-2xl bg-black/5 dark:bg-white/[0.03] border border-black/5 dark:border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-accent" />
          <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Class Scores</span>
        </div>
        <div className="space-y-2">
          {result.all_scores.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[11px] font-bold text-primary w-20 flex-shrink-0">{s.class}</span>
              <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent/70 rounded-full transition-all duration-500"
                  style={{ width: `${s.score}%` }}
                />
              </div>
              <span className="text-[10px] font-black text-primary w-12 text-right">{s.score}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PredictionCardMemo = memo(PredictionCard);

export function RadiologistView({ isLoading }: { isLoading?: boolean }) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const handleImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setSelectedFile(file);
    setResult(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => setSelectedImage(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageSelect(file);
  }, [handleImageSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handlePredict = useCallback(async () => {
    if (!selectedFile) return;
    setIsPredicting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch(`${API_BASE}/api/aria/predict`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || `Server error (${res.status})`);
      }

      const data: PredictionResult = await res.json();
      setResult(data);

      // Add to history
      setHistory(prev => [{
        id: crypto.randomUUID?.() || `${Date.now()}`,
        timestamp: new Date().toLocaleString(),
        filename: selectedFile.name,
        result: data,
      }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prediction failed');
    } finally {
      setIsPredicting(false);
    }
  }, [selectedFile]);

  const handleReset = useCallback(() => {
    setSelectedImage(null);
    setSelectedFile(null);
    setResult(null);
    setError(null);
  }, []);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Activity className="w-8 h-8 text-accent animate-spin-slow" />
          <p className="text-[10px] font-black uppercase tracking-widest text-accent/60">Initializing...</p>
        </div>
      </div>
    );
  }

  if (showHistory) {
    return (
      <div className="flex-1 p-4 sm:p-6 overflow-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-black tracking-tight text-primary">Analysis History</h2>
            <button onClick={() => setShowHistory(false)}
              className="px-4 py-2 rounded-xl glass-card-apple text-[10px] font-black uppercase tracking-widest text-accent hover:bg-accent/10 transition-all"
            >
              Back to Dashboard
            </button>
          </div>
          {history.length === 0 ? (
            <div className="text-center py-16 opacity-40">
              <Activity className="w-10 h-10 mx-auto mb-3" />
              <p className="text-[11px] font-black uppercase tracking-widest">No analyses yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => (
                <div key={item.id} className="p-4 rounded-2xl glass-card-apple border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-primary truncate">{item.filename}</p>
                      <p className="text-[8px] font-bold text-text-secondary uppercase tracking-widest">{item.timestamp}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-black text-primary">{item.result.prediction}</span>
                      <RiskBadge level={item.result.risk_level} />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[9px] font-bold text-text-secondary uppercase tracking-widest">
                    <span>Conf: {item.result.confidence_pct}%</span>
                    <span>Risk: {item.result.risk_level}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Image Upload Area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "relative rounded-[32px] border-2 border-dashed transition-all duration-200",
            dragOver
              ? "border-accent bg-accent/5"
              : selectedImage
                ? "border-transparent bg-black/60"
                : "border-white/20 bg-black/5 dark:bg-white/[0.02] hover:border-accent/50"
          )}
        >
          {selectedImage ? (
            <div className="relative">
              <img src={selectedImage} alt="Uploaded scan"
                className="w-full h-auto max-h-[400px] object-contain rounded-[32px]"
                style={{ contentVisibility: 'auto' }}
              />
              <div className="absolute top-3 left-3 px-3 py-1.5 rounded-xl glass-card-apple text-[8px] font-black text-accent uppercase tracking-widest border-white/10">
                {selectedFile?.name}
              </div>
              <button onClick={handleReset}
                className="absolute top-3 right-3 px-3 py-1.5 rounded-xl glass-card-apple text-[8px] font-black text-white/70 hover:text-red-500 uppercase tracking-widest transition-colors"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center py-16 sm:py-20 cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageSelect(file);
                }}
              />
              <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent mb-4">
                <UploadCloud className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-primary mb-1">Upload Clinical Image</p>
              <p className="text-[10px] font-medium text-text-secondary uppercase tracking-widest">
                Drop a file or click to browse
              </p>
              <p className="text-[8px] font-medium text-text-secondary/60 mt-2">Supports JPEG, PNG, DICOM</p>
            </label>
          )}
        </div>

        {/* Action Buttons */}
        {selectedImage && !result && !isPredicting && (
          <button onClick={handlePredict}
            className="w-full py-3.5 rounded-2xl bg-accent text-white text-[11px] font-black uppercase tracking-widest shadow-lg shadow-accent/20 hover:opacity-90 transition-all flex items-center justify-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Analyze with Aria Engine
          </button>
        )}

        {/* Loading State */}
        {isPredicting && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-2 border-accent/20 rounded-full" />
              <div className="absolute inset-0 border-2 border-accent rounded-full animate-spin-slow" style={{ clipPath: 'inset(0 0 50% 0)' }} />
            </div>
            <div className="text-center">
              <p className="text-[11px] font-black uppercase tracking-widest text-accent">Analyzing Image</p>
              <p className="text-[9px] font-medium text-text-secondary mt-1">Running inference on Aria model...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-black text-red-500 uppercase tracking-widest mb-1">Analysis Error</p>
              <p className="text-sm text-red-400">{error}</p>
              <button onClick={handleReset}
                className="mt-2 text-[10px] font-bold text-red-500 hover:text-red-400 underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {result && !isPredicting && (
          <PredictionCardMemo result={result} />
        )}

        {/* History Quick Nav */}
        {history.length > 0 && (
          <button onClick={() => setShowHistory(true)}
            className="w-full py-2 rounded-xl glass-card-apple text-[10px] font-black uppercase tracking-widest text-text-secondary hover:text-accent transition-all"
          >
            View History ({history.length} analyses)
          </button>
        )}

      </div>
    </div>
  );
}
