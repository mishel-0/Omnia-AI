'use client';

import React, { useState, useEffect } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
  Wind, Fingerprint, BrainCircuit, Database, Activity,
  ChevronRight, Sun, Moon, Zap, ShieldCheck,
  Scan, AlertCircle, UploadCloud
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const ARIA_STATES = [
  { label: "Summarizing patient history...", detail: "Synthesizing clinical data from imaging series." },
  { label: "Cross-referencing imaging...", detail: "Comparing current series with historical baselines." },
  { label: "Suggesting diagnostic pathways...", detail: "Correlating findings with clinical guidelines." },
  { label: "Analyzing biomarkers...", detail: "Identifying subtle shifts in pulmonary indicators." }
];

export default function Home() {
  const router = useRouter();
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [currentState, setCurrentState] = useState(0);
  const [modelInfo, setModelInfo] = useState<any>(null);

  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 300], [1, 0.98]);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved ? saved === 'dark' : prefersDark;
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/aria/info`)
      .then(r => r.json())
      .then(setModelInfo)
      .catch(() => setModelInfo({ name: 'Aria Neural Engine', version: '2.5.0', architecture: 'ResNet-18', classes: ['Benign', 'Malignant', 'Normal'] }));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setCurrentState(prev => (prev + 1) % ARIA_STATES.length), 5000);
    return () => clearInterval(t);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const goToPlatform = () => {
    const onboarded = localStorage.getItem('onboarding_complete');
    router.push(onboarded ? '/dashboard' : '/onboarding');
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white selection:bg-sky-500/30 overflow-x-hidden transition-colors duration-300">
      {/* Navbar */}
      <nav className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4">
        <div className="flex items-center gap-6 px-5 py-2 rounded-full bg-white/80 dark:bg-white/5 backdrop-blur-xl border border-slate-200 dark:border-white/10 shadow-lg dark:shadow-none">
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-sky-500" />
            <span className="font-bold text-sm tracking-tight text-slate-900 dark:text-white">OMNIA</span>
          </button>
          <div className="hidden md:flex items-center gap-1">
            {['Capabilities', 'System', 'Aria', 'About'].map(tab => (
              <button
                key={tab}
                onClick={() => document.getElementById(tab.toLowerCase())?.scrollIntoView({ behavior: 'smooth' })}
                className="px-4 py-1.5 rounded-full text-xs font-medium text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-full text-slate-500 dark:text-white/50 hover:text-sky-500 transition-colors">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={goToPlatform}
              className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-1.5 rounded-full text-xs font-bold hover:opacity-90 transition-all shadow-md"
            >
              Access Platform
            </button>
          </div>
        </div>
      </nav>

      <main className="relative">
        {/* ─── Hero ─── */}
        <section className="pt-40 pb-32 px-6 max-w-6xl mx-auto text-center">
          <motion.div style={{ opacity: heroOpacity, scale: heroScale }}>
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
              className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight"
            >
              Diagnose faster. <br />
              <span className="text-sky-500">Treat sooner.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="text-lg text-slate-500 dark:text-white/60 max-w-xl mx-auto mb-10 font-medium"
            >
              Omnia&apos;s AI instantly detects anomalies in clinical imaging, giving your care team the certainty to act fast.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20"
            >
              <button
                onClick={goToPlatform}
                className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-10 py-4 rounded-full font-bold text-lg hover:opacity-90 transition-all shadow-xl"
              >
                Start Diagnosis
              </button>
              <button
                onClick={() => document.getElementById('capabilities')?.scrollIntoView({ behavior: 'smooth' })}
                className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 px-10 py-4 rounded-full font-bold text-lg hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
              >
                View Capabilities
              </button>
            </motion.div>
            <p className="text-[11px] font-bold text-sky-500/80 uppercase tracking-[0.3em] mb-32">
              Designed for clinical environments
            </p>
          </motion.div>

          {/* Diagnostic Centerpiece Card */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 1.2 }}
            className="relative max-w-4xl mx-auto mb-32"
          >
            <div className="rounded-[32px] bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 p-8 md:p-12 backdrop-blur-sm">
              <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="flex-1 w-full aspect-[4/3] rounded-2xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-white/5 overflow-hidden relative flex items-center justify-center">
                  <div className="absolute inset-0 opacity-10"
                    style={{ backgroundImage: 'radial-gradient(#0EA5E9 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }}
                  />
                  <Scan className="w-20 h-20 text-slate-300 dark:text-white/10" />
                  <motion.div
                    animate={{ top: ['-10%', '110%'] }}
                    transition={{ duration: 2.5, ease: "linear", repeat: Infinity }}
                    className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-sky-400/60 to-transparent shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                  />
                  <div className="absolute bottom-3 left-3 flex flex-col gap-0.5 opacity-40">
                    <span className="text-[7px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/60">ARIA SCAN ENGINE</span>
                    <span className="text-[7px] font-bold uppercase tracking-widest text-sky-500">READY FOR ANALYSIS</span>
                  </div>
                </div>
                <div className="w-full md:w-64 space-y-4 text-left">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-500">Engine Status</span>
                    <h4 className="text-xl font-bold text-slate-900 dark:text-white">Aria Neural Engine</h4>
                    <p className="text-xs text-slate-500 dark:text-white/50">
                      {modelInfo?.architecture || 'ResNet-18'} • Version {modelInfo?.version || '2.5.0'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(modelInfo?.classes || ['Benign', 'Malignant', 'Normal']).map((c: string) => (
                      <span key={c} className="px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-semibold text-slate-600 dark:text-white/60">
                        {c}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={goToPlatform}
                    className="w-full bg-slate-900 dark:bg-white/10 hover:bg-slate-800 dark:hover:bg-white/15 border border-slate-200 dark:border-white/10 py-3 rounded-xl text-xs font-bold text-white dark:text-white transition-all flex items-center justify-center gap-2"
                  >
                    Upload Scan <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Trust Strip */}
        <section className="border-y border-slate-200 dark:border-white/10 py-10 mb-32">
          <div className="max-w-6xl mx-auto px-6 flex flex-wrap justify-center gap-x-16 gap-y-6">
            {["Medical-grade security", "Built for clinicians", "Real-time AI-assisted analysis"].map((text, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                <span className="text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wider">{text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Capabilities ─── */}
        <section id="capabilities" className="max-w-6xl mx-auto px-6 mb-48">
          <div className="text-center mb-16">
            <span className="text-sky-500 font-semibold tracking-wider uppercase text-xs mb-3 block">Clinical Intelligence Layer</span>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Precision at <br />every layer.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 auto-rows-[260px]">
            <div className="md:col-span-4 row-span-2 rounded-[32px] bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 p-10 relative overflow-hidden group hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors">
              <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-bl from-sky-500/5 to-transparent pointer-events-none" />
              <div className="relative z-10 h-full flex flex-col">
                <div className="w-12 h-12 rounded-xl bg-sky-500/10 flex items-center justify-center mb-auto text-sky-500">
                  <Wind className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Sub-millimeter Nodule Detection</h3>
                  <p className="text-sm text-slate-500 dark:text-white/50 max-w-xl leading-relaxed">
                    Deep convolutional networks identify pulmonary anomalies across routine CT scans earlier than conventional screening.
                  </p>
                  <div className="flex gap-6 mt-6 pt-6 border-t border-slate-200 dark:border-white/10 max-w-md">
                    <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Sensitivity</p><p className="text-xl font-bold text-slate-900 dark:text-white mt-1">99.4%</p></div>
                    <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Resolution</p><p className="text-xl font-bold text-slate-900 dark:text-white mt-1">&lt;1mm</p></div>
                    <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">False Pos.</p><p className="text-xl font-bold text-slate-900 dark:text-white mt-1">0.02</p></div>
                  </div>
                </div>
              </div>
            </div>

            {[
              { icon: Fingerprint, title: "Lesion Mapping", desc: "Instant risk-scoring for malignant melanoma indicators." },
              { icon: Activity, title: "Longitudinal Tracking", desc: "Correlate historical imaging for volumetric tumor progression." },
            ].map((feat, i) => (
              <div key={i} className="md:col-span-2 rounded-[28px] bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 p-8 flex flex-col justify-center hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-500 mb-4">
                  <feat.icon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{feat.title}</h3>
                <p className="text-xs text-slate-500 dark:text-white/50 leading-relaxed">{feat.desc}</p>
              </div>
            ))}

            {[
              { icon: AlertCircle, title: "Automated Triage", desc: "Prioritize urgent cases based on AI-derived confidence scores." },
              { icon: UploadCloud, title: "DICOM Interoperability", desc: "Seamless PACS/EHR integration with zero-footprint web viewer." },
            ].map((feat, i) => (
              <div key={i} className="md:col-span-3 rounded-[28px] bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 p-8 flex flex-col justify-center hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{feat.title}</h3>
                <p className="text-sm text-slate-500 dark:text-white/50 leading-relaxed max-w-sm">{feat.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Aria Intelligence ─── */}
        <section id="aria" className="max-w-6xl mx-auto px-6 mb-48">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-500/10 text-sky-500 mb-6">
                <BrainCircuit className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">System Intelligence</span>
              </div>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight text-slate-900 dark:text-white mb-6">
                Aria — Clinical Intelligence Layer
              </h2>
              <p className="text-base text-slate-500 dark:text-white/50 leading-relaxed mb-8 max-w-lg">
                A system-level assistant designed to interpret, navigate, and contextualize patient data in real time.
              </p>
              <button
                onClick={goToPlatform}
                className="flex items-center gap-2 text-slate-700 dark:text-white font-semibold hover:text-sky-500 transition-colors group"
              >
                Start Analysis <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <div className="rounded-[32px] bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 p-8 backdrop-blur-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-sky-500 to-transparent opacity-30" />
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-sky-500 fill-sky-500/30" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">Aria Engine</p>
                    <p className="text-[9px] font-bold text-sky-500 uppercase tracking-wider">Active Analysis</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  {[1,2,3].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-sky-500/30 animate-pulse" style={{ animationDelay: `${i*0.2}s` }} />)}
                </div>
              </div>

              <div className="space-y-6">
                <motion.div
                  key={currentState}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="flex items-center gap-2 text-sky-500 mb-2">
                    <Activity className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Processing</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{ARIA_STATES[currentState].label}</h3>
                  <p className="text-sm text-slate-500 dark:text-white/50">{ARIA_STATES[currentState].detail}</p>
                </motion.div>

                <div className="grid grid-cols-2 gap-4 pt-6 border-t border-slate-200 dark:border-white/10">
                  <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Confidence</p><p className="text-lg font-bold text-slate-900 dark:text-white mt-1">98.4%</p></div>
                  <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Latency</p><p className="text-lg font-bold text-slate-900 dark:text-white mt-1">12ms</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Metrics ─── */}
        <section id="system" className="max-w-6xl mx-auto px-6 mb-48">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: "Response Time", value: "<10ms", detail: "Real-time clinical inference" },
              { label: "Consistency", value: "99.9%", detail: "Diagnostic reliability score" },
              { label: "Uptime", value: "99.99%", detail: "Mission-critical availability" },
            ].map((m, i) => (
              <div key={i} className="rounded-[28px] bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 p-8 text-center hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-500 mb-3">{m.label}</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-white mb-2">{m.value}</p>
                <p className="text-xs text-slate-500 dark:text-white/40">{m.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Workflow ─── */}
        <section className="max-w-5xl mx-auto px-6 mb-48 text-center">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-16 tracking-tight">A seamless clinical workflow.</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: "01", icon: UploadCloud, title: "Capture", desc: "Upload or stream clinical imaging data." },
              { step: "02", icon: BrainCircuit, title: "Analyze", desc: "AI-assisted detection and correlation." },
              { step: "03", icon: ShieldCheck, title: "Review", desc: "Verified insights for clinical decisions." },
            ].map((item, i) => (
              <div key={i} className="rounded-[28px] bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 p-8 text-center hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors group">
                <div className="w-14 h-14 rounded-xl bg-sky-500/10 flex items-center justify-center mx-auto mb-5 text-sky-500 group-hover:scale-110 transition-transform">
                  <item.icon className="w-7 h-7" />
                </div>
                <p className="text-[10px] font-bold text-sky-500/60 uppercase tracking-wider mb-2">{item.step}</p>
                <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{item.title}</h4>
                <p className="text-sm text-slate-500 dark:text-white/50">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="max-w-6xl mx-auto px-6 mb-32">
          <div className="rounded-[40px] bg-gradient-to-b from-sky-500/5 to-transparent border border-slate-200 dark:border-white/10 p-16 md:p-24 text-center relative overflow-hidden">
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl" />
            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="text-3xl md:text-5xl font-bold text-slate-900 dark:text-white mb-8 tracking-tight leading-tight">
                Support earlier detection with intelligent clinical systems.
              </h2>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={goToPlatform}
                  className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-10 py-4 rounded-full font-bold text-lg hover:opacity-90 transition-all shadow-xl"
                >
                  Get Started
                </button>
                <button
                  onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 px-10 py-4 rounded-full font-bold text-lg hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                >
                  Request Demo
                </button>
              </div>
              <p className="mt-8 text-[11px] font-bold text-sky-500/60 uppercase tracking-wider">
                Enterprise-grade security • HIPAA Compliant
              </p>
            </div>
          </div>
        </section>

        {/* ─── Footer ─── */}
        <footer id="about" className="max-w-6xl mx-auto px-6 pb-16 flex flex-col md:flex-row justify-between items-center gap-6 border-t border-slate-200 dark:border-white/10 pt-10">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-sky-500" />
            <span className="font-bold text-sm text-slate-900 dark:text-white">OMNIA DIAGNOSIS</span>
          </div>
          <div className="flex gap-8">
            {['Privacy', 'Terms', 'Security', 'Contact'].map(link => (
              <a key={link} href="#" className="text-xs font-medium text-slate-400 dark:text-white/40 hover:text-sky-500 transition-colors">{link}</a>
            ))}
          </div>
          <p className="text-xs text-slate-400 dark:text-white/30">© 2024 Omnia Diagnosis. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}
