'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BarChart3, 
  Box, 
  Files, 
  History, 
  LayoutDashboard, 
  MessageSquare, 
  Settings, 
  ShieldCheck, 
  Users,
  Activity,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface SidebarProps {
  role: string;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const SIDEBAR_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['radiologist', 'clinician', 'researcher', 'admin'] },
  { id: 'cases', label: 'Clinical Cases', icon: Box, roles: ['radiologist', 'clinician', 'researcher'] },
  { id: 'analytics', label: 'AI Analytics', icon: BarChart3, roles: ['radiologist', 'researcher', 'admin'] },
  { id: 'imaging', label: 'Imaging Archive', icon: Files, roles: ['radiologist', 'clinician'] },
  { id: 'labs', label: 'Lab Results', icon: Activity, roles: ['clinician', 'researcher'] },
  { id: 'history', label: 'Patient History', icon: History, roles: ['radiologist', 'clinician'] },
  { id: 'team', label: 'Care Team', icon: Users, roles: ['clinician', 'admin'] },
  { id: 'messages', label: 'Secure Comms', icon: MessageSquare, roles: ['radiologist', 'clinician', 'researcher'] },
  { id: 'security', label: 'Compliance', icon: ShieldCheck, roles: ['admin'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['radiologist', 'clinician', 'researcher', 'admin'] },
];

export function Sidebar({ role, activeTab, setActiveTab }: SidebarProps) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const filteredItems = SIDEBAR_ITEMS.filter(item => item.roles.includes(role));

  const handleLogout = () => {
    localStorage.removeItem('onboarding_complete');
    router.push('/');
  };

  const handleTabClick = (id: string) => {
    setActiveTab(id);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button 
        onClick={() => setMobileOpen(true)}
        className="fixed top-5 left-5 z-[60] lg:hidden w-11 h-11 rounded-2xl glass-card-apple flex items-center justify-center text-primary shadow-lg"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar — desktop: always visible; mobile: drawer */}
      <div className={cn(
        "h-screen py-3 pl-3 lg:py-5 lg:pl-5 z-[80] transition-transform duration-300",
        "fixed lg:relative",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-64 lg:w-24 lg:hover:w-64 h-full glass-card-apple rounded-[32px] lg:rounded-[38px] flex flex-col items-center pt-6 lg:pt-8 pb-4 lg:pb-6 transition-[width] duration-300 ease-[0.32,0.72,0,1] group overflow-hidden relative will-change-[width]"
        >
          {/* iOS Ambient Glow */}
          <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-sky-500/10 dark:from-sky-500/5 to-transparent pointer-events-none" />

          {/* Close button — mobile only */}
          <button 
            onClick={() => setMobileOpen(false)}
            className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-center lg:hidden z-20"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Brand/Logo */}
          <div className="flex items-center gap-4 mb-8 lg:mb-10 px-5 lg:px-6 w-full relative z-10 transition-transform group-hover:scale-105 duration-500">
            <div className="relative w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-accent/10">
              <Activity className="w-5 h-5 text-accent relative z-10" />
              <motion.div
                animate={{ scale: [1, 1.4, 1], opacity: [0.1, 0.2, 0.1] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="absolute inset-0 bg-accent rounded-xl blur-md"
              />
            </div>
            <span className="font-black text-xl tracking-tighter text-primary lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-500 whitespace-nowrap">
              OMNIA<span className="text-accent ml-0.5">AI</span>
            </span>
          </div>

          {/* Navigation - Scrollable Area */}
          <nav className="flex-1 w-full px-3 space-y-1 overflow-y-auto no-scrollbar relative z-10 custom-scrollbar-minimal">
            <div className="flex flex-col gap-1">
              <div className="px-5 mb-2 lg:opacity-0 lg:group-hover:opacity-40 transition-opacity duration-500">
                 <p className="text-[9px] font-black uppercase tracking-[0.3em] text-primary">Intelligence Hub</p>
              </div>
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  className={cn(
                    "w-full flex items-center h-12 rounded-[22px] transition-all duration-500 relative group/item overflow-hidden",
                    activeTab === item.id 
                      ? "bg-accent text-white shadow-lg shadow-accent/20" 
                      : "text-slate-500 dark:text-white/60 hover:text-primary dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                  )}
                >
                  <div className="w-16 flex-shrink-0 flex items-center justify-center">
                    <item.icon className={cn("w-5 h-5 transition-transform duration-500", activeTab === item.id ? "scale-110" : "group-hover/item:scale-110")} />
                  </div>
                  <span className={cn(
                    "text-[12px] font-black uppercase tracking-widest lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-500 whitespace-nowrap",
                    activeTab === item.id ? "translate-x-0" : "-translate-x-2 lg:-translate-x-2 lg:group-hover:translate-x-0"
                  )}>
                    {item.label}
                  </span>
                  
                  {activeTab === item.id && (
                    <motion.div 
                      layoutId="active-pill"
                      className="absolute inset-0 bg-white/10 pointer-events-none"
                    />
                  )}
                </button>
              ))}
            </div>
          </nav>

          {/* User Card - iOS Style */}
          <div className="mt-auto w-full px-3 pt-4 lg:pt-6 relative z-10 border-t border-black/5 dark:border-white/5">
            <div className="bg-black/5 dark:bg-white/5 rounded-[24px] lg:rounded-[32px] p-3 transition-all duration-500 group-hover:bg-black/10 dark:group-hover:bg-white/10 mb-2 lg:mb-4">
              <div className="flex items-center gap-3 w-full">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent to-blue-600 flex-shrink-0 flex items-center justify-center text-white font-black text-xs shadow-lg ring-2 ring-white/10 group-hover:scale-110 transition-transform">
                  {role[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 lg:opacity-0 lg:group-hover:opacity-100 transition-all duration-500 flex-1">
                  <p className="text-[11px] font-extrabold text-primary truncate capitalize tracking-tight leading-tight">{role}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                     <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                     <p className="text-[8px] text-green-500 font-bold uppercase tracking-widest">Secure Link</p>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={handleLogout}
                className="w-full mt-3 lg:mt-4 flex items-center h-10 rounded-[20px] bg-red-500/0 hover:bg-red-500/10 text-slate-400 dark:text-white/30 hover:text-red-500 transition-all duration-300 overflow-hidden"
              >
                <div className="w-10 flex-shrink-0 flex items-center justify-center">
                  <LogOut className="w-4 h-4 ml-1" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">Sign Out</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
