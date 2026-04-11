'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import {
  Activity, Zap, BrainCircuit, Wind, Fingerprint, Database,
  ChevronRight, ChevronLeft, UploadCloud, ShieldCheck, Shield,
  Search, Scan, AlertCircle, Heart, Lock, Server, Eye,
  Stethoscope, FlaskConical, UserCog, Sun, Moon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  OAuthProvider, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

// ─── Aria's narration states for Screen 3 ───
const ARIA_ANALYSIS_STATES = [
  { label: "Summarizing patient history...", detail: "Synthesizing 48 months of longitudinal clinical data." },
  { label: "Cross-referencing imaging...", detail: "Comparing current DICOM series with historical baselines." },
  { label: "Suggesting diagnostic pathways...", detail: "Correlating findings with latest clinical guidelines." },
  { label: "Analyzing biomarkers...", detail: "Identifying subtle shifts in pulmonary function indicators." }
];

// ─── Role options for Screen 6 ───
const ROLES = [
  { id: 'radiologist', label: 'Radiologist', icon: Eye, desc: 'Diagnostic imaging specialist' },
  { id: 'clinician', label: 'Clinician', icon: Stethoscope, desc: 'Primary care & specialists' },
  { id: 'researcher', label: 'Researcher', icon: FlaskConical, desc: 'Clinical research & trials' },
  { id: 'admin', label: 'Admin', icon: UserCog, desc: 'System administration' },
];

// ─── Shared transition configs ───
const springTransition = { type: "spring", stiffness: 300, damping: 30 };
const smoothTransition = { duration: 0.8, ease: [0.16, 1, 0.3, 1] };

// ═══════════════════════════════════════════════
// ░░ SCREEN 0: AUTHENTICATION
// ═══════════════════════════════════════════════
function ScreenAuth({ isActive, onAuthSuccess }: { isActive: boolean; onAuthSuccess: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      onAuthSuccess(result.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsLoading(true);
    const provider = new OAuthProvider('apple.com');
    try {
      const result = await signInWithPopup(auth, provider);
      onAuthSuccess(result.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      if (isLogin) {
        const result = await signInWithEmailAndPassword(auth, email, password);
        onAuthSuccess(result.user);
      } else {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        onAuthSuccess(result.user);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-6">
      <FloatingParticles count={25} />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={isActive ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full glass-card-apple rounded-[44px] p-2 bg-white/40 dark:bg-black/20 backdrop-blur-3xl border-white/20 dark:border-white/5 shadow-2xl relative z-10"
      >
        <div className="bg-white/80 dark:bg-white/5 rounded-[40px] p-8 md:p-10">
          <div className="text-center mb-10">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-6 shadow-inner">
               <Activity className="w-8 h-8 text-accent animate-logo-pulse" />
            </div>
            <h2 className="text-3xl font-black tracking-tighter text-primary mb-2">Omnia Gateway</h2>
            <p className="text-sm text-text-secondary font-medium dark:text-white/50">Your clinical intelligence starts here.</p>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl mb-6 text-[11px] text-red-500 dark:text-red-400 font-bold flex items-center gap-3"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </motion.div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-8">
            <button 
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="flex flex-col items-center justify-center gap-3 p-5 rounded-3xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 hover:bg-black/5 transition-all group disabled:opacity-50"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-[10px] font-black uppercase tracking-widest text-primary">Google</span>
            </button>
            
            <button 
              onClick={handleAppleLogin}
              disabled={isLoading}
              className="flex flex-col items-center justify-center gap-3 p-5 rounded-3xl bg-black dark:bg-white/10 border border-white/10 hover:bg-zinc-900 transition-all group disabled:opacity-50"
            >
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C3.3 16.03 2.1 10.2 4.41 7.1c1.16-1.56 2.76-2.52 4.49-2.55 1.63-.03 2.74 1.1 3.8 1.1 1.03 0 2.54-1.28 4.42-1.08 1.77.2 3.01.88 3.84 2.11-3.54 2.1-2.98 6.53.52 7.9-1.04 1.83-2.17 3.51-4.43 5.71zM12.03 7.25c-.21-2.5 1.74-4.66 4.15-4.82.25 2.4-2.15 4.79-4.15 4.82z"/>
              </svg>
              <span className="text-[10px] font-black uppercase tracking-widest text-white">Apple</span>
            </button>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="relative group">
              <input 
                type="email" 
                placeholder="Work Email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-6 py-4 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent focus:border-accent/40 focus:bg-white dark:focus:bg-black/40 text-primary placeholder:text-slate-400 font-bold text-sm outline-none transition-all"
                required
              />
            </div>
            <div className="relative group">
              <input 
                type="password" 
                placeholder="Password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-6 py-4 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent focus:border-accent/40 focus:bg-white dark:focus:bg-black/40 text-primary placeholder:text-slate-400 font-bold text-sm outline-none transition-all"
                required
              />
            </div>
            
            <button 
              type="submit"
              disabled={isLoading}
              className="w-full py-5 mt-4 rounded-[24px] bg-accent text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isLogin ? 'Initialize Session' : 'Create Intelligence Profile'}
            </button>
          </form>

          <p className="text-center mt-8 text-[11px] font-bold text-text-secondary dark:text-white/30">
            {isLogin ? "Neural interface missing?" : "Already verified?"}
            <button 
              onClick={() => setIsLogin(!isLogin)} 
              className="text-accent hover:text-accent/80 ml-2 transition-colors underline underline-offset-4 decoration-accent/30"
            >
              {isLogin ? "Sync New Node" : "Access Hub"}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Deterministic pseudo-random from seed (avoids hydration mismatch) ───

// ─── Deterministic pseudo-random from seed (avoids hydration mismatch) ───
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

// ─── Pre-computed particle data (deterministic) ───
function generateParticleData(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const s = (seed: number) => seededRandom(i * 7 + seed);
    return {
      width: s(1) * 3 + 1,
      height: s(2) * 3 + 1,
      left: s(3) * 100,
      top: s(4) * 100,
      opacity: s(5) * 0.3 + 0.05,
      animY: -(s(6) * 80 + 20),
      animX: (s(7) - 0.5) * 40,
      animOpacity: s(8) * 0.4 + 0.1,
      duration: s(9) * 6 + 4,
      delay: s(10) * 3,
    };
  });
}

// ─── Floating particle component ───
const PARTICLE_DATA_40 = generateParticleData(40);
const PARTICLE_DATA_20 = generateParticleData(20);
const PARTICLE_DATA_15 = generateParticleData(15);
const PARTICLE_DATA_12 = generateParticleData(12);

const PARTICLE_CACHE: Record<number, typeof PARTICLE_DATA_40> = {
  40: PARTICLE_DATA_40,
  20: PARTICLE_DATA_20,
  15: PARTICLE_DATA_15,
  12: PARTICLE_DATA_12,
};

function FloatingParticles({ count = 30, color = "#60A5FA" }: { count?: number; color?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const particles = PARTICLE_CACHE[count] || generateParticleData(count);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {mounted && particles.map((p, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{
            y: [0, p.animY, 0],
            x: [0, p.animX, 0],
            opacity: [0.05, p.animOpacity, 0.05],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeInOut",
          }}
          className="absolute rounded-full"
          style={{
            width: p.width,
            height: p.height,
            backgroundColor: color,
            left: `${p.left}%`,
            top: `${p.top}%`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Pre-computed waveform data (deterministic) ───
function generateWaveData(barCount: number) {
  return Array.from({ length: barCount }, (_, i) => ({
    peakHeight: seededRandom(i * 3 + 100) * 32 + 8,
    duration: 1.2 + seededRandom(i * 3 + 200) * 0.6,
  }));
}

const WAVE_DATA_28 = generateWaveData(28);
const WAVE_DATA_24 = generateWaveData(24);

// ─── Neural waveform bars ───
function NeuralWaveform({ barCount = 24, className = "" }: { barCount?: number; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const bars = barCount === 28 ? WAVE_DATA_28 : barCount === 24 ? WAVE_DATA_24 : generateWaveData(barCount);

  return (
    <div className={cn("flex items-end justify-center gap-[3px]", className)}>
      {mounted && bars.map((bar, i) => (
        <motion.div
          key={i}
          initial={{ height: 6 }}
          animate={{ height: [6, bar.peakHeight, 6] }}
          transition={{ duration: bar.duration, repeat: Infinity, delay: i * 0.04 }}
          className="w-[2px] bg-accent/50 rounded-full"
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 1: ARIA AWAKENS
// ═══════════════════════════════════════════════
function ScreenAriaAwakens({ isActive }: { isActive: boolean }) {
  const words1 = ["Hello.", "I'm", "Aria."];
  const words2 = ["Your", "clinical", "intelligence", "layer."];

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={40} />

      {/* Pulsing neural orb */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={isActive ? { scale: 1, opacity: 1 } : {}}
        transition={{ ...springTransition, delay: 0.3 }}
        className="relative mb-16"
      >
        {/* Outer rings */}
        <motion.div
          animate={{ scale: [1, 1.3, 1], opacity: [0.08, 0.2, 0.08] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -inset-24 bg-accent rounded-full blur-3xl"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.3, 0.1] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          className="absolute -inset-16 bg-accent rounded-full blur-2xl"
        />
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.15, 0.4, 0.15] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute -inset-8 bg-accent/30 rounded-full blur-xl"
        />

        {/* Core orb */}
        <div className="relative w-28 h-28 rounded-full bg-gradient-to-br from-accent/30 to-accent/10 backdrop-blur-xl border border-accent/30 flex items-center justify-center shadow-[0_0_80px_rgba(96,165,250,0.3)]">
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [1, 0.7, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Activity className="w-12 h-12 text-accent" />
          </motion.div>
        </div>

        {/* Waveform below orb */}
        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-48">
          <NeuralWaveform barCount={28} />
        </div>
      </motion.div>

      {/* Text content */}
      <div className="relative z-10 text-center mt-8 space-y-4">
        {/* "Hello. I'm Aria." */}
        <div className="flex items-center justify-center gap-3">
          {words1.map((word, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 15 }}
              animate={isActive ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 1 + i * 0.15, duration: 0.6 }}
              className={cn(
                "text-4xl md:text-6xl font-extrabold tracking-tight",
                word === "Aria." ? "text-accent" : "text-primary"
              )}
            >
              {word}
            </motion.span>
          ))}
        </div>

        {/* "Your clinical intelligence layer." */}
        <div className="flex items-center justify-center gap-2">
          {words2.map((word, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={isActive ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 1.6 + i * 0.12, duration: 0.5 }}
              className="text-lg md:text-xl font-medium text-text-secondary"
            >
              {word}
            </motion.span>
          ))}
        </div>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : {}}
          transition={{ delay: 2.5, duration: 1 }}
          className="text-[11px] font-black text-accent/60 uppercase tracking-[0.35em] mt-8 pt-4"
        >
          I see what scans can't show you — yet.
        </motion.p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 2: WHAT OMNIA SEES
// ═══════════════════════════════════════════════
function ScreenWhatOmniaSees({ isActive }: { isActive: boolean }) {
  const capabilities = [
    { icon: Wind, title: "Sub-mm Nodule Detection", stat: "99.4%", statLabel: "Clinical Sensitivity", desc: "Deep convolutional networks identify pulmonary anomalies in routine CT scans." },
    { icon: Fingerprint, title: "Lesion Mapping", stat: "<1mm", statLabel: "Resolution Limit", desc: "Visual pattern recognition with instant risk-scoring for malignant melanoma." },
    { icon: Activity, title: "Longitudinal Analysis", stat: "0.02", statLabel: "False Positives / Scan", desc: "Automatically correlate historical imaging for volumetric tumor tracking." },
  ];

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={20} />

      <div className="relative z-10 max-w-5xl w-full mx-auto px-6 flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
        {/* Left — Scan Visualization */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isActive ? { opacity: 1, scale: 1 } : {}}
          transition={{ ...smoothTransition, delay: 0.2 }}
          className="relative w-64 h-64 md:w-80 md:h-80 flex-shrink-0"
        >
          {/* Scan container */}
          <div className="relative w-full h-full rounded-[32px] bg-primary/5 border border-primary/10 overflow-hidden backdrop-blur-xl">
            {/* Grid overlay */}
            <div
              className="absolute inset-0 opacity-20"
              style={{ backgroundImage: 'radial-gradient(#60A5FA 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }}
            />

            {/* Scan line */}
            <motion.div
              animate={{ top: ['-10%', '110%'] }}
              transition={{ duration: 3, ease: "linear", repeat: Infinity }}
              className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_15px_#60A5FA] z-10"
            />

            {/* Central lung icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Wind className="w-24 h-24 text-primary/10" />
            </div>

            {/* Detection markers */}
            {[
              { top: '28%', left: '35%', delay: 1.2 },
              { top: '45%', left: '62%', delay: 1.8 },
              { top: '60%', left: '40%', delay: 2.4 },
            ].map((marker, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                animate={isActive ? { opacity: 1, scale: 1 } : {}}
                transition={{ delay: marker.delay, duration: 0.6, type: "spring" }}
                className="absolute w-10 h-10 -translate-x-1/2 -translate-y-1/2"
                style={{ top: marker.top, left: marker.left }}
              >
                <div className="absolute inset-0 border-2 border-accent/60 rounded-full animate-pulse" />
                <div className="absolute inset-0 bg-accent/15 rounded-full" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 bg-accent rounded-full shadow-[0_0_12px_rgba(96,165,250,0.6)]" />
                </div>
              </motion.div>
            ))}

            {/* DICOM metadata */}
            <div className="absolute bottom-3 left-3 flex flex-col gap-0.5 opacity-40">
              <span className="text-[7px] font-black text-primary uppercase tracking-widest">ARIA SCAN ENGINE</span>
              <span className="text-[7px] font-black text-accent uppercase tracking-widest">3 REGIONS DETECTED</span>
            </div>
          </div>
        </motion.div>

        {/* Right — Capabilities */}
        <div className="flex-1 space-y-6">
          {/* Aria narration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isActive ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="mb-8"
          >
            <div className="flex items-center gap-2 mb-3">
              <BrainCircuit className="w-4 h-4 text-accent" />
              <span className="text-[11px] font-black text-accent uppercase tracking-[0.2em]">Aria Insight</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-primary tracking-tight">
              I detect what others <span className="text-accent">miss.</span>
            </h2>
          </motion.div>

          {/* Capability cards */}
          {capabilities.map((cap, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 30 }}
              animate={isActive ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: 0.8 + i * 0.2, duration: 0.6 }}
              className="glass-card-apple rounded-2xl p-5 flex items-start gap-4 group transition-colors duration-300"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
                <cap.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-bold text-primary">{cap.title}</h4>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-accent">{cap.stat}</span>
                    <span className="block text-[8px] font-bold text-text-secondary uppercase tracking-wider">{cap.statLabel}</span>
                  </div>
                </div>
                <p className="text-xs text-text-secondary font-medium leading-relaxed">{cap.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 3: CLINICAL PRECISION
// ═══════════════════════════════════════════════
function ScreenClinicalPrecision({ isActive }: { isActive: boolean }) {
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [currentState, setCurrentState] = useState(0);
  const [analysisComplete, setAnalysisComplete] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setAnalysisProgress(0);
      setCurrentState(0);
      setAnalysisComplete(false);
      return;
    }

    // Progress timer
    let progress = 0;
    const progressTimer = setInterval(() => {
      progress += 1.2;
      if (progress >= 100) {
        setAnalysisProgress(100);
        clearInterval(progressTimer);
        setTimeout(() => setAnalysisComplete(true), 600);
      } else {
        setAnalysisProgress(Math.floor(progress));
      }
    }, 60);

    // State cycling
    const stateTimer = setInterval(() => {
      setCurrentState(prev => (prev + 1) % ARIA_ANALYSIS_STATES.length);
    }, 2000);

    return () => {
      clearInterval(progressTimer);
      clearInterval(stateTimer);
    };
  }, [isActive]);

  const circumference = 2 * Math.PI * 90;

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={15} />

      <div className="relative z-10 flex flex-col items-center text-center max-w-2xl mx-auto px-6">
        {/* Aria narration */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isActive ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-12"
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-accent" />
            <span className="text-[11px] font-black text-accent uppercase tracking-[0.2em]">Live Analysis</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-primary tracking-tight">
            Watch me <span className="text-accent">work.</span>
          </h2>
        </motion.div>

        {/* Analysis ring */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={isActive ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 0.5, ...springTransition }}
          className="relative w-52 h-52 mb-10"
        >
          <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" strokeWidth="3" className="text-primary/10" />
            <motion.circle
              cx="100" cy="100" r="90" fill="none" stroke="#60A5FA" strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              animate={{ strokeDashoffset: circumference - (circumference * analysisProgress) / 100 }}
              className="drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {!analysisComplete ? (
              <>
                <span className="text-3xl font-extrabold text-primary">{analysisProgress}%</span>
                <span className="text-[8px] font-black text-accent uppercase tracking-[0.3em] mt-1">Processing</span>
              </>
            ) : (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className="flex flex-col items-center"
              >
                <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mb-1">
                  <Activity className="w-6 h-6 text-accent" />
                </div>
                <span className="text-[9px] font-black text-accent uppercase tracking-widest">Complete</span>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Cycling analysis states */}
        <div className="h-20 flex items-center justify-center mb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentState}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <h3 className="text-lg font-bold text-primary mb-1 tracking-tight">
                {ARIA_ANALYSIS_STATES[currentState].label}
              </h3>
              <p className="text-sm text-text-secondary font-medium">
                {ARIA_ANALYSIS_STATES[currentState].detail}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Metrics reveal on completion */}
        <AnimatePresence>
          {analysisComplete && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="grid grid-cols-3 gap-6 w-full max-w-md"
            >
              {[
                { label: "Confidence", value: "98.4%" },
                { label: "Latency", value: "12ms" },
                { label: "Engine", value: "Lung-V2" },
              ].map((metric, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.15 }}
                  className="glass-card-apple rounded-2xl p-4 text-center"
                >
                  <p className="text-[9px] font-black text-accent uppercase tracking-widest mb-1">{metric.label}</p>
                  <p className="text-xl font-extrabold text-primary">{metric.value}</p>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Model info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 0.5 } : {}}
          transition={{ delay: 1 }}
          className="mt-8 flex items-center gap-2"
        >
          <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">Omnia-Lung-V2</span>
          <span className="text-[8px] text-primary/30">•</span>
          <span className="text-[8px] font-medium text-text-secondary">Version 2.4.1</span>
        </motion.div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 4: SEAMLESS WORKFLOW
// ═══════════════════════════════════════════════
function ScreenWorkflow({ isActive }: { isActive: boolean }) {
  const steps = [
    { step: "01", icon: UploadCloud, title: "Capture", desc: "Upload or stream clinical imaging data directly through DICOM-compatible interfaces.", color: "from-accent/20 to-accent/5" },
    { step: "02", icon: BrainCircuit, title: "Analyze", desc: "Aria handles AI-assisted detection, correlation, and diagnostic pathway generation.", color: "from-accent/15 to-accent/5" },
    { step: "03", icon: ShieldCheck, title: "Review", desc: "Verified insights delivered to your clinical dashboard for confident decision-making.", color: "from-accent/10 to-accent/5" },
  ];

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={15} />

      <div className="relative z-10 max-w-4xl w-full mx-auto px-6">
        {/* Aria narration */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isActive ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-accent" />
            <span className="text-[11px] font-black text-accent uppercase tracking-[0.2em]">Clinical Workflow</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-primary tracking-tight">
            Three steps. <span className="text-accent">That's all.</span>
          </h2>
        </motion.div>

        {/* Steps */}
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Connecting line (desktop) */}
          <div className="hidden md:block absolute top-1/2 left-[16%] right-[16%] h-[1px] -translate-y-1/2 overflow-hidden">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={isActive ? { scaleX: 1 } : {}}
              transition={{ delay: 0.6, duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
              className="h-full bg-gradient-to-r from-accent/40 via-accent/20 to-accent/40 origin-left"
            />
          </div>

          {steps.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              animate={isActive ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.6 + i * 0.25, duration: 0.7 }}
              className="relative glass-card-apple rounded-[32px] p-8 text-center group transition-all duration-500 overflow-hidden shadow-sm"
            >
              {/* Step watermark */}
              <div className="absolute -top-4 -right-2 text-8xl font-black text-primary/[0.03] pointer-events-none select-none">
                {item.step}
              </div>

              {/* Gradient top edge */}
              <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${item.color} opacity-60`} />

              <div className="relative z-10 space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto text-accent shadow-inner">
                  <item.icon className="w-7 h-7 stroke-[1.5]" />
                </div>
                <div>
                  <span className="text-[10px] font-black text-accent uppercase tracking-[0.3em] block mb-2">Step {item.step}</span>
                  <h4 className="text-xl font-bold text-primary mb-2 tracking-tight">{item.title}</h4>
                  <p className="text-sm text-text-secondary font-medium leading-relaxed">{item.desc}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 5: TRUST & SECURITY
// ═══════════════════════════════════════════════
function ScreenTrust({ isActive }: { isActive: boolean }) {
  const trustBadges = [
    "HIPAA Compliant", "Medical-grade Security", "End-to-end Encryption", "SOC 2 Type II"
  ];

  const metrics = [
    { label: "Response Time", value: "<10", unit: "ms", detail: "Real-time clinical inference" },
    { label: "Consistency", value: "99.9", unit: "%", detail: "Diagnostic reliability score" },
    { label: "Uptime", value: "99.99", unit: "%", detail: "Mission-critical availability" },
  ];

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={12} />

      <div className="relative z-10 max-w-3xl w-full mx-auto px-6 text-center">
        {/* Shield with ripple effect */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={isActive ? { opacity: 1, scale: 1 } : {}}
          transition={{ ...springTransition, delay: 0.3 }}
          className="relative w-32 h-32 mx-auto mb-12"
        >
          {/* Ripple rings */}
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              animate={{ scale: [1, 1.8 + i * 0.3], opacity: [0.15, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
              className="absolute inset-0 border border-accent/30 rounded-full"
            />
          ))}

          <div className="relative w-full h-full rounded-full bg-gradient-to-br from-accent/20 to-accent/5 backdrop-blur-xl border border-accent/20 flex items-center justify-center shadow-[0_0_60px_rgba(96,165,250,0.15)]">
            <Shield className="w-14 h-14 text-accent" />
          </div>
        </motion.div>

        {/* Aria narration */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isActive ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="mb-10"
        >
          <h2 className="text-3xl md:text-4xl font-extrabold text-primary tracking-tight mb-3">
            Your patients' data is <span className="text-accent">sacred.</span>
          </h2>
          <p className="text-lg text-text-secondary font-medium">Enterprise-grade security. Always.</p>
        </motion.div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : {}}
          transition={{ delay: 0.8 }}
          className="flex flex-wrap justify-center gap-3 mb-14"
        >
          {trustBadges.map((badge, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={isActive ? { opacity: 1, scale: 1 } : {}}
           transition={{ delay: 0.9 + i * 0.1, type: "spring" }}
              className="flex items-center gap-2 px-4 py-2 rounded-full glass-card-apple text-[11px] font-bold text-primary/80 tracking-wide"
            >
              <Lock className="w-3 h-3 text-accent" />
              {badge}
            </motion.div>
          ))}
        </motion.div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-4">
          {metrics.map((metric, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={isActive ? { opacity: 1, y: 0 } : {}}
               transition={{ delay: 1.2 + i * 0.15, duration: 0.6 }}
              className="glass-card-apple rounded-2xl p-5 group transition-all duration-500 shadow-sm"
            >
              <p className="text-[9px] font-black text-accent uppercase tracking-[0.2em] mb-2">{metric.label}</p>
              <p className="text-2xl md:text-3xl font-extrabold text-primary tracking-tight">
                {metric.value}<span className="text-base text-text-secondary ml-0.5">{metric.unit}</span>
              </p>
              <p className="text-[10px] text-text-secondary font-medium mt-1">{metric.detail}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 6: YOUR PROFILE
// ═══════════════════════════════════════════════
function ScreenProfile({ isActive, selectedRole, onSelectRole, specialty, onSpecialtyChange, userName }: {
  isActive: boolean;
  selectedRole: string;
  onSelectRole: (role: string) => void;
  specialty: string;
  onSpecialtyChange: (val: string) => void;
  userName?: string;
}) {
  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={15} />

      <div className="relative z-10 max-w-lg w-full mx-auto px-6 text-center">
        {/* Aria narration */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isActive ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 0.2, duration: 0.8 }}
          className="mb-10"
        >
           <div className="w-20 h-20 rounded-[28px] bg-gradient-to-br from-accent to-blue-600 flex items-center justify-center mx-auto mb-6 text-white text-2xl font-black shadow-xl ring-4 ring-white dark:ring-white/10">
            {userName ? userName[0].toUpperCase() : <UserCog className="w-8 h-8" />}
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-primary tracking-tight mb-2">
            Welcome, <span className="text-accent">{userName || "Doctor"}</span>.
          </h2>
          <p className="text-base text-text-secondary font-medium">Configure your clinical workspace profile.</p>
        </motion.div>

        {/* Role Selection */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {ROLES.map((role, i) => (
            <motion.button
              key={role.id}
              initial={{ opacity: 0, y: 20 }}
              animate={isActive ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.5 + i * 0.1, duration: 0.5 }}
              onClick={() => onSelectRole(role.id)}
               className={cn(
                "relative glass-card-apple rounded-2xl p-5 text-left transition-all duration-300 overflow-hidden group shadow-sm",
                selectedRole === role.id
                  ? "border-accent/50 bg-accent/[0.08] shadow-[0_0_30px_rgba(96,165,250,0.1)]"
                  : ""
              )}
            >
              {selectedRole === role.id && (
                <motion.div
                  layoutId="role-glow"
                  className="absolute inset-0 bg-gradient-to-br from-accent/10 to-transparent rounded-2xl"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <div className="relative z-10">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-colors",
                   selectedRole === role.id ? "bg-accent/20 text-accent" : "bg-primary/5 text-text-secondary"
                )}>
                  <role.icon className="w-5 h-5" />
                </div>
                <h4 className={cn("text-sm font-bold mb-0.5 transition-colors", selectedRole === role.id ? "text-accent" : "text-primary")}>{role.label}</h4>
                <p className="text-[10px] text-text-secondary font-medium">{role.desc}</p>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Specialty input */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={isActive ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 1, duration: 0.5 }}
          className="mb-10"
        >
          <label className="block text-[10px] font-black text-accent uppercase tracking-[0.2em] mb-2 text-left">
            Department / Specialty
          </label>
          <input
            type="text"
            value={specialty}
            onChange={(e) => onSpecialtyChange(e.target.value)}
            placeholder="e.g. Thoracic Radiology"
            className="w-full px-5 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-600 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/30 transition-all backdrop-blur-xl"
          />
        </motion.div>

        {/* Aria's farewell */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : {}}
          transition={{ delay: 1.3, duration: 0.8 }}
          className="text-[11px] font-bold text-slate-500 italic"
        >
          "I'll be right here when you need me."
        </motion.p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════
// ░░ MAIN ONBOARDING CONTROLLER
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// ░░ SCREEN 7: SETUP COMPLETE
// ═══════════════════════════════════════════════
function ScreenComplete({ isActive }: { isActive: boolean }) {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-6 overflow-hidden">
      <FloatingParticles count={20} />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={isActive ? { opacity: 1, scale: 1 } : {}}
        className="max-w-md w-full text-center relative z-10"
      >
        <div className="relative w-32 h-32 mx-auto mb-10">
           <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 border border-accent/20 rounded-full"
           />
           <motion.div 
            animate={{ rotate: -360 }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute inset-4 border border-accent/40 rounded-full border-dashed"
           />
           <div className="absolute inset-8 rounded-full bg-accent/10 flex items-center justify-center text-accent">
              <ShieldCheck className="w-10 h-10" />
           </div>
        </div>

        <h2 className="text-4xl font-black text-primary tracking-tighter mb-4">Neural Link Established.</h2>
        <p className="text-lg text-text-secondary font-medium mb-12">Omnia has initialized your environment. You are cleared for clinical intelligence operations.</p>
        
        <div className="glass-card-apple rounded-[32px] p-6 bg-white/40 dark:bg-white/5 border-white/20 dark:border-white/10 flex items-center gap-4 mb-8">
           <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-green-500">
              <Activity className="w-6 h-6" />
           </div>
           <div className="text-left">
              <p className="text-[10px] font-black text-green-500 uppercase tracking-widest">System Status</p>
              <p className="text-sm font-bold text-primary">Core Intelligence Online</p>
           </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedRole, setSelectedRole] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [direction, setDirection] = useState(0);
  const totalSteps = 8;

  const goNextWithDir = useCallback(() => {
    if (isTransitioning || currentStep >= totalSteps - 1) return;
    setDirection(1);
    setIsTransitioning(true);
    setCurrentStep(prev => prev + 1);
    setTimeout(() => setIsTransitioning(false), 600);
  }, [currentStep, isTransitioning]);

  const goPrevWithDir = useCallback(() => {
    if (isTransitioning || currentStep === 0) return;
    setDirection(-1);
    setIsTransitioning(true);
    setCurrentStep(prev => prev - 1);
    setTimeout(() => setIsTransitioning(false), 600);
  }, [currentStep, isTransitioning]);

  const navigateTo = (step: number) => {
    if (isTransitioning) return;
    if (step > 0 && !user) return;
    setDirection(step > currentStep ? 1 : -1);
    setIsTransitioning(true);
    setCurrentStep(step);
    setTimeout(() => setIsTransitioning(false), 600);
  };

  // Set initial theme preference and listen for auth
  useEffect(() => {
    // If already onboarded, skip to dashboard
    if (localStorage.getItem('onboarding_complete') === 'true') {
      router.push('/dashboard');
      return;
    }

    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        if (currentStep === 0) goNextWithDir();
      }
    });
    return () => unsubscribe();
  }, [currentStep, goNextWithDir, router]);

  const toggleTheme = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);
    if (newDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };


  const handleAuthSuccess = (u: User) => {
    setUser(u);
    goNextWithDir();
  };

  const handleEnterPlatform = async () => {
    if (!user) {
      console.warn("No user found during platform entry.");
      return;
    }
    
    // Save onboarding state locally immediately
    localStorage.setItem('onboarding_complete', 'true');
    if (selectedRole) localStorage.setItem('user_role', selectedRole);
    if (specialty) localStorage.setItem('user_specialty', specialty);

    // Save to Firestore (non-blocking)
    setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || emailToName(user.email),
      role: selectedRole || 'radiologist',
      specialty: specialty || 'General',
      onboardedAt: new Date().toISOString()
    }, { merge: true }).catch(err => {
      console.error("Firestore sync failed (non-critical):", err);
    });

    console.log("Navigating to dashboard...");
    router.push('/dashboard');
  };

  const emailToName = (email: string | null) => {
    if (!email) return 'Doctor';
    return email.split('@')[0].split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  };

  const handleSkip = () => {
    localStorage.setItem('onboarding_complete', 'true');
    router.push('/dashboard');
  };

  const screens = [
    <ScreenAuth key="auth" isActive={currentStep === 0} onAuthSuccess={handleAuthSuccess} />,
    <ScreenAriaAwakens key="s1" isActive={currentStep === 1} />,
    <ScreenWhatOmniaSees key="s2" isActive={currentStep === 2} />,
    <ScreenClinicalPrecision key="s3" isActive={currentStep === 3} />,
    <ScreenWorkflow key="s4" isActive={currentStep === 4} />,
    <ScreenTrust key="s5" isActive={currentStep === 5} />,
    <ScreenProfile
      key="s6"
      isActive={currentStep === 6}
      selectedRole={selectedRole}
      onSelectRole={setSelectedRole}
      specialty={specialty}
      onSpecialtyChange={setSpecialty}
      userName={emailToName(user?.email || "")}
    />,
    <ScreenComplete key="s7" isActive={currentStep === 7} />,
  ];

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0,
      scale: 0.95,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (direction: number) => ({
      x: direction > 0 ? '-30%' : '30%',
      opacity: 0,
      scale: 0.95,
    }),
  };



  // Re-bind keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNextWithDir();
      if (e.key === 'ArrowLeft') goPrevWithDir();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNextWithDir, goPrevWithDir]);

  return (
    <div className="fixed inset-0 bg-background transition-colors duration-500 overflow-hidden select-none">
      {/* Top Bar Controls */}
      <div className="fixed top-6 right-6 z-50 flex items-center gap-3">
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8 }}
          onClick={toggleTheme}
          className="p-2.5 rounded-full glass-card-apple border-white/20 text-text-secondary hover:text-accent transition-all"
        >
          {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </motion.button>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          onClick={handleSkip}
          className="text-[11px] font-bold text-text-secondary hover:text-primary uppercase tracking-widest transition-colors px-5 py-2.5 rounded-full glass-card-apple border-white/20"
        >
          Skip
        </motion.button>
      </div>

      {/* Omnia logo */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="fixed top-6 left-6 z-50 flex items-center gap-2"
      >
        <div className="relative w-7 h-7 flex items-center justify-center">
          <Activity className="w-5 h-5 text-accent relative z-10" />
          <motion.div
            animate={{ scale: [1, 1.4, 1], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="absolute inset-0 bg-accent rounded-full blur-md"
          />
        </div>
        <span className="font-bold text-[14px] tracking-tight text-primary">OMNIA</span>
      </motion.div>

      {/* Screen slides */}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={currentStep}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
          className="absolute inset-0"
        >
          {screens[currentStep]}
        </motion.div>
      </AnimatePresence>

      {/* Bottom controls */}
      <div className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-8 pt-20 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none transition-colors duration-500">
        <div className="max-w-lg mx-auto pointer-events-auto">
          {/* Progress bar */}
          <div className="w-full h-[3px] bg-primary/10 rounded-full mb-6 overflow-hidden">
            <motion.div
              animate={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
              className="h-full bg-gradient-to-r from-accent/60 to-accent rounded-full shadow-[0_0_10px_rgba(96,165,250,0.3)]"
            />
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between">
            {/* Back button */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: currentStep > 0 ? 1 : 0 }}
              onClick={goPrevWithDir}
              disabled={currentStep === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium text-text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-all disabled:pointer-events-none"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </motion.button>

            {/* Step indicator */}
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    width: i === currentStep ? 24 : 6,
                    backgroundColor: i === currentStep ? '#60A5FA' : i < currentStep ? 'rgba(96,165,250,0.3)' : 'var(--glass-border)',
                  }}
                  transition={{ duration: 0.3 }}
                  className="h-1.5 rounded-full cursor-pointer"
                  onClick={() => navigateTo(i)}
                />
              ))}
            </div>

            {/* Next / Enter button */}
            {currentStep < totalSteps - 1 ? (
              <motion.button
                onClick={goNextWithDir}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="relative flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary/5 backdrop-blur-xl border border-primary/10 text-sm font-bold text-primary hover:bg-primary/10 transition-all overflow-hidden group shadow-sm"
              >
                <span className="relative z-10">Continue</span>
                <ChevronRight className="w-4 h-4 relative z-10 group-hover:translate-x-0.5 transition-transform" />
                {/* Light sweep */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-accent/10 to-transparent -translate-x-full"
                  animate={{ translateX: ['-100%', '200%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
                />
              </motion.button>
            ) : (
              <motion.button
                onClick={handleEnterPlatform}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="relative flex items-center gap-2 px-8 py-3 rounded-full bg-accent text-white text-sm font-bold shadow-[0_0_30px_rgba(96,165,250,0.3)] hover:shadow-[0_0_50px_rgba(96,165,250,0.4)] transition-all overflow-hidden group"
              >
                <span className="relative z-10">Enter Omnia</span>
                <Zap className="w-4 h-4 fill-current relative z-10" />
                {/* Light sweep */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full"
                  animate={{ translateX: ['-100%', '200%'] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
                />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
