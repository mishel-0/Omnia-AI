'use client';

import React from 'react';
import { Bell, Sun, Moon } from 'lucide-react';

interface TopBarProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  userName?: string;
}

export function TopBar({ isDarkMode, toggleTheme, userName }: TopBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
      <div>
        <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-sky-400/60">Aria Neural Engine • Active</span>
        <h1 className="text-lg font-bold text-white mt-0.5">
          Welcome, <span className="text-white/50">{userName || 'Specialist'}</span>
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-sky-400 transition-colors"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button className="relative w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-sky-400 transition-colors">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-sky-400" />
        </button>
      </div>
    </div>
  );
}
