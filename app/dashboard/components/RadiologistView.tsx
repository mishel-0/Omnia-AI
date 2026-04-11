'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Scan, 
  Activity, 
  BrainCircuit, 
  ChevronRight, 
  Zap, 
  Eye, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  Wind,
  Mic,
  ArrowUpRight,
  Maximize2,
  UploadCloud,
  FileCode,
  LayoutGrid,
  Fingerprint,
  Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { db } from '@/lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  orderBy,
  limit 
} from 'firebase/firestore';
// --- Types ---
interface Finding {
  id: string;
  type: string;
  confidence: number;
  location: string;
  urgent: boolean;
}

interface Case {
  id: string;
  patientName: string;
  age?: string | number;
  gender?: string;
  modality: string;
  time: string;
  status: 'pending' | 'analyzed' | 'urgent';
  findings: Finding[];
}

export function RadiologistView({ isLoading }: { isLoading?: boolean }) {
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [isAddingPatient, setIsAddingPatient] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientAge, setNewPatientAge] = useState('');
  const [newPatientGender, setNewPatientGender] = useState('Other');
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState<number>(0);
  const [mobilePanel, setMobilePanel] = useState<'list' | 'viewer' | 'analysis'>('viewer');

  // Real-time Firestore Sync
  useEffect(() => {
    const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const casesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Case[];
        setCases(casesData);
        if (casesData.length > 0 && !selectedCase) {
          setSelectedCase(casesData[0]);
        }
      },
      (error) => {
        console.error("Clinical stream error:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName.trim()) return;

    try {
      await addDoc(collection(db, 'cases'), {
        patientName: newPatientName,
        age: newPatientAge,
        gender: newPatientGender,
        modality: 'Chest CT',
        status: 'pending',
        time: 'Just now',
        findings: [
          { id: 'f_new', type: 'Pending Analysis', confidence: 0, location: 'Initial Intake', urgent: false }
        ],
        createdAt: serverTimestamp()
      });
      setNewPatientName('');
      setNewPatientAge('');
      setIsAddingPatient(false);
    } catch (error) {
      console.error("Error adding case:", error);
    }
  };

  const handleBulkUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsBulkUploading(true);
    setUploadProgress(0);
    setUploadedFiles(0);
    
    // Simulate high-fidelity multi-stage clinical ingestion
    const total = files.length;
    for (let i = 0; i < total; i++) {
        // Stage 1: Local decryption (simulated)
        setUploadProgress((prev) => prev + (100 / (total * 2)));
        await new Promise(r => setTimeout(r, 200));
        
        // Stage 2: Ingress to Clinical Node
        setUploadProgress((prev) => prev + (100 / (total * 2)));
        setUploadedFiles(i + 1);
        await new Promise(r => setTimeout(r, 300));
    }
    
    // Auto-create a case for the first file name as a demo
    try {
      await addDoc(collection(db, 'cases'), {
        patientName: `Ingest: ${files[0].name.split('.')[0]}`,
        age: 'Manual Ingest',
        gender: 'N/A',
        status: 'In Review',
        modality: 'DICOM',
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Ingest Error:", e);
    }

    setUploadProgress(100);
    setTimeout(() => setIsBulkUploading(false), 800);
  };

  // Simulate scanning effect
  const handleScan = () => {
    setIsScanning(true);
    setScanProgress(0);
    const interval = setInterval(() => {
      setScanProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setTimeout(() => setIsScanning(false), 500);
          return 100;
        }
        return p + 2;
      });
    }, 30);
  };

  return (
    <div className="flex-1 flex flex-col gap-4 p-3 sm:p-4 lg:p-6 h-full overflow-hidden bg-background/50 backdrop-blur-3xl relative">
      
      {/* Mobile Panel Switcher */}
      <div className="flex lg:hidden gap-1 p-1 rounded-2xl glass-card-apple w-fit mx-auto flex-shrink-0">
        {(['list', 'viewer', 'analysis'] as const).map(panel => (
          <button
            key={panel}
            onClick={() => setMobilePanel(panel)}
            className={cn(
              "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
              mobilePanel === panel 
                ? "bg-accent text-white shadow-lg" 
                : "text-text-secondary hover:bg-white/10"
            )}
          >
            {panel === 'list' ? 'Cases' : panel === 'viewer' ? 'Scan' : 'Analysis'}
          </button>
        ))}
      </div>

      {/* Main content — 3-column on lg+, panel-switched on mobile */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-6 min-h-0 overflow-hidden">
        
        {/* ─── Column 1: Intake & Triage ─── */}
        <div className={cn(
          "lg:flex-[0.25] lg:min-w-[260px] lg:max-w-[340px] flex flex-col gap-4 lg:gap-6 relative z-10",
          mobilePanel === 'list' ? "flex" : "hidden lg:flex"
        )}>
          <div className="flex items-center justify-between px-2 lg:px-4">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] lg:tracking-[0.4em] text-sky-500/80">Analytical Intake</h2>
            <div className="flex gap-2">
              <input 
                type="file" 
                id="clinical-upload" 
                className="hidden" 
                multiple 
                onChange={(e) => handleBulkUpload(e.target.files)} 
              />
              <button 
                onClick={() => document.getElementById('clinical-upload')?.click()}
                className="p-2 lg:p-2.5 rounded-xl lg:rounded-2xl bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 transition-all active:scale-95"
                title="Bulk Upload DICOM"
              >
                <UploadCloud className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setIsAddingPatient(true)}
                className="p-2 lg:p-2.5 rounded-xl lg:rounded-2xl bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 transition-all active:scale-95"
                title="Add Patient"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Case List */}
          <div className="flex-1 overflow-y-auto pr-1 lg:pr-2 space-y-3 lg:space-y-4 no-scrollbar">
            {cases.map((c) => (
              <motion.button
                key={c.id}
                whileHover={{ y: -2 }}
                onClick={() => {
                  setSelectedCase(c);
                  setMobilePanel('viewer');
                }}
                className={cn(
                  "w-full p-4 lg:p-5 rounded-[24px] lg:rounded-[32px] transition-all duration-300 group relative border shadow-sm",
                  selectedCase?.id === c.id 
                    ? "glass-card-apple border-sky-500/50 scale-[1.02] shadow-xl shadow-sky-500/10" 
                    : "bg-white/40 dark:bg-white/[0.04] border-white/10 hover:bg-white/60 dark:hover:bg-white/[0.08]"
                )}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full", c.status === 'urgent' ? "bg-orange-500" : "bg-sky-500")} />
                    <p className="text-[9px] font-black text-sky-500 uppercase tracking-widest">{c.modality}</p>
                  </div>
                  {c.status === 'urgent' && <Zap className="w-3 h-3 text-orange-500 fill-orange-500" />}
                </div>
                <h3 className="text-[13px] lg:text-[14px] font-bold text-primary truncate mb-3 text-left">{c.patientName}</h3>
                <div className="flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/5">
                  <span className="text-[9px] font-bold text-text-secondary uppercase">{c.time}</span>
                  <span className="text-[9px] font-black text-primary/30">{c.id}</span>
                </div>
              </motion.button>
            ))}
            {cases.length === 0 && (
              <div className="py-12 text-center opacity-30 mt-10">
                <Activity className="w-8 h-8 mx-auto mb-3" />
                <p className="text-[10px] font-black uppercase tracking-widest leading-none">Intelligence Standby</p>
              </div>
            )}
          </div>

          {/* Bulk Upload Control */}
          <button 
            onClick={() => document.getElementById('clinical-upload')?.click()}
            className="flex items-center justify-between p-3 lg:p-4 rounded-2xl lg:rounded-3xl glass-card-apple bg-sky-500/5 hover:bg-sky-500/10 border-sky-500/20 transition-all group flex-shrink-0"
          >
            <div className="flex items-center gap-3">
              <UploadCloud className="w-5 h-5 text-sky-500" />
              <div className="text-left">
                <p className="text-[10px] font-black text-sky-500 uppercase tracking-widest leading-none mb-1">Bulk Intake</p>
                <p className="text-[9px] text-text-secondary font-medium uppercase tracking-tighter">DICOM Series</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-sky-500/40" />
          </button>

          {/* Insights Hub (Minified) */}
          <div className="p-4 lg:p-5 rounded-[24px] lg:rounded-[32px] glass-card-apple border-white/5 relative overflow-hidden group flex-shrink-0">
            <div className="flex items-center gap-2 mb-3 lg:mb-4">
               <BrainCircuit className="w-4 h-4 text-sky-500" />
               <span className="text-[10px] font-black text-sky-500 uppercase tracking-widest">Insights Hub</span>
            </div>
            <p className="text-[10px] text-primary/60 font-medium leading-relaxed uppercase tracking-tight">System ready for real-time stratification of active cases.</p>
          </div>
        </div>

        {/* ─── Column 2: Strategic Viewport ─── */}
        <div className={cn(
          "flex-1 lg:flex-[0.45] lg:min-w-[300px] flex flex-col gap-4 lg:gap-6 min-h-0",
          mobilePanel === 'viewer' ? "flex" : "hidden lg:flex"
        )}>
          <div className="flex-1 glass-card-apple rounded-[32px] lg:rounded-[48px] bg-black/80 border-white/10 relative overflow-hidden group flex items-center justify-center shadow-inner min-h-[250px] sm:min-h-[300px]">
            <div className="absolute inset-0 bg-radial-glow opacity-20 pointer-events-none" />
            
            {selectedCase ? (
              <div className="relative text-center">
                <Wind className={cn("w-32 h-32 sm:w-48 sm:h-48 lg:w-64 lg:h-64 text-white/5 transition-all duration-1000", isScanning && "text-sky-500/40")} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                   <motion.button 
                    onClick={handleScan}
                    disabled={isScanning}
                    className="px-6 sm:px-8 lg:px-10 py-3 lg:py-4 rounded-2xl lg:rounded-3xl bg-sky-500 text-white text-[10px] lg:text-[11px] font-black uppercase tracking-widest shadow-2xl flex items-center gap-3 lg:gap-4 active:scale-95 disabled:opacity-50"
                   >
                     <Scan className="w-4 h-4 lg:w-5 lg:h-5" /> 
                     {isScanning ? `Extracting ${scanProgress}%` : 'Initialize Scan'}
                   </motion.button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="relative w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 mx-auto mb-4 lg:mb-6">
                  <Scan className="w-full h-full text-white/10 animate-pulse" />
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: "linear" }} className="absolute inset-0 border border-white/5 rounded-full" />
                </div>
                <p className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.3em] lg:tracking-[0.4em] text-white/20">Awaiting Neural Link</p>
              </div>
            )}

            {/* Viewport Meta Cards */}
            {selectedCase && (
              <div className="absolute top-4 sm:top-6 lg:top-8 left-4 sm:left-6 lg:left-8 right-4 sm:right-6 lg:right-8 flex justify-between">
                 <div className="px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl lg:rounded-2xl glass-card-apple bg-white/5 text-[8px] lg:text-[9px] font-black text-accent uppercase tracking-widest border-white/10">
                   CH: {selectedCase.id.substring(0,6)}
                 </div>
                 <div className="px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl lg:rounded-2xl glass-card-apple bg-white/5 text-[8px] lg:text-[9px] font-black text-white/40 uppercase tracking-widest border-white/10 hidden sm:block">
                   Resolution: 2K Native
                 </div>
              </div>
            )}
          </div>

          <div className="h-16 lg:h-20 glass-card-apple rounded-[24px] lg:rounded-[32px] bg-white/[0.03] border-white/5 flex items-center px-4 sm:px-6 lg:px-8 justify-between flex-shrink-0">
            <div className="flex items-center gap-3 lg:gap-4">
               <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-xl lg:rounded-2xl bg-green-500/10 flex items-center justify-center text-green-500">
                 <CheckCircle2 className="w-4 h-4 lg:w-5 lg:h-5" />
               </div>
               <div>
                  <p className="text-[9px] lg:text-[10px] font-black text-accent uppercase tracking-widest mb-0.5">Status Report</p>
                  <p className="text-[11px] lg:text-[12px] font-bold text-primary/80 hidden sm:block">System ready for clinical diagnosis.</p>
               </div>
            </div>
            <motion.div layoutId="signal" className="flex items-center gap-1.5 px-2 lg:px-3 py-1 lg:py-1.5 rounded-full bg-black/20">
               <div className="w-1 h-1 rounded-full bg-green-500" />
               <span className="text-[7px] lg:text-[8px] font-black text-white/40 uppercase tracking-widest">Active</span>
            </motion.div>
          </div>
        </div>

        {/* ─── Column 3: Analysis Desk ─── */}
        <div className={cn(
          "lg:flex-[0.30] lg:min-w-[280px] lg:max-w-[380px] flex flex-col gap-4 lg:gap-6 min-h-0",
          mobilePanel === 'analysis' ? "flex" : "hidden lg:flex"
        )}>
          {selectedCase ? (
            <>
              <div className="glass-card-apple rounded-[28px] lg:rounded-[36px] p-4 sm:p-5 lg:p-6 bg-white/40 dark:bg-white/[0.03] border-white/5 shadow-sm flex-shrink-0">
                 <div className="flex items-center gap-3 lg:gap-4 mb-4 lg:mb-6">
                    <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl lg:rounded-2xl bg-gradient-to-br from-accent to-blue-600 flex items-center justify-center text-white font-black text-base lg:text-lg shadow-lg flex-shrink-0">
                      {selectedCase.patientName[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm lg:text-base font-black text-primary truncate leading-tight mb-1">{selectedCase.patientName}</h3>
                      <p className="text-[9px] text-text-secondary font-bold uppercase tracking-widest opacity-60">ID: {selectedCase.id}</p>
                    </div>
                 </div>

                 <div className="grid grid-cols-2 gap-2 lg:gap-3 mb-4 lg:mb-6">
                   <div className="p-2.5 lg:p-3 rounded-xl lg:rounded-2xl bg-black/5 dark:bg-white/[0.02] border border-black/5">
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1">Demos</span>
                      <span className="text-[11px] lg:text-xs font-black text-primary">{selectedCase.age}y / {selectedCase.gender?.[0]}</span>
                   </div>
                   <div className="p-2.5 lg:p-3 rounded-xl lg:rounded-2xl bg-black/5 dark:bg-white/[0.02] border border-black/5">
                      <span className="text-[8px] font-black text-accent uppercase tracking-widest block mb-1">State</span>
                      <span className="text-[11px] lg:text-xs font-black text-accent uppercase">{selectedCase.status}</span>
                   </div>
                 </div>

                 {/* Risk Score */}
                 <div className="p-3 lg:p-4 rounded-2xl lg:rounded-3xl bg-orange-500/5 border border-orange-500/10 mb-2 lg:mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                         <Fingerprint className="w-3.5 h-3.5 text-orange-500" />
                         <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest">Malignancy Risk</span>
                      </div>
                      <span className="text-xs font-black text-orange-500">72%</span>
                    </div>
                    <div className="h-1 w-full bg-orange-500/10 rounded-full overflow-hidden">
                       <motion.div initial={{ width: 0 }} animate={{ width: '72%' }} className="h-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                    </div>
                 </div>
              </div>

              <div className="flex-1 glass-card-apple rounded-[28px] lg:rounded-[36px] bg-white/40 dark:bg-white/[0.03] border-white/5 p-4 sm:p-5 lg:p-6 overflow-hidden flex flex-col min-h-0">
                 <div className="flex items-center gap-2 mb-4 lg:mb-6 flex-shrink-0">
                   <BrainCircuit className="w-4 h-4 text-accent" />
                   <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Aria Intelligence</h2>
                 </div>
                 <div className="flex-1 overflow-y-auto pr-1 lg:pr-2 space-y-2 lg:space-y-3 no-scrollbar">
                   {selectedCase.findings.map(f => (
                     <div key={f.id} className="p-3 lg:p-4 rounded-2xl lg:rounded-3xl bg-black/5 dark:bg-white/[0.02] border border-white/5 group hover:border-accent/30 transition-all cursor-pointer">
                        <div className="flex justify-between mb-1">
                          <span className="text-[11px] lg:text-xs font-black text-primary group-hover:text-accent transition-colors">{f.type}</span>
                          <span className="text-[10px] font-black text-accent">{f.confidence}%</span>
                        </div>
                        <p className="text-[9px] text-text-secondary font-bold uppercase tracking-wider opacity-60">LOC: {f.location}</p>
                     </div>
                   ))}
                 </div>
              </div>
            </>
          ) : (
            <div className="flex-1 glass-card-apple rounded-[32px] lg:rounded-[48px] border-dashed border-white/10 flex flex-col items-center justify-center text-center p-8 lg:p-10 opacity-40">
              <div className="w-14 h-14 lg:w-16 lg:h-16 rounded-2xl lg:rounded-3xl bg-white/5 flex items-center justify-center mb-4 lg:mb-6">
                <Activity className="w-7 h-7 lg:w-8 lg:h-8 text-white/20" />
              </div>
              <h3 className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.3em] lg:tracking-[0.4em] text-white/40 mb-2">Engine Standby</h3>
              <p className="text-[9px] lg:text-[10px] text-white/20 font-bold uppercase tracking-widest">Awaiting Case Link</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Global Overlays ─── */}
      <AnimatePresence>
        {isAddingPatient && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md">
            <motion.form 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onSubmit={handleCreateCase}
              className="w-full max-w-md p-6 sm:p-8 lg:p-10 glass-card-apple rounded-[32px] lg:rounded-[48px] border-white/20 dark:border-white/10"
            >
               <h2 className="text-2xl lg:text-3xl font-black tracking-tighter mb-6 lg:mb-8 text-slate-950 dark:text-white">Establish Patient Link</h2>
               <div className="space-y-4 lg:space-y-6">
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-sky-500 uppercase tracking-widest px-1">Legal Registration Name</label>
                    <input 
                      autoFocus
                      required
                      type="text" 
                      placeholder="e.g. Sarah Jenkins" 
                      value={newPatientName}
                      onChange={(e) => setNewPatientName(e.target.value)}
                      className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl lg:rounded-2xl px-4 lg:px-6 py-3 lg:py-4 text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500/50 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-white/20"
                    />
                 </div>
                 <div className="grid grid-cols-2 gap-3 lg:gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 dark:text-sky-400/60 uppercase tracking-widest px-1">Age</label>
                      <input 
                        type="number" 
                        placeholder="YY" 
                        value={newPatientAge}
                        onChange={(e) => setNewPatientAge(e.target.value)}
                        className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl lg:rounded-2xl px-4 lg:px-6 py-3 lg:py-4 text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500/50 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-white/20"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 dark:text-sky-400/60 uppercase tracking-widest px-1">Gender</label>
                      <select 
                        value={newPatientGender}
                        onChange={(e) => setNewPatientGender(e.target.value)}
                        className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl lg:rounded-2xl px-4 lg:px-6 py-3 lg:py-4 text-[11px] font-black uppercase text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500/50 outline-none transition-all appearance-none"
                      >
                        <option value="Male" className="bg-white dark:bg-slate-900">Male</option>
                        <option value="Female" className="bg-white dark:bg-slate-900">Female</option>
                        <option value="Other" className="bg-white dark:bg-slate-900">Other</option>
                      </select>
                    </div>
                 </div>
               </div>

               <div className="flex gap-3 lg:gap-4 mt-8 lg:mt-12">
                 <button type="submit" className="flex-1 py-3 lg:py-4 bg-sky-500 text-white rounded-2xl lg:rounded-3xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-sky-500/40 active:scale-95 transition-all">Establish Link</button>
                 <button type="button" onClick={() => setIsAddingPatient(false)} className="px-6 lg:px-8 py-3 lg:py-4 bg-slate-200 dark:bg-white/10 rounded-2xl lg:rounded-3xl text-[11px] font-black uppercase text-slate-600 dark:text-sky-400/80 hover:bg-slate-300 dark:hover:bg-white/20 transition-all">Cancel</button>
               </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isBulkUploading && (
          <div className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 lg:bottom-12 lg:right-12 z-[100] w-[calc(100%-2rem)] sm:w-80 lg:w-96 p-4 sm:p-5 lg:p-6 glass-card-apple bg-white dark:bg-slate-900 shadow-2xl rounded-[24px] lg:rounded-[32px] border-accent/20">
             <div className="flex items-center justify-between mb-3 lg:mb-4">
                <div className="flex items-center gap-2 lg:gap-3">
                   <UploadCloud className="w-4 h-4 lg:w-5 lg:h-5 text-accent animate-bounce" />
                   <p className="text-[10px] lg:text-[11px] font-black uppercase tracking-widest text-primary">Bulk Syncing ({uploadedFiles}/12)</p>
                </div>
                <span className="text-[10px] font-black text-accent">{Math.floor(uploadProgress)}%</span>
             </div>
             <div className="h-1 lg:h-1.5 w-full bg-accent/10 rounded-full overflow-hidden">
                <motion.div animate={{ width: `${uploadProgress}%` }} className="h-full bg-accent shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
             </div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
