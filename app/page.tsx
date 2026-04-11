'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useSpring, useMotionValue } from 'framer-motion';
import { Wind, Fingerprint, BrainCircuit, Database, Activity, Sparkles, Shield, ChevronRight, Sun, Moon, Zap, Search, FileText, Scan, AlertCircle, Heart, CheckCircle2, UploadCloud, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, addDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

const ARIA_STATES = [
  { label: "Summarizing patient history...", detail: "Synthesizing 48 months of longitudinal clinical data." },
  { label: "Cross-referencing imaging...", detail: "Comparing current DICOM series with historical baselines." },
  { label: "Suggesting diagnostic pathways...", detail: "Correlating findings with latest clinical guidelines." },
  { label: "Analyzing biomarkers...", detail: "Identifying subtle shifts in pulmonary function indicators." }
];

export default function Home() {
  const router = useRouter();
  const [currentState, setCurrentState] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeRegion, setActiveRegion] = useState<any>(null);
  const [clinician, setClinician] = useState<any>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [licenseInput, setLicenseInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [aiModel, setAiModel] = useState<any>(null);
  
  // Firestore replaces Supabase

  const { scrollY } = useScroll();
  
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 300], [1, 0.98]);
  const heroY = useTransform(scrollY, [0, 300], [0, -50]);

  // Parallax effect for hero elements
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 100, damping: 30 });
  const springY = useSpring(mouseY, { stiffness: 100, damping: 30 });

  const [patientIdInput, setPatientIdInput] = useState('');
  const [isFetchingData, setIsFetchingData] = useState(false);

  // Sync dark mode state with document and localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    if (nextMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  useEffect(() => {
    // Only fetch AI model data on load, not mock patient data
    const initModelData = async () => {
      try {
        const modelsRef = collection(db, 'ai_models');
        const qModel = query(modelsRef, where('name', '==', 'Omnia-Lung-V2'));
        const modelSnapshot = await getDocs(qModel);
        if (!modelSnapshot.empty) {
          setAiModel({ id: modelSnapshot.docs[0].id, ...modelSnapshot.docs[0].data() });
        }
      } catch (error) {
        console.error("Error fetching AI model:", error);
      }
    };
    initModelData();

    const timer = setInterval(() => {
      setCurrentState((prev) => (prev + 1) % ARIA_STATES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleFetchPatient = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!patientIdInput.trim()) return;
    
    setIsFetchingData(true);
    try {
      const diagnosesRef = collection(db, 'diagnoses');
      const qDiag = query(diagnosesRef, where('patient_id', '==', patientIdInput.trim()));
      const diagSnapshot = await getDocs(qDiag);
      if (!diagSnapshot.empty) {
        setDiagnosis({ id: diagSnapshot.docs[0].id, ...diagSnapshot.docs[0].data() });
      } else {
        alert("Patient ID not found. Ensure it exists in Firestore.");
        setDiagnosis(null);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    setIsFetchingData(false);
  };

  const handleVerify = async () => {
    if (!diagnosis || diagnosis.status === 'verified' || !clinician) return;
    
    setIsVerifying(true);
    
    try {
      // 1. Update Diagnosis Status
      const diagRef = doc(db, 'diagnoses', diagnosis.id);
      const updateData = {
        status: 'verified',
        verified_at: new Date().toISOString(),
        verified_by: clinician.id
      };
      
      await updateDoc(diagRef, updateData);

      // 2. Create Audit Log Entry
      await addDoc(collection(db, 'clinical_audit_logs'), {
        diagnosis_id: diagnosis.id,
        clinician_id: clinician.id,
        action: 'verified',
        previous_status: diagnosis.status,
        new_status: 'verified',
        notes: `Verified by ${clinician.full_name} (${clinician.license_number})`,
        timestamp: new Date().toISOString()
      });

      setDiagnosis(prev => ({ ...prev, ...updateData }));
    } catch (error) {
      console.error("Error verifying:", error);
    }
    setIsVerifying(false);
  };

  const runAIAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    
    const duration = 3000; // 3 seconds
    const interval = 50;
    const steps = duration / interval;
    const increment = 100 / steps;
    
    let currentProgress = 0;
    const timer = setInterval(() => {
      currentProgress += increment;
      if (currentProgress >= 100) {
        setAnalysisProgress(100);
        clearInterval(timer);
        setTimeout(() => {
          setIsAnalyzing(false);
          // Optionally set an active region to show the detection UI
          setActiveRegion({ id: 'r1', label: 'Right Upper Lobe' });
        }, 500);
      } else {
        setAnalysisProgress(Math.floor(currentProgress));
      }
    }, interval);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    mouseX.set((clientX - innerWidth / 2) / 25);
    mouseY.set((clientY - innerHeight / 2) / 25);
  };

  return (
    <div 
      onMouseMove={handleMouseMove}
      className={cn("min-h-screen transition-colors duration-1000 selection:bg-accent/30 overflow-x-hidden", "bg-background text-primary")}
    >
      {/* Floating iOS Navbar */}
      <nav className="fixed top-6 left-0 right-0 z-50 px-6 flex justify-center">
        <motion.div 
          initial={{ y: -20, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          className="glass-navbar px-4 py-2 rounded-4xl flex items-center gap-8 max-w-fit border border-white/40"
        >
          <div className="flex items-center gap-2.5 pl-3 cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="relative w-8 h-8 flex items-center justify-center">
              <Activity className="w-6 h-6 text-accent relative z-10 animate-logo-pulse" />
              <motion.div 
                animate={{ scale: [1, 1.4, 1], opacity: [0.1, 0.2, 0.1] }} 
                transition={{ duration: 3, repeat: Infinity }} 
                className="absolute inset-0 bg-accent rounded-full blur-md" 
              />
            </div>
            <span className="font-bold text-[15px] tracking-tight text-primary">OMNIA</span>
          </div>
          
          <div className="hidden md:flex items-center bg-black/5 dark:bg-white/10 rounded-full p-1">
            {['Capabilities', 'System', 'Aria', 'About'].map((tab) => (
              <button 
                key={tab} 
                onClick={() => {
                  const el = document.getElementById(tab.toLowerCase());
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={cn(
                  "px-5 py-1.5 rounded-full text-[13px] font-medium transition-all duration-300",
                  "text-text-secondary hover:text-primary hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 pr-1">
            <button onClick={toggleTheme} className="p-2 text-text-secondary hover:text-accent transition-colors">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => {
                const onboarded = localStorage.getItem('onboarding_complete');
                router.push(onboarded ? '/dashboard' : '/onboarding');
              }}
              className="bg-primary text-background px-5 py-2 rounded-full text-[13px] font-semibold hover:opacity-90 transition-all shadow-lg dark:shadow-none"
            >
              Access Platform
            </button>
          </div>
        </motion.div>
      </nav>

      <main className="relative">
        {/* Hero Section */}
        <section className="pt-48 pb-32 px-6 max-w-7xl mx-auto text-center relative">
          <motion.div style={{ opacity: heroOpacity, scale: heroScale, y: heroY }}>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight text-primary">
                Diagnose faster. <br /> 
                <span className="text-accent">Treat sooner.</span>
              </h1>
              <p className="text-lg md:text-xl text-text-secondary max-w-xl mx-auto mb-10 font-medium leading-relaxed">
                Omnia’s AI instantly detects anomalies in clinical imaging, giving your care team the absolute certainty to act fast.
              </p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 1 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-24"
            >
              <button 
                onClick={() => router.push('/onboarding')}
                className="group relative w-full sm:w-auto bg-primary text-background px-10 py-4 rounded-full font-bold text-lg transition-all shadow-xl dark:shadow-none overflow-hidden"
              >
                <span className="relative z-10">Start Diagnosis</span>
                <motion.div className="absolute inset-0 bg-accent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              </button>
              <button 
                onClick={() => document.getElementById('capabilities')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full sm:w-auto bg-white/80 dark:bg-slate-900/80 backdrop-blur-md text-primary px-10 py-4 rounded-full font-bold text-lg hover:bg-white dark:hover:bg-slate-800 transition-all border border-black/5 dark:border-white/10 shadow-sm"
              >
                View Capabilities
              </button>
            </motion.div>
            
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 1 }}
              className="text-[11px] font-bold text-accent uppercase tracking-[0.3em] mb-32"
            >
              Designed for clinical environments
            </motion.p>
          </motion.div>

          {/* Hero Centerpiece - Diagnostic Card */}
          <motion.div 
            id="diagnosis-card"
            style={{ x: springX, y: springY }}
            initial={{ opacity: 0, scale: 0.9, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative max-w-4xl mx-auto aspect-auto md:aspect-[16/10] mb-20 sm:mb-32 lg:mb-40 group"
          >
            {/* Orbital Elements */}
            <motion.div 
              animate={{ rotate: 360 }} 
              transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
              className="absolute -inset-20 pointer-events-none opacity-40 hidden lg:block"
            >
              <div className="absolute top-0 left-1/4 w-12 h-12 glass-card-apple rounded-2xl flex items-center justify-center text-accent shadow-lg">
                <Wind className="w-6 h-6" />
              </div>
              <div className="absolute bottom-1/4 right-0 w-10 h-10 glass-card-apple rounded-xl flex items-center justify-center text-accent shadow-lg">
                <Fingerprint className="w-5 h-5" />
              </div>
              <div className="absolute top-1/2 -left-10 w-14 h-14 glass-card-apple rounded-3xl flex items-center justify-center text-accent shadow-lg">
                <Database className="w-7 h-7" />
              </div>
            </motion.div>

            {/* Main Glass Card */}
            <div className="relative w-full h-full min-h-[500px] md:min-h-0 glass-card-apple rounded-[32px] lg:rounded-[48px] overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent" />
              
              {/* Diagnostic Content */}
              <div className="absolute inset-0 p-4 sm:p-8 lg:p-12 flex flex-col md:flex-row gap-4 sm:gap-6 lg:gap-12 items-stretch md:items-center">
                {/* X-Ray Visualization */}
                <div className="relative flex-1 h-48 sm:h-64 md:h-full bg-black rounded-2xl lg:rounded-3xl overflow-hidden border border-white/10 shadow-inner flex items-center justify-center group/xray">
                  <div className="relative w-full h-full">
                    {/* Empty State vs Clinical Chest X-Ray */}
                    {!diagnosis ? (
                      <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-white/20 rounded-3xl">
                        <Scan className="w-16 h-16 text-white/40 mb-4 animate-pulse" />
                        <h3 className="text-xl font-bold text-white mb-2">No Active Diagnosis</h3>
                        <p className="text-sm text-slate-400 mb-6 max-w-xs">Look up a patient record to view the initial CT scan or X-ray imaging here.</p>
                      </div>
                    ) : (
                      <img 
                        src="https://images.unsplash.com/photo-1530026405186-ed1f139313f8?auto=format&fit=crop&q=80&w=1200" 
                        className="w-full h-full object-cover opacity-80 grayscale contrast-150 brightness-90" 
                        alt="Clinical Chest X-Ray" 
                      />
                    )}
                    
                    
                    {/* Digital Grid Overlay (Subtle) */}
                    <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#60A5FA 0.5px, transparent 0.5px)', backgroundSize: '30px 30px' }} />
                  </div>
                  
                  {/* Scan Line */}
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/40 to-transparent h-1/4 w-full animate-scan-line blur-md" />
                  
                  {/* AI Detection Overlay - Positioned over a specific "nodule" area */}
                  {diagnosis && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 2, duration: 1, ease: "easeOut" }}
                      className="absolute top-[35%] left-[65%] -translate-x-1/2 -translate-y-1/2 w-24 h-24 border-2 border-accent/60 rounded-full flex items-center justify-center"
                    >
                      <div className="absolute inset-0 bg-accent/20 rounded-full animate-pulse" />
                      <div className="relative bg-accent text-white p-2 rounded-full shadow-xl shadow-accent/50">
                        <Search className="w-5 h-5" />
                      </div>
                      
                      {/* Coordinate Lines */}
                      <div className="absolute top-1/2 left-full w-12 h-px bg-accent/40" />
                      <div className="absolute top-full left-1/2 w-px h-12 bg-accent/40" />
                    </motion.div>
                  )}

                  {/* AI Analysis Overlay */}
                  {isAnalyzing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/40 backdrop-blur-sm">
                      <div className="relative w-48 h-48 mb-8">
                        <svg className="w-full h-full rotate-[-90deg]">
                          <circle cx="96" cy="96" r="88" fill="none" stroke="currentColor" strokeWidth="4" className="text-white/10" />
                          <motion.circle 
                            cx="96" cy="96" r="88" fill="none" stroke="currentColor" strokeWidth="4" 
                            className="text-accent"
                            strokeDasharray="553"
                            initial={{ strokeDashoffset: 553 }}
                            animate={{ strokeDashoffset: 553 - (553 * analysisProgress) / 100 }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold text-white">{analysisProgress}%</span>
                          <span className="text-[8px] font-black text-accent uppercase tracking-widest">Processing</span>
                        </div>
                      </div>
                      <div className="text-center space-y-1">
                        <span className="block text-[10px] font-black text-white uppercase tracking-[0.3em]">{aiModel?.name || "Omnia Engine"}</span>
                        <span className="block text-[8px] font-medium text-slate-400">Version {aiModel?.version || "2.4.1"}</span>
                      </div>
                    </div>
                  )}

                  {/* Metadata Overlay */}
                  {diagnosis && (
                    <div className="absolute bottom-4 left-4 flex flex-col gap-1 opacity-60">
                      <span className="text-[8px] font-black text-white uppercase tracking-widest">DICOM SERIES: {diagnosis.id.substring(0,6).toUpperCase()}-X</span>
                      <span className="text-[8px] font-black text-white uppercase tracking-widest">RESOLUTION: 2048x2048</span>
                    </div>
                  )}
                </div>

                {/* AI Result Panel / Look Up Panel */}
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1, duration: 0.8 }}
                  className="w-full md:w-64 lg:w-72 flex flex-col gap-4 sm:gap-6 text-left"
                >
                  {!diagnosis ? (
                    <div className="flex-1 flex flex-col justify-center">
                      <h4 className="text-xl font-bold text-primary mb-4 tracking-tight">Patient Lookup</h4>
                      <p className="text-sm text-text-secondary mb-6 font-medium">Please enter a valid Patient ID to retrieve clinical data.</p>
                      
                      <form onSubmit={handleFetchPatient} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-accent uppercase tracking-widest">Patient ID</label>
                          <input 
                            type="text" 
                            className="w-full px-4 py-3 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/50 font-medium placeholder:text-slate-400"
                            placeholder="e.g. PT-8829"
                            value={patientIdInput}
                            onChange={(e) => setPatientIdInput(e.target.value)}
                            required
                          />
                        </div>
                        
                        <button 
                          type="submit"
                          disabled={isFetchingData}
                          className="w-full bg-primary text-background py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg dark:shadow-none active:scale-95 disabled:opacity-50"
                        >
                          {isFetchingData ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Retrieve Patient <ChevronRight className="w-4 h-4" /></>}
                        </button>
                      </form>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">Analysis Result</span>
                          {diagnosis?.status === 'verified' && (
                            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="bg-success/10 text-success text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1">
                              <CheckCircle2 className="w-2 h-2" /> Verified
                            </motion.span>
                          )}
                        </div>
                        <h4 className="text-2xl font-bold text-primary">{diagnosis?.finding || "Analyzed Issue"}</h4>
                      </div>

                      <div className="space-y-4">
                        <div className="p-4 rounded-2xl bg-white/40 dark:bg-slate-900/60 border border-black/5 dark:border-white/5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-bold text-text-secondary">Risk Level</span>
                            <span className="text-[11px] font-bold text-orange-500">{diagnosis?.risk_level || "Unknown"}</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: diagnosis?.status === 'verified' ? '100%' : '65%' }}
                              transition={{ duration: 1 }}
                              className={cn("h-full transition-colors", diagnosis?.status === 'verified' ? "bg-success" : "bg-orange-500")} 
                            />
                          </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-accent/5 border border-accent/10 dark:border-accent/20">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="w-4 h-4 text-accent" />
                            <span className="text-[11px] font-bold text-accent uppercase tracking-wider">Recommendation</span>
                          </div>
                          <p className="text-[13px] font-medium text-text-secondary leading-snug">
                            {diagnosis?.recommendation || "Pending automated recommendation"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-auto pt-6 border-t border-black/5 space-y-4">
                        {!activeRegion && !isAnalyzing && (
                          <button 
                            onClick={runAIAnalysis}
                            className="w-full bg-accent/10 text-accent py-3 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-accent/20 transition-all flex items-center justify-center gap-2"
                          >
                            <Zap className="w-3 h-3" /> Run {aiModel?.name || "AI"} Analysis
                          </button>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex -space-x-2">
                            {[1, 2, 3].map(i => (
                              <div key={i} className="w-6 h-6 rounded-full border-2 border-background dark:border-slate-800 bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                                <Activity className="w-3 h-3 text-slate-400 dark:text-slate-300" />
                              </div>
                            ))}
                          </div>
                          <div className="text-right">
                            <span className="block text-[10px] font-bold text-text-secondary">
                              {diagnosis?.status === 'verified' ? "Verified by Clinician" : "Clinical Review Pending"}
                            </span>
                            {diagnosis?.status === 'verified' && clinician && (
                              <span className="block text-[8px] font-medium text-accent">{clinician.full_name}</span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              if (!clinician) {
                                // Mock a clinician login for the sake of demo if not established
                                setClinician({ id: 'CLIN-112', full_name: 'Dr. Sarah Jenkins', license_number: 'MD-88123' });
                              }
                              handleVerify();
                            }}
                            disabled={isVerifying || diagnosis?.status === 'verified'}
                            className={cn(
                              "flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                              diagnosis?.status === 'verified' 
                                ? "bg-success/10 text-success cursor-default" 
                                : "bg-primary text-background shadow-lg dark:shadow-none active:scale-95 hover:opacity-90"
                            )}
                          >
                            {isVerifying ? (
                              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : diagnosis?.status === 'verified' ? (
                              <>Verified</>
                            ) : (
                              "Verify Result"
                            )}
                          </button>
                          {diagnosis?.status !== 'verified' && (
                            <button className="p-2.5 rounded-xl border border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                              <Shield className="w-4 h-4 text-text-secondary" />
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </motion.div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Trust Strip */}
        <section className="border-y border-black/5 dark:border-white/10 py-10 mb-40">
          <div className="max-w-7xl mx-auto px-6 flex flex-wrap justify-center gap-x-16 gap-y-6">
            {["Medical-grade security", "Built for clinicians", "Real-time AI-assisted analysis"].map((text, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="text-[13px] font-bold text-text-secondary uppercase tracking-widest">{text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Core Capabilities - Advanced Bento UI */}
        <section id="capabilities" className="max-w-7xl mx-auto px-6 mb-64">
          <div className="absolute left-0 right-0 h-[500px] bg-gradient-to-b from-accent/5 to-transparent pointer-events-none -z-10" />
          <div className="text-center mb-24">
            <span className="text-accent font-black tracking-[0.2em] uppercase text-sm mb-4 block">Clinical Intelligence Layer</span>
            <h2 className="text-4xl md:text-[56px] leading-tight font-extrabold text-primary mb-6 tracking-tight">
              Precision at <br className="md:hidden" /> every layer.
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-6 auto-rows-[280px] gap-6">
            
            {/* Main Feature - Lung Nodule (Large) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="md:col-span-4 row-span-2 glass-card-apple rounded-[48px] p-12 relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-bl from-accent/10 to-transparent pointer-events-none" />
              <div className="relative z-10 h-full flex flex-col">
                <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-auto text-accent shadow-inner">
                  <Wind className="w-8 h-8 stroke-[2]" />
                </div>
                <div className="mt-8 relative">
                  <h3 className="text-3xl lg:text-4xl font-extrabold text-primary mb-4 tracking-tight">Sub-millimeter Nodule Detection</h3>
                  <p className="text-text-secondary text-lg leading-relaxed font-medium max-w-xl">
                    Utilizing deep convolutional neural networks to identify subtle pulmonary anomalies across routine CT scans earlier than conventional screening protocols.
                  </p>
                  
                  {/* High Conversion Metrics & Modalities */}
                  <div className="grid grid-cols-3 gap-6 mt-10 border-t border-black/5 dark:border-white/10 pt-8 max-w-xl">
                    <div className="space-y-1.5 border-l-2 border-accent/30 pl-4">
                      <p className="text-[10px] font-black uppercase text-text-secondary tracking-widest">Clinical Sensitivity</p>
                      <p className="text-3xl font-extrabold text-primary">99.4%</p>
                    </div>
                    <div className="space-y-1.5 border-l-2 border-accent/30 pl-4">
                      <p className="text-[10px] font-black uppercase text-text-secondary tracking-widest">Resolution Limit</p>
                      <p className="text-3xl font-extrabold text-primary">&lt;1<span className="text-base text-text-secondary ml-1">mm</span></p>
                    </div>
                    <div className="space-y-1.5 border-l-2 border-accent/30 pl-4">
                      <p className="text-[10px] font-black uppercase text-text-secondary tracking-widest">False Positives</p>
                      <p className="text-3xl font-extrabold text-primary">0.02<span className="text-base text-text-secondary ml-1">/scan</span></p>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mt-8">
                    {["Low-Dose CT", "PET Scans", "HRCT"].map((modality, i) => (
                      <span key={i} className="px-4 py-1.5 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-full text-[11px] font-bold tracking-widest uppercase text-text-secondary">
                        {modality}
                      </span>
                    ))}
                  </div>

                </div>
              </div>
              {/* Decorative grid element with animated scan line */}
              <div className="absolute -bottom-24 -right-24 w-96 h-96 border border-black/5 dark:border-white/5 rounded-full overflow-hidden opacity-30 group-hover:scale-105 transition-transform duration-700">
                <div className="relative w-full h-full" style={{ backgroundImage: 'radial-gradient(#60A5FA 2px, transparent 2px)', backgroundSize: '24px 24px' }}>
                  <motion.div 
                    animate={{ top: ['-10%', '110%'] }} 
                    transition={{ duration: 3, ease: "linear", repeat: Infinity }} 
                    className="absolute left-0 right-0 h-1 bg-gradient-to-b from-transparent via-accent to-transparent shadow-[0_0_15px_#60A5FA]" 
                  />
                </div>
              </div>
            </motion.div>

            {/* Feature 2 - Melanoma (Small) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1, duration: 0.8 }}
              className="md:col-span-2 row-span-1 glass-card-apple rounded-[40px] p-8 relative overflow-hidden hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors duration-500"
            >
              <div className="flex items-start justify-between mb-8">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent relative overflow-hidden">
                  <Fingerprint className="w-6 h-6 stroke-[2] relative z-10" />
                  <motion.div 
                    animate={{ y: ['-100%', '100%'] }} 
                    transition={{ duration: 2, ease: "linear", repeat: Infinity }} 
                    className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/50 to-transparent h-1/2 w-full"
                  />
                </div>
                <span className="px-3 py-1 bg-white/50 dark:bg-slate-900/50 rounded-full text-[10px] font-bold tracking-widest uppercase text-text-secondary">Dermoscopy</span>
              </div>
              <h3 className="text-xl font-bold text-primary mb-2">Lesion Mapping</h3>
              <p className="text-text-secondary text-sm font-medium leading-relaxed">
                Visual pattern recognition with instant risk-scoring for malignant melanoma indicators.
              </p>
            </motion.div>

            {/* Feature 3 - Longitudinal Tracking (Small) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="md:col-span-2 row-span-1 glass-card-apple rounded-[40px] p-8 relative overflow-hidden hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors duration-500"
            >
              <div className="flex items-start justify-between mb-8 relative z-10">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                  <Activity className="w-6 h-6 stroke-[2]" />
                </div>
                {/* Animated Bar Chart */}
                <div className="flex items-end gap-1.5 h-12 opacity-80">
                  {[40, 70, 45, 90, 60].map((height, i) => (
                    <motion.div 
                      key={i}
                      animate={{ height: [`${height * 0.5}%`, `${height}%`, `${height * 0.5}%`] }}
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.15 }}
                      className="w-1.5 bg-accent/40 rounded-full"
                    />
                  ))}
                </div>
              </div>
              <h3 className="text-xl font-bold text-primary mb-2">Longitudinal Analysis</h3>
              <p className="text-text-secondary text-sm font-medium leading-relaxed">
                Automatically correlate historical imaging to measure volumetric tumor progression.
              </p>
            </motion.div>

            {/* Feature 4 - Triage (Medium) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="md:col-span-3 row-span-1 glass-card-apple rounded-[40px] p-10 flex flex-col justify-center relative overflow-hidden group"
            >
              <motion.div 
                animate={{ scale: [1, 1.05, 1], opacity: [0.05, 0.1, 0.05] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 group-hover:translate-x-8 transition-transform duration-500 text-primary"
              >
                <AlertCircle className="w-64 h-64" />
              </motion.div>
              <h3 className="text-2xl font-bold text-primary mb-3">Automated Triage Routing</h3>
              <p className="text-text-secondary font-medium leading-relaxed max-w-sm">
                Prioritize urgent pathological cases instantly based on AI-derived confidence and risk stratification scores.
              </p>
            </motion.div>

            {/* Feature 5 - Integration (Medium) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4, duration: 0.8 }}
              className="md:col-span-3 row-span-1 glass-card-apple rounded-[40px] p-10 flex flex-col justify-center relative overflow-hidden group"
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-5 translate-x-12 group-hover:translate-x-8 transition-all duration-500 text-primary">
                <Database className="w-64 h-64 relative z-10" />
                {/* Flowing Data Stream */}
                <div className="absolute inset-0 flex flex-col justify-around py-10 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                  {[1, 2, 3].map((i) => (
                    <motion.div 
                      key={i}
                      animate={{ x: [-100, 200] }}
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.3, ease: "linear" }}
                      className="h-px w-12 bg-gradient-to-r from-transparent via-primary to-transparent"
                    />
                  ))}
                </div>
              </div>
              <h3 className="text-2xl font-bold text-primary mb-3">DICOM Interoperability</h3>
              <p className="text-text-secondary font-medium leading-relaxed max-w-sm">
                Seamless bidirectional PACS/EHR integration featuring a zero-footprint clinical web viewer.
              </p>
            </motion.div>

          </div>
        </section>

        {/* Aria Intelligence Section */}
        <section id="aria" className="max-w-7xl mx-auto px-6 mb-64 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 1 }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent mb-8">
                <BrainCircuit className="w-4 h-4" />
                <span className="text-[12px] font-black uppercase tracking-widest">System Intelligence</span>
              </div>
              <h2 className="text-5xl md:text-6xl font-bold text-primary mb-8 tracking-tight leading-[1.1]">
                Aria — Clinical <br /> Intelligence Layer
              </h2>
              <p className="text-xl text-text-secondary font-medium leading-relaxed mb-12 max-w-lg">
                A system-level assistant designed to interpret, navigate, and contextualize patient data in real time.
              </p>
              <button className="group flex items-center gap-3 text-primary font-bold text-lg hover:text-accent transition-colors">
                Explore Aria Capabilities
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2 }}
              className="relative aspect-square max-w-xl mx-auto w-full"
            >
              {/* Neural Pulse Background */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-full h-full bg-accent/5 rounded-full animate-neural-pulse blur-3xl" />
                <div className="absolute w-3/4 h-3/4 bg-accent/10 rounded-full animate-neural-pulse blur-2xl" style={{ animationDelay: '-1.5s' }} />
              </div>

              {/* Aria Interface Card */}
              <div className="relative h-full w-full glass-card-apple rounded-[56px] p-12 flex flex-col overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent to-transparent opacity-30" />
                
                <div className="flex items-center justify-between mb-12">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center text-background shadow-lg">
                      <Zap className="w-6 h-6 fill-current" />
                    </div>
                    <div>
                      <h4 className="font-bold text-primary">Aria Engine</h4>
                      <p className="text-[10px] font-black text-accent uppercase tracking-widest">Active Analysis</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent/20 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center space-y-10">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentState}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className="space-y-4"
                    >
                      <div className="flex items-center gap-3 text-accent">
                        <Activity className="w-5 h-5" />
                        <span className="text-sm font-black uppercase tracking-[0.2em]">Processing</span>
                      </div>
                      <h3 className="text-3xl font-bold text-primary tracking-tight leading-tight">
                        {ARIA_STATES[currentState].label}
                      </h3>
                      <p className="text-lg text-text-secondary font-medium leading-relaxed">
                        {ARIA_STATES[currentState].detail}
                      </p>
                    </motion.div>
                  </AnimatePresence>

                  <div className="grid grid-cols-2 gap-4 pt-8 border-t border-black/5 dark:border-white/10">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest">Confidence</p>
                      <p className="text-xl font-bold text-primary">98.4%</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest">Latency</p>
                      <p className="text-xl font-bold text-primary">12ms</p>
                    </div>
                  </div>
                </div>

                {/* Neural Waveform Animation */}
                <div className="absolute bottom-0 left-0 right-0 h-24 flex items-end justify-center gap-1 px-12 pb-8 opacity-20">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: [10, Math.random() * 40 + 10, 10] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.05 }}
                      className="w-1 bg-accent rounded-full"
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Metrics & Reliability Section */}
        <section id="system" className="max-w-7xl mx-auto px-6 mb-64">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { label: "Response Time", value: "<10ms", detail: "Real-time clinical inference" },
              { label: "Consistency", value: "99.9%", detail: "Diagnostic reliability score" },
              { label: "Uptime", value: "99.99%", detail: "Mission-critical availability" }
            ].map((metric, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.8 }}
                className="glass-card-apple p-10 rounded-[40px] text-center group hover:bg-white/80 dark:hover:bg-slate-800 transition-all duration-500"
              >
                <p className="text-[11px] font-black text-accent uppercase tracking-[0.3em] mb-4">{metric.label}</p>
                <h3 className="text-5xl font-bold text-primary mb-4 tracking-tight group-hover:scale-110 transition-transform duration-500">{metric.value}</h3>
                <p className="text-text-secondary font-medium">{metric.detail}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="max-w-5xl mx-auto px-6 mb-64 text-center">
          <h2 className="text-4xl font-bold text-primary mb-20 tracking-tight">A seamless clinical workflow.</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
            {/* Connecting Line */}
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-black/10 dark:via-white/10 to-transparent -z-10" />
            
            {[
              { step: "01", icon: UploadCloud, title: "Capture", desc: "Upload or stream clinical imaging data." },
              { step: "02", icon: BrainCircuit, title: "Analyze", desc: "AI-assisted detection and correlation." },
              { step: "03", icon: ShieldCheck, title: "Review", desc: "Verified insights for clinical decisions." }
            ].map((item, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2 }}
                whileHover={{ y: -8, shadow: "0 30px 60px rgba(0,0,0,0.08)" }}
                className="relative glass-card-apple p-10 rounded-[40px] text-center group hover:bg-white/80 dark:hover:bg-slate-800 transition-all duration-500 overflow-hidden"
              >
                {/* Step Submark Background */}
                <div className="absolute -top-6 -right-6 text-9xl font-black text-black/5 dark:text-white/5 pointer-events-none transition-all group-hover:scale-110">
                  {item.step}
                </div>
                
                <div className="relative z-10 space-y-6">
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 dark:bg-accent/20 flex items-center justify-center mx-auto text-accent shadow-inner">
                    <item.icon className="w-8 h-8 stroke-[2]" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-primary mb-2 tracking-tight">{item.title}</h4>
                    <p className="text-text-secondary font-medium leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="max-w-7xl mx-auto px-6 mb-32">
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.2 }}
            className="relative glass-card-apple rounded-[64px] p-16 md:p-32 overflow-hidden text-center"
          >
            {/* Background Accents */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-gradient-to-b from-accent/5 to-transparent pointer-events-none" />
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse-soft" />
            <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '-2s' }} />

            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="text-4xl md:text-6xl font-bold text-primary mb-10 tracking-tight leading-[1.1]">
                Support earlier detection with intelligent clinical systems.
              </h2>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                <button 
                  onClick={() => {
                    const onboarded = localStorage.getItem('onboarding_complete');
                    router.push(onboarded ? '/dashboard' : '/onboarding');
                  }}
                  className="w-full sm:w-auto bg-primary text-background px-12 py-5 rounded-full font-bold text-xl hover:opacity-90 transition-all shadow-2xl dark:shadow-none"
                >
                  Get Started
                </button>
                <button className="w-full sm:w-auto bg-white/80 dark:bg-slate-900/80 backdrop-blur-md text-primary px-12 py-5 rounded-full font-bold text-xl hover:bg-white dark:hover:bg-slate-800 transition-all border border-black/5 dark:border-white/10 shadow-sm">
                  Request Demo
                </button>
              </div>
              <p className="mt-12 text-[11px] font-black text-accent uppercase tracking-[0.4em]">
                Enterprise-grade security • HIPAA Compliant
              </p>
            </div>
          </motion.div>
        </section>

        {/* Footer */}
        <footer id="about" className="max-w-7xl mx-auto px-6 pb-20 flex flex-col md:flex-row justify-between items-center gap-8 border-t border-black/5 dark:border-white/10 pt-12">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 bg-accent rounded-lg flex items-center justify-center">
              <Activity className="w-4 h-4 text-white dark:text-background" />
            </div>
            <span className="font-bold text-[14px] tracking-tight text-primary">OMNIA DIAGNOSIS</span>
          </div>
          <div className="flex gap-10">
            {['Privacy', 'Terms', 'Security', 'Contact'].map(link => (
              <a key={link} href="#" className="text-[13px] font-bold text-text-secondary hover:text-accent transition-colors">{link}</a>
            ))}
          </div>
          <p className="text-[13px] font-medium text-text-secondary/60">© 2024 Omnia Diagnosis. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}
