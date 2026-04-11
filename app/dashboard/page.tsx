'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { RadiologistView } from './components/RadiologistView';
import { Activity, BarChart3, FileCode, ArrowUpRight, ShieldCheck } from 'lucide-react';

import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';

export default function DashboardPage() {
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authProvider, setAuthProvider] = useState<string>('Email');
  const [clinicalCases, setClinicalCases] = useState<any[]>([]);
  const [specialists, setSpecialists] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        // No authenticated user — run in demo mode instead of redirecting
        console.log("No authenticated user. Running in demo mode.");
        setUserName('Specialist');
        setRole(localStorage.getItem('user_role') || 'radiologist');
        setAuthProvider('Demo');
        setMounted(true);
        setTimeout(() => setIsLoading(false), 1200);
        return;
      }

      const onboarded = localStorage.getItem('onboarding_complete');
      if (!onboarded) {
        router.push('/onboarding');
        return;
      }
      
      console.log("Auth state changed. User:", u?.email || "No user");
      setUser(u);
      
      // Identify provider
      if (u.providerData && u.providerData.length > 0) {
        const pId = u.providerData[0].providerId;
        if (pId === 'google.com') setAuthProvider('Google');
        else if (pId === 'apple.com') setAuthProvider('Apple');
        else setAuthProvider('Clinical Hub');
      }

      // Fetch profile from Firestore
      try {
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setRole(data.role || 'radiologist');
          setSpecialty(data.specialty);
          setUserName(data.displayName || u.displayName || u.email?.split('@')[0] || 'Doctor');
        } else {
          setUserName(u.displayName || u.email?.split('@')[0] || 'Doctor');
          setRole(localStorage.getItem('user_role') || 'radiologist');
        }
      } catch (err: any) {
        console.warn("Profile fetch issue (likely offline):", err.message);
        setUserName(u.displayName || u.email?.split('@')[0] || 'Doctor');
        setRole(localStorage.getItem('user_role') || 'radiologist');
      }
      
      setMounted(true);
      setTimeout(() => setIsLoading(false), 1000);
    });

    // Theme initialization
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    }

    // Safety timeout to force mount AND clear loading
    const timer = setTimeout(() => {
      setMounted(true);
      setIsLoading(false);
      console.log("Forced mounting dashboard for visibility.");
    }, 4000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [router]);

  // Global Clinical Data Sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setClinicalCases(data);
    }, (err) => console.error("Content stream error:", err));
    return () => unsubscribe();
  }, [user]);

  // Specialists Sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users'), limit(20));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSpecialists(data);
    }, (err) => console.error("Specialist stream error:", err));
    return () => unsubscribe();
  }, [user]);

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

  if (!mounted) return null;

  // Render role-specific content
  const renderDashboardContent = () => {
    // ─── Main Hub ───
    if (activeTab === 'dashboard') {
      return <RadiologistView isLoading={isLoading} />;
    }

    // ─── AI Analytics Feature ───
    if (activeTab === 'analytics') {
      return (
        <div className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-6 lg:gap-8 h-full overflow-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h2 className="text-2xl lg:text-3xl font-black tracking-tighter text-primary">Predictive Metrics</h2>
            <div className="px-4 py-1.5 rounded-2xl bg-sky-500/10 text-sky-500 text-[10px] font-black uppercase tracking-widest border border-sky-500/20">Live Stream</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="p-4 lg:p-6 rounded-[24px] lg:rounded-[32px] glass-card-apple border-white/10 dark:bg-white/5">
                <p className="text-[10px] font-black uppercase tracking-widest text-sky-500 mb-4">Neural Accuracy {i * 30}%</p>
                <div className="h-20 lg:h-24 flex items-end gap-1.5 opacity-60">
                  {Array.from({ length: 12 }).map((_, j) => (
                    <div key={j} className="flex-1 bg-sky-500/40 rounded-full" style={{ height: `${Math.random() * 100}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex-1 min-h-[200px] rounded-[32px] lg:rounded-[40px] glass-card-apple border-white/5 bg-accent/5 p-6 lg:p-10 flex flex-col items-center justify-center text-center opacity-40">
             <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-full border-2 border-dashed border-sky-500/20 flex items-center justify-center mb-4 lg:mb-6">
                <BarChart3 className="w-8 h-8 lg:w-10 lg:h-10 text-sky-500 animate-pulse" />
             </div>
             <p className="text-xs lg:text-sm font-bold max-w-sm">Generating real-time longitudinal predictive model for active cohorts...</p>
          </div>
        </div>
      );
    }

    // ─── Clinical Cases Feature ───
    if (activeTab === 'cases') {
      return (
        <div className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-4 lg:gap-6 h-full overflow-hidden">
           <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <h2 className="text-xl lg:text-2xl font-black tracking-tighter text-primary">Master Patient Roster</h2>
              <div className="flex gap-2 sm:gap-4 w-full sm:w-auto">
                 <input type="text" placeholder="Search ID, Name..." className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold outline-none focus:ring-2 focus:ring-sky-500/30" />
                 <button className="px-4 sm:px-6 py-2 rounded-xl bg-sky-500 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-sky-500/20 flex-shrink-0">Sync PACS</button>
              </div>
           </div>
           <div className="flex-1 overflow-hidden rounded-[24px] lg:rounded-[32px] glass-card-apple border-white/5 bg-black/20">
              <div className="h-full overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[600px]">
                   <thead className="bg-white/5 sticky top-0 z-10">
                      <tr>
                         <th className="px-4 lg:px-8 py-3 lg:py-5 text-[10px] font-black text-sky-500 uppercase tracking-widest">Case ID</th>
                         <th className="px-4 lg:px-8 py-3 lg:py-5 text-[10px] font-black text-sky-500 uppercase tracking-widest">Legal Name</th>
                         <th className="px-4 lg:px-8 py-3 lg:py-5 text-[10px] font-black text-sky-500 uppercase tracking-widest">Modality</th>
                         <th className="px-4 lg:px-8 py-3 lg:py-5 text-[10px] font-black text-sky-500 uppercase tracking-widest">Status</th>
                         <th className="px-4 lg:px-8 py-3 lg:py-5 text-[10px] font-black text-sky-500 uppercase tracking-widest">Timeline</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                      {clinicalCases.length > 0 ? clinicalCases.map((c, i) => (
                        <tr key={c.id || i} className="hover:bg-white/5 transition-all group cursor-pointer">
                           <td className="px-4 lg:px-8 py-3 lg:py-5 font-bold text-xs">{c.id?.slice(0, 6)}</td>
                           <td className="px-4 lg:px-8 py-3 lg:py-5 font-bold text-xs">{c.patientName || 'Untitled Case'}</td>
                           <td className="px-4 lg:px-8 py-3 lg:py-5 font-bold text-[10px] uppercase tracking-widest opacity-60">{c.modality || 'General'}</td>
                           <td className="px-4 lg:px-8 py-3 lg:py-5">
                              <span className={cn("px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border", 
                                c.status === 'Critical' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                c.status === 'Completed' ? "bg-green-500/10 text-green-500 border-green-500/20" :
                                "bg-sky-500/10 text-sky-500 border-sky-500/20"
                              )}>{c.status || 'Active'}</span>
                           </td>
                           <td className="px-4 lg:px-8 py-3 lg:py-5 text-xs font-bold opacity-20">
                             {c.createdAt ? new Date(c.createdAt.seconds * 1000).toLocaleDateString() : 'New'}
                           </td>
                        </tr>
                      )) : (
                        <tr>
                           <td colSpan={5} className="px-4 lg:px-8 py-16 lg:py-20 text-center opacity-20 text-xs font-black uppercase tracking-[0.4em]">Establishing Neural Link...</td>
                        </tr>
                      )}
                   </tbody>
                </table>
              </div>
           </div>
        </div>
      );
    }
    // ─── Care Team Feature ───
    if (activeTab === 'team') {
      return (
        <div className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-4 lg:gap-6 overflow-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
             <h2 className="text-xl lg:text-2xl font-black tracking-tighter text-primary">On-Call Specialists</h2>
             <button className="px-5 py-2 rounded-full bg-sky-500 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-sky-500/20 active:scale-95 transition-all">Invite Expert</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
            {specialists.length > 0 ? specialists.map((spec, i) => (
              <div key={spec.id || i} className="p-4 lg:p-5 rounded-[24px] lg:rounded-[28px] glass-card-apple bg-white/40 dark:bg-white/5 border-white/10 group hover:-translate-y-1 transition-all">
                <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl lg:rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 mb-3 lg:mb-4 shadow-lg group-hover:scale-110 transition-transform flex items-center justify-center text-white font-black text-lg lg:text-xl">
                   {spec.displayName?.[0] || spec.email?.[0] || 'D'}
                </div>
                <h3 className="text-[13px] lg:text-[14px] font-black text-primary mb-1">{spec.displayName || 'Clinical Expert'}</h3>
                <p className="text-[9px] text-sky-500 font-bold uppercase tracking-widest mb-3 lg:mb-4">{spec.role || 'Specialist'}</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[9px] font-black text-slate-400 uppercase">Live Connection</span>
                </div>
              </div>
            )) : (
              <div className="col-span-full py-16 lg:py-20 text-center opacity-20 text-xs font-black uppercase tracking-widest">Awaiting Care Team Synchronization...</div>
            )}
          </div>
        </div>
      );
    }

    // ─── Imaging Archive Feature ───
    if (activeTab === 'imaging') {
      return (
        <div className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-4 lg:gap-6 overflow-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h2 className="text-xl lg:text-2xl font-black tracking-tighter text-primary">DICOM Repository</h2>
            <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-widest">Filter by Modality</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 lg:gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-[24px] lg:rounded-[32px] glass-card-apple border-white/5 bg-black/40 flex flex-col items-center justify-center group cursor-pointer hover:border-sky-500/50 transition-all relative">
                <div className="w-full h-full bg-gradient-to-br from-white/5 to-transparent flex items-center justify-center">
                  <FileCode className="w-6 h-6 lg:w-8 lg:h-8 text-white/10 group-hover:text-sky-500 transition-colors" />
                </div>
                <div className="absolute bottom-3 lg:bottom-4 left-3 lg:left-4 right-3 lg:right-4 text-center">
                   <p className="text-[8px] lg:text-[9px] font-black text-white/40 uppercase tracking-tighter">Series #000{i+1}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ─── Lab Results Feature ───
    if (activeTab === 'labs') {
      return (
        <div className="flex-1 p-8 flex flex-col gap-6">
          <h2 className="text-2xl font-black tracking-tighter text-primary">Laboratory Diagnostics</h2>
          <div className="space-y-3">
             {['Hematology Panel', 'Metabolic Series', 'Cardiac Biomarkers', 'Lipid Profile'].map((lab, i) => (
               <div key={lab} className="p-6 rounded-[28px] glass-card-apple border-white/5 flex items-center justify-between hover:bg-white/5 transition-all">
                 <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-sky-500/10 flex items-center justify-center text-sky-500"><Activity className="w-5 h-5" /></div>
                    <div>
                      <p className="text-sm font-black text-primary">{lab}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Awaiting Physician Review</p>
                    </div>
                 </div>
                 <div className="text-right">
                    <p className="text-xs font-black text-white/20">24 JAN 2026</p>
                    <ArrowUpRight className="w-4 h-4 text-sky-500 inline-block mt-1" />
                 </div>
               </div>
             ))}
          </div>
        </div>
      );
    }

    // ─── Patient History Feature ───
    if (activeTab === 'history') {
      return (
        <div className="flex-1 p-8 flex flex-col gap-6 max-w-4xl mx-auto w-full">
           <h2 className="text-2xl font-black tracking-tighter text-primary">Longitudinal Record</h2>
           <div className="relative pl-8 space-y-12 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-white/10">
              {[1, 2, 3].map(i => (
                <div key={i} className="relative">
                  <div className="absolute -left-[36px] top-1 w-4 h-4 rounded-full bg-sky-500 shadow-lg shadow-sky-500/40 border-4 border-slate-900" />
                  <div className="p-6 rounded-[32px] glass-card-apple border-white/5">
                     <p className="text-[10px] font-black text-sky-500 uppercase tracking-[0.2em] mb-2 text-right">0{i} MAR 2026</p>
                     <h3 className="text-lg font-black text-primary mb-2">Diagnostic Scan Initialized</h3>
                     <p className="text-sm text-slate-400 leading-relaxed font-medium">Successful stratification of neurological anomalies. Verified by Aria Alpha protocol at 14:00 GMT.</p>
                  </div>
                </div>
              ))}
           </div>
        </div>
      );
    }

    // ─── Secure Communications Feature ───
    if (activeTab === 'messages') {
      return (
        <div className="flex-1 flex flex-col md:flex-row gap-px bg-white/5 h-full overflow-hidden">
           <div className="w-full md:w-64 lg:w-80 glass-panel border-white/5 p-4 lg:p-6 flex md:flex-col gap-2 md:gap-0 md:space-y-4 overflow-x-auto md:overflow-x-visible no-scrollbar flex-shrink-0">
              <h2 className="hidden md:block text-lg lg:text-xl font-black tracking-tighter text-primary mb-4 lg:mb-6">Encrypted Comms</h2>
              {['Case Group #402', 'Radiology Review', 'Direct: Dr. Vance'].map((t, i) => (
                <div key={i} className={cn("p-3 lg:p-4 rounded-xl lg:rounded-2xl border border-white/5 transition-all text-xs lg:text-sm font-bold whitespace-nowrap md:whitespace-normal flex-shrink-0", i === 0 ? "bg-sky-500 text-white shadow-lg shadow-sky-500/20" : "text-slate-400 hover:bg-white/5")}>
                   {t}
                </div>
              ))}
           </div>
           <div className="flex-1 glass-panel border-white/5 flex flex-col p-4 sm:p-6 lg:p-10 justify-end min-h-0">
              <div className="space-y-4 lg:space-y-6 mb-4 lg:mb-10 overflow-y-auto pr-2 lg:pr-4 no-scrollbar flex-1">
                 <div className="max-w-[85%] sm:max-w-md p-4 lg:p-5 rounded-[20px] lg:rounded-[28px] rounded-bl-sm bg-white/5 border border-white/10 text-xs lg:text-sm font-medium leading-relaxed">System initializing secure channel for DICOM transmission. Protocols verified.</div>
                 <div className="max-w-[85%] sm:max-w-md p-4 lg:p-5 rounded-[20px] lg:rounded-[28px] rounded-br-sm bg-sky-500 self-end ml-auto text-white text-xs lg:text-sm font-bold shadow-xl shadow-sky-500/20">Awaiting specialist response for Case #402.</div>
              </div>
              <div className="flex gap-2 lg:gap-4 flex-shrink-0">
                 <input type="text" placeholder="Type a secure message..." className="flex-1 min-w-0 bg-white/5 border border-white/5 rounded-xl lg:rounded-2xl px-4 lg:px-6 py-3 lg:py-4 outline-none focus:ring-2 focus:ring-sky-500/30 text-xs lg:text-sm font-bold" />
                 <button className="px-4 sm:px-6 lg:px-8 py-3 lg:py-4 bg-sky-500 text-white rounded-xl lg:rounded-2xl text-[10px] lg:text-xs font-black uppercase tracking-widest shadow-lg shadow-sky-500/20 active:scale-95 transition-all flex-shrink-0">Send</button>
              </div>
           </div>
        </div>
      );
    }

    // ─── Settings Feature ───
    if (activeTab === 'settings') {
      return (
        <div className="flex-1 p-4 sm:p-6 lg:p-12 max-w-2xl mx-auto w-full space-y-6 lg:space-y-10 overflow-auto">
           <div>
              <h2 className="text-2xl lg:text-3xl font-black tracking-tighter text-primary mb-2">System Controls</h2>
              <p className="text-xs lg:text-sm text-slate-500 font-bold uppercase tracking-widest">Protocol Version Alpha 3.2</p>
           </div>
           <div className="space-y-3 lg:space-y-4">
              <div className="p-4 lg:p-6 rounded-[24px] lg:rounded-[32px] glass-card-apple border-white/5 flex items-center justify-between gap-4">
                 <div className="min-w-0">
                    <h3 className="text-sm font-black text-primary">Diagnostic Dark Mode</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Optimized for radiological clarity</p>
                 </div>
                 <button onClick={toggleTheme} className={cn("w-14 h-8 rounded-full transition-all flex items-center px-1 flex-shrink-0", isDarkMode ? "bg-sky-500" : "bg-slate-300 dark:bg-white/10")}>
                    <div className={cn("w-6 h-6 rounded-full bg-white shadow-md transition-transform", isDarkMode ? "translate-x-6" : "translate-x-0")} />
                 </button>
              </div>
              <div className="p-4 lg:p-6 rounded-[24px] lg:rounded-[32px] glass-card-apple border-white/5 flex items-center justify-between gap-4 opacity-40">
                 <div className="min-w-0">
                    <h3 className="text-sm font-black text-primary">Biometric Link</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter mb-1">Fingerprint Auth Required</p>
                 </div>
                 <ShieldCheck className="w-6 h-6 flex-shrink-0" />
              </div>
           </div>
        </div>
      );
    }

    // ─── Compliance & Security Feature ───
    if (activeTab === 'security') {
      return (
        <div className="flex-1 p-8 flex flex-col gap-6">
           <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black tracking-tighter text-primary">Protocol Governance</h2>
              <div className="flex items-center gap-2 text-green-500 font-bold text-[10px] uppercase tracking-widest">
                 <ShieldCheck className="w-4 h-4" /> HIPAA Verified
              </div>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2].map(i => (
                <div key={i} className="p-8 rounded-[40px] glass-card-apple border-white/5 bg-accent/5">
                   <h3 className="text-sm font-black text-primary mb-4">Encryption Cycle #{i*102}</h3>
                   <div className="space-y-4">
                      {Array.from({ length: 3 }).map((_, j) => (
                        <div key={j} className="flex items-center justify-between py-2 border-b border-white/5">
                           <span className="text-[10px] text-slate-400 font-bold uppercase">Data Access Node {j}</span>
                           <span className="text-[10px] text-sky-500 font-black">ACTIVE</span>
                        </div>
                      ))}
                   </div>
                </div>
              ))}
           </div>
        </div>
      );
    }

    // ─── Generic Fallback ───
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-20 text-center">
        <div className="w-24 h-24 rounded-[32px] bg-sky-500/10 flex items-center justify-center text-sky-500 mb-8 shadow-inner border border-sky-500/10 transition-transform hover:scale-110">
           <Activity className="w-10 h-10" />
        </div>
        <h2 className="text-3xl font-black tracking-tighter text-primary mb-4 capitalize">{activeTab.replace('-', ' ')}</h2>
        <p className="text-text-secondary max-w-md font-bold text-sm leading-relaxed uppercase tracking-tight opacity-40"> 
          Establishing neural link to clinical data stream... <br /> 
          Verified protocols will synchronize shortly.
        </p>
      </div>
    );
  };

  return (
    <div className={cn("flex h-screen overflow-hidden transition-colors duration-500 bg-background text-primary")}>
      
      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center"
          >
            <div className="relative mb-8">
               <Activity className="w-12 h-12 text-accent animate-logo-pulse" />
               <motion.div
                 animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.3, 0.1] }}
                 transition={{ duration: 2, repeat: Infinity }}
                 className="absolute inset-0 bg-accent rounded-full blur-xl"
               />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-accent animate-pulse">Initializing Aria Environment...</p>
            
            {/* Fail-safe entry button */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 5 }}
              onClick={() => setIsLoading(false)}
              className="mt-8 text-[10px] font-black text-white/20 uppercase tracking-widest hover:text-accent transition-colors underline underline-offset-4"
            >
              Skip Initialization
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <Sidebar role={role || 'radiologist'} activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Container */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
        
        {/* Optimized iOS 22 Mesh Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40 dark:opacity-25 transition-opacity duration-1000">
          <div className="absolute top-[-10%] left-[-5%] w-[60%] h-[60%] bg-sky-500/10 rounded-full blur-[100px] animate-pulse-soft" />
          <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[50%] bg-blue-500/5 rounded-full blur-[80px]" />
        </div>

        <TopBar isDarkMode={isDarkMode} toggleTheme={toggleTheme} role={role || 'radiologist'} userName={userName} authProvider={authProvider} />
        
        <div className="flex-1 overflow-hidden relative pt-6">
          <AnimatePresence mode="wait">
            {!isLoading && (
              <motion.div
                key={`${role}-${activeTab}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="h-full overflow-y-auto custom-scrollbar"
              >
                {renderDashboardContent()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
