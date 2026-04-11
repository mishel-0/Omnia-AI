'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { 
  Bell, 
  Search, 
  Sun, 
  Moon, 
  Settings2,
  Wifi
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopBarProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  role: string;
  userName?: string;
  authProvider?: string;
}

export function TopBar({ isDarkMode, toggleTheme, role, userName, authProvider }: TopBarProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-[72px] lg:h-32 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 lg:px-10 py-3 sm:py-0 z-30 relative gap-3 sm:gap-4 pl-16 lg:pl-10">
        {/* Greeting */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse flex-shrink-0" />
            <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.3em] sm:tracking-[0.4em] text-sky-500/60 truncate">Analytical Protocol Alpha</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl lg:text-2xl font-black tracking-tighter text-primary leading-tight truncate">
              Good Morning, <span className="opacity-40">Dr.</span> {userName || role}
            </h1>
            {authProvider && (
              <span className="text-[7px] sm:text-[8px] font-black bg-sky-500/10 text-sky-500 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full uppercase tracking-widest leading-none border border-sky-500/20 flex-shrink-0">
                {authProvider} Hub
              </span>
            )}
          </div>
        </div>

      <div className="flex items-center gap-3 sm:gap-4 lg:gap-6 flex-shrink-0 w-full sm:w-auto">
        {/* Search: Floating iOS Style */}
        <div className="relative flex-1 sm:flex-initial group">
          <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-white/30 group-focus-within:text-accent transition-all" />
          <input 
            type="text" 
            placeholder="Search patients, scans..." 
            className="w-full sm:w-48 lg:w-80 pl-10 sm:pl-12 pr-4 sm:pr-6 py-2.5 sm:py-3 glass-card-apple rounded-[16px] sm:rounded-[20px] text-xs font-bold placeholder:text-slate-400 dark:placeholder:text-white/20 outline-none focus:ring-2 focus:ring-sky-500/30 focus:bg-white/90 transition-all shadow-inner dark:shadow-none"
          />
        </div>

        {/* System Stats Capsule — hide on small screens */}
        <div className="hidden xl:flex items-center gap-4 lg:gap-6 px-4 lg:px-6 py-2.5 lg:py-3 rounded-[20px] lg:rounded-[24px] glass-card-apple shadow-sm">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-green-500" />
            <span className="text-[9px] lg:text-[10px] font-black text-slate-500 dark:text-text-secondary uppercase tracking-widest">PACS Online</span>
          </div>
          <div className="w-[1px] h-4 bg-black/5 dark:bg-white/10" />
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-accent animate-spin-slow" />
            <span className="text-[9px] lg:text-[10px] font-black text-slate-500 dark:text-text-secondary uppercase tracking-widest">ARIA Core</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(0,0,0,0.05)' }}
            whileTap={{ scale: 0.95 }}
            onClick={toggleTheme}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl glass-card-apple text-slate-500 dark:text-white/60 hover:text-sky-500 transition-all flex items-center justify-center shadow-sm"
          >
            {isDarkMode ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(0,0,0,0.05)' }}
            whileTap={{ scale: 0.95 }}
            className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl glass-card-apple border-black/5 dark:border-white/10 text-slate-500 dark:text-white/60 hover:text-accent transition-all bg-white/80 dark:bg-white/[0.03] backdrop-blur-3xl flex items-center justify-center shadow-sm"
          >
            <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="absolute top-2.5 sm:top-3 right-2.5 sm:right-3 w-2 h-2 bg-accent rounded-full border-2 border-slate-900" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
