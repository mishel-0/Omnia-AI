'use client';

import React from 'react';
import { Activity, LayoutDashboard, Clock, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <div className="h-screen py-3 pl-3 flex-shrink-0">
      <div className="w-56 h-full bg-white/[0.03] border border-white/[0.06] rounded-[28px] flex flex-col py-5 px-3 backdrop-blur-xl">
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white">
            OMNIA<span className="text-sky-400">AI</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1">
          <p className="px-3 mb-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/30">Clinical Hub</p>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-[14px] text-xs font-semibold transition-all duration-200",
                activeTab === tab.id
                  ? "bg-sky-500/15 text-sky-400"
                  : "text-white/50 hover:text-white/80 hover:bg-white/5"
              )}
            >
              <tab.icon className="w-4 h-4 flex-shrink-0" />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Logout */}
        <button
          onClick={() => {
            localStorage.clear();
            window.location.href = '/';
          }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-[14px] text-xs font-semibold text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all mt-auto"
        >
          <LogOut className="w-4 h-4" />
          <span>Exit</span>
        </button>
      </div>
    </div>
  );
}
