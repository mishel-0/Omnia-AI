'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import {
  Activity, Zap, BrainCircuit, Wind, Fingerprint, Database,
  ChevronRight, ChevronLeft, UploadCloud, ShieldCheck, Shield,
  Search, Scan, AlertCircle, Heart, Lock, Server, Eye,
  Stethoscope, FlaskConical, UserCog, Sun, Moon, Building2, Key
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { 
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
const springTransition = { type: "spring" as const, stiffness: 300, damping: 30 };
const smoothTransition = { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const };

// ═══════════════════════════════════════════════
// ░░ SCREEN 0: CLINIC AUTHENTICATION (B2B ONLY)
// ═══════════════════════════════════════════════
function ScreenAuth({ isActive, onAuthSuccess }: { isActive: boolean; onAuthSuccess: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clinicCode, setClinicCode] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // B2B gate: require clinic code for new registrations
    if (!isLogin && !clinicCode.trim()) {
      setError('Clinic access code is required for registration.');
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const result = await signInWithEmailAndPassword(auth, email, password);
        onAuthSuccess(result.user);
      } else {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        // Store clinic code in user profile
        if (clinicCode.trim()) {
          await setDoc(doc(db, 'users', result.user.uid), {
            email: result.user.email,
            clinicCode: clinicCode.trim().toUpperCase(),
            role: 'radiologist',
            createdAt: new Date().toISOString(),
            provider: 'clinic',
          });
        }
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
            <h2 className="text-3xl font-black tracking-tighter text-primary mb-2">
              {isLogin ? 'Omnia Access' : 'Clinic Registration'}
            </h2>
            <p className="text-sm text-text-secondary font-medium dark:text-white/50">
              {isLogin ? 'Authorized clinical personnel only.' : 'Register your clinic for AI diagnostics.'}
            </p>
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

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="relative group">
              <input 
                type="email" 
                placeholder="Clinic Email" 
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

            {!isLogin && (
              <div className="relative group">
                <div className="flex items-center gap-2 px-1 mb-2">
                  <Building2 className="w-3.5 h-3.5 text-accent" />
                  <label className="text-[10px] font-black text-accent uppercase tracking-widest">Clinic Access Code</label>
                </div>
                <input 
                  type="text" 
                  placeholder="e.g. OMNIA-CLINIC-001"
                  value={clinicCode}
                  onChange={(e) => setClinicCode(e.target.value)}
                  className="w-full px-6 py-4 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent focus:border-accent/40 focus:bg-white dark:focus:bg-black/40 text-primary placeholder:text-slate-400 font-bold text-sm outline-none transition-all"
                />
                <p className="text-[9px] font-medium text-text-secondary/60 mt-2 px-1">
                  Provided by your clinic administrator
                </p>
              </div>
            )}
            
            <button 
              type="submit"
              disabled={isLoading}
              className="w-full py-5 mt-4 rounded-[24px] bg-accent text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {isLogin ? 'Access Clinical Hub' : 'Register Clinic'}
            </button>
          </form>

          <p className="text-center mt-8 text-[11px] font-bold text-text-secondary dark:text-white/30">
            {isLogin ? "New clinic?" : "Already registered?"}
            <button 
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              className="text-accent hover:text-accent/80 ml-2 transition-colors underline underline-offset-4 decoration-accent/30"
            >
              {isLogin ? "Request Access" : "Sign In"}
            </button>
          </p>

          {/* Demo mode bypass — when Firebase isn't configured */}
          <div className="mt-6 pt-6 border-t border-black/5 dark:border-white/10">
            <button 
              onClick={() => {
                localStorage.setItem('user_role', 'radiologist');
                localStorage.setItem('onboarding_complete', 'true');
                window.location.href = '/dashboard';
              }}
              className="w-full py-3 rounded-[20px] bg-white/40 dark:bg-white/5 border border-dashed border-accent/30 text-accent text-[11px] font-black uppercase tracking-widest hover:bg-accent/10 transition-all"
            >
              Continue as Demo — Explore Platform
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

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
          <div className="space-y-4">
            {capabilities.map((cap, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 20 }}
                animate={isActive ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.6 + i * 0.15, duration: 0.6 }}
                className="p-5 rounded-3xl bg-white/40 dark:bg-white/5 border border-white/10 dark:border-white/10 hover:bg-white/60 dark:hover:bg-white/10 transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0 text-accent group-hover:scale-110 transition-transform">
                    <cap.icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-black text-primary">{cap.title}</h3>
                      <span className="text-xs font-black text-accent flex-shrink-0">{cap.stat}</span>
                    </div>
                    <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">{cap.statLabel}</p>
                    <p className="text-[12px] text-text-secondary font-medium mt-1 leading-relaxed">{cap.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Next screen CTA */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : {}}
            transition={{ delay: 1.5 }}
            className="text-right"
          >
            <span className="text-[8px] font-black text-accent uppercase tracking-[0.3em] opacity-60">Scroll to continue →</span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 3: ARIA IN ACTION (Analysis Simulation)
// ═══════════════════════════════════════════════
function ScreenAriaInAction({ isActive }: { isActive: boolean }) {
  const [stateIndex, setStateIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setStateIndex(prev => (prev + 1) % ARIA_ANALYSIS_STATES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={15} color="#38BDF8" />
      
      <div className="relative z-10 max-w-4xl w-full mx-auto px-6 flex flex-col items-center">
        {/* Analysis visualization */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isActive ? { opacity: 1, scale: 1 } : {}}
          transition={{ ...smoothTransition, delay: 0.2 }}
          className="relative w-full max-w-2xl aspect-[16/9] glass-card-apple rounded-[40px] p-8 mb-12 overflow-hidden"
        >
          {/* Scan grid bg */}
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(#60A5FA 1px, transparent 1px)', backgroundSize: '20px 20px' }}
          />

          {/* Progress indicator */}
          <div className="relative z-10 h-full flex flex-col items-center justify-center">
            <div className="relative w-32 h-32 mb-6">
              <svg className="w-full h-full -rotate-90">
                <circle cx="64" cy="64" r="58" fill="none" stroke="currentColor" strokeWidth="4" className="text-white/10" />
                <motion.circle
                  cx="64" cy="64" r="58" fill="none" stroke="currentColor" strokeWidth="4"
                  className="text-accent"
                  strokeDasharray="365"
                  initial={{ strokeDashoffset: 365 }}
                  animate={isActive ? { strokeDashoffset: 90 } : {}}
                  transition={{ duration: 3, delay: 0.5 }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={isActive ? { opacity: 1 } : {}}
                  transition={{ delay: 1 }}
                  className="text-2xl font-black text-accent"
                >
                  78%
                </motion.span>
              </div>
            </div>

            <motion.div
              key={stateIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <p className="text-sm font-black text-primary mb-2">{ARIA_ANALYSIS_STATES[stateIndex].label}</p>
              <p className="text-xs text-text-secondary font-medium">{ARIA_ANALYSIS_STATES[stateIndex].detail}</p>
            </motion.div>
          </div>
        </motion.div>

        {/* Metrics row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isActive ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="grid grid-cols-3 gap-4 w-full max-w-2xl"
        >
          {[
            { label: 'Model', value: 'Omnia-Lung-V2' },
            { label: 'Latency', value: '12ms' },
            { label: 'Confidence', value: '98.4%' },
          ].map((m, i) => (
            <div key={i} className="glass-card-apple rounded-2xl p-4 text-center border-white/10">
              <p className="text-[9px] font-black text-text-secondary uppercase tracking-widest mb-1">{m.label}</p>
              <p className="text-sm font-black text-primary">{m.value}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ SCREEN 4: ROLE SELECTION
// ═══════════════════════════════════════════════
function ScreenRoleSelect({ isActive, onSelect }: { isActive: boolean; onSelect: (role: string) => void }) {
  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-colors duration-500">
      <FloatingParticles count={12} />
      <div className="relative z-10 max-w-3xl w-full mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isActive ? { opacity: 1, y: 0 } : {}}
          transition={{ ...smoothTransition, delay: 0.2 }}
          className="mb-12"
        >
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-primary mb-4">
            Your Clinical Role
          </h2>
          <p className="text-text-secondary text-lg font-medium">
            Select your specialty to personalize the Omnia experience.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {ROLES.map((role, i) => (
            <motion.button
              key={role.id}
              initial={{ opacity: 0, y: 20 }}
              animate={isActive ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.4 + i * 0.1, duration: 0.6 }}
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(role.id)}
              className="glass-card-apple rounded-[32px] p-6 flex flex-col items-center gap-4 border-white/10 hover:border-accent/30 hover:bg-white/50 dark:hover:bg-white/10 transition-all group"
            >
              <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center text-accent group-hover:scale-110 transition-transform group-hover:bg-accent/20">
                <role.icon className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-sm font-black text-primary mb-1">{role.label}</h3>
                <p className="text-[10px] text-text-secondary font-medium">{role.desc}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ░░ MAIN ONBOARDING CONTAINER
// ═══════════════════════════════════════════════
export default function OnboardingPage() {
  const router = useRouter();
  const [currentScreen, setCurrentScreen] = useState(0);
  const [user, setUser] = useState<User | null>(null);

  const screens = [
    ScreenAuth,
    ScreenAriaAwakens,
    ScreenWhatOmniaSees,
    ScreenAriaInAction,
    ScreenRoleSelect,
  ];

  const handleAuthSuccess = (u: User) => {
    setUser(u);
    setCurrentScreen(1);
  };

  const handleRoleSelect = async (role: string) => {
    try {
      if (user) {
        await setDoc(doc(db, 'users', user.uid), {
          displayName: user.email?.split('@')[0],
          email: user.email,
          role,
          onboardingComplete: true,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      localStorage.setItem('user_role', role);
      localStorage.setItem('onboarding_complete', 'true');
      router.push('/dashboard');
    } catch (err) {
      console.error("Role save error:", err);
      localStorage.setItem('user_role', role);
      localStorage.setItem('onboarding_complete', 'true');
      router.push('/dashboard');
    }
  };

  // Track scroll position for auto-advance
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    const progress = scrollTop / (scrollHeight - clientHeight);
    const screenIndex = Math.min(Math.floor(progress * screens.length), screens.length - 1);
    setCurrentScreen(screenIndex);
  }, []);

  return (
    <div 
      className="h-screen overflow-hidden bg-background"
      style={{ perspective: '1000px' }}
    >
      <div 
        className="h-full overflow-y-auto snap-y snap-mandatory no-scrollbar"
        onScroll={handleScroll}
      >
        {screens.map((Screen, index) => (
          <section key={index} className="h-screen w-full snap-start snap-always relative">
            <Screen isActive={currentScreen === index} onAuthSuccess={handleAuthSuccess} onSelect={handleRoleSelect} />
            
            {/* Bottom indicator */}
            {currentScreen === index && index < screens.length - 1 && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2"
              >
                <div className="flex gap-2">
                  {screens.map((_, i) => (
                    <div key={i} className={cn(
                      "h-1.5 rounded-full transition-all duration-500",
                      i === index ? "w-8 bg-accent" : "w-1.5 bg-white/20"
                    )} />
                  ))}
                </div>
              </motion.div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
