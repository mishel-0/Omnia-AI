'use client';

import React, { useState, useEffect } from 'react';
import { ArrowRight, Sun, Moon, Wifi, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Card, StatTile, BrandMark } from '@/components/ui';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('omnia_theme', next); } catch {}
  };

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('omnia_theme') as 'dark' | 'light' | null;
    const initial = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);

    const setupDone = (() => {
      try { return localStorage.getItem('omnia_setup_complete') === 'true'; } catch { return false; }
    })();

    const checkBackend = async () => {
      try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
          setBackendStatus('online');
          setTimeout(async () => {
            if (!setupDone) {
              router.push('/install');
              return;
            }
            try {
              const licRes = await fetch(`${API_BASE}/api/license/status`);
              const lic = await licRes.json();
              if (lic.valid) {
                router.push('/dashboard');
              } else {
                router.push('/login');
              }
            } catch {
              router.push('/login');
            }
          }, 1200);
        } else {
          setBackendStatus('offline');
          setTimeout(() => router.push('/install'), 1200);
        }
      } catch {
        setBackendStatus('offline');
        setTimeout(() => router.push('/install'), 1200);
      }
    };

    checkBackend();
  }, [router]);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col justify-between theme-transition">
      {/* Top Header */}
      <header className="w-full max-w-[420px] mx-auto flex items-center justify-between px-5 pt-[52px]">
        <div className="flex items-center gap-2.5">
          <BrandMark size={34} />
          <span className="font-semibold text-[19px] tracking-[-0.3px]">Omnia Pathology AI</span>
        </div>
        <button onClick={toggleTheme}
          className="w-[34px] h-[34px] rounded-full bg-[var(--skeleton-bg)] flex items-center justify-center hover:scale-105 transition-all duration-200"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun className="w-[16px] h-[16px] text-[#FF9500]" /> : <Moon className="w-[16px] h-[16px] text-[var(--accent)]" />}
        </button>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-[420px] mx-auto flex flex-col items-center text-center px-5 my-auto py-10">
        <BrandMark size={64} className="mx-auto mb-6" />

        <h1 className="text-[24px] font-semibold tracking-[-0.4px] mb-1.5">
          Omnia Pathology AI
        </h1>
        <p className="text-[14px] font-medium text-[var(--text-secondary)] mb-8">
          Clinical Trial Pathology Suite
        </p>

        <Card size="lg" className="w-full p-6 mb-4 text-left">
          <div className="flex items-center gap-3 mb-5">
            {backendStatus === 'connecting' && (
              <div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin shrink-0" />
            )}
            {backendStatus === 'online' && <Wifi className="w-5 h-5 text-[#34C759] shrink-0" />}
            {backendStatus === 'offline' && <WifiOff className="w-5 h-5 text-[#FF3B30] shrink-0" />}
            <div>
              <p className="text-[15px] font-bold">
                {backendStatus === 'connecting' ? 'Connecting…' :
                 backendStatus === 'online' ? 'Connected' : 'Engine Offline'}
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {backendStatus === 'connecting' ? 'Reaching the diagnostics engine' :
                 backendStatus === 'online' ? 'Redirecting…' : "Engine unreachable — let's install it"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--border-subtle)]">
            <StatTile label="Version" value="1.0.1" />
            <StatTile
              label="Status"
              value={backendStatus === 'online' ? 'Online' : backendStatus === 'offline' ? 'Offline' : '—'}
              accent={backendStatus === 'online' ? 'green' : backendStatus === 'offline' ? 'red' : undefined}
            />
          </div>
        </Card>

        <button
          onClick={() => {
            const setupDone = (() => {
              try { return localStorage.getItem('omnia_setup_complete') === 'true'; } catch { return false; }
            })();
            router.push(backendStatus === 'offline' || !setupDone ? '/install' : '/dashboard');
          }}
          className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] font-semibold py-[16px] px-8 rounded-[14px] shadow-lg shadow-[var(--accent-soft)] active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 text-[17px] tracking-[-0.3px]"
        >
          {backendStatus === 'offline' ? 'Install Diagnostics Engine' : 'Continue'}
          <ArrowRight className="w-[20px] h-[20px]" />
        </button>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-[420px] mx-auto flex items-center justify-center text-[12px] font-medium text-[var(--text-secondary)] gap-4 px-5 pb-8 pt-4">
        <span>Omnia Pathology AI</span>
        <span className={cn('w-[3px] h-[3px] rounded-full bg-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)]')} />
        <span>v1.0.1</span>
        <span className="w-[3px] h-[3px] rounded-full bg-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)]" />
        <span>Research Use Only</span>
      </footer>
    </div>
  );
}
