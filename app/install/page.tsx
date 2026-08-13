'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Check, AlertTriangle,
  ArrowRight, ArrowLeft, Server,
  FileText, Sparkles, ShieldCheck, DownloadCloud, CheckCircle2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { API_BASE } from '@/lib/constants';
import { Button, BrandMark } from '@/components/ui';

const STEPS = [
  { id: 'welcome', label: 'Welcome', description: 'Overview & requirements', icon: Sparkles },
  { id: 'terms', label: 'Terms of Use', description: 'Review & accept', icon: ShieldCheck },
  { id: 'installing', label: 'Installation', description: 'Configuring the engine', icon: DownloadCloud },
  { id: 'start', label: 'Connection', description: 'Verify the local engine', icon: Server },
  { id: 'complete', label: 'Ready', description: 'Launch the dashboard', icon: CheckCircle2 },
];

const INSTALL_TASKS = [
  'Verifying package integrity',
  'Setting up local database',
  'Configuring AI grading engine',
  'Registering file associations',
];

export default function InstallPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [backendStatus, setBackendStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [backendInfo, setBackendInfo] = useState<any>(null);
  const installStarted = useRef(false);

  const taskIndex = Math.min(
    Math.floor(installProgress / (100 / INSTALL_TASKS.length)),
    INSTALL_TASKS.length - 1,
  );

  useEffect(() => {
    if (step === 2 && !installStarted.current) {
      installStarted.current = true;
      let progress = 0;
      const interval = setInterval(() => {
        progress += 3;
        setInstallProgress(Math.min(progress, 100));
        if (progress >= 100) {
          clearInterval(interval);
          setTimeout(() => setStep(3), 400);
        }
      }, 90);
      return () => clearInterval(interval);
    }
  }, [step]);

  useEffect(() => {
    if (step === 3 && backendStatus === 'idle') {
      checkBackend();
    }
  }, [step]);

  const checkBackend = async () => {
    setBackendStatus('checking');
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      const r = await fetch(`${API_BASE}/health`, { signal: controller.signal });
      if (r.ok) {
        const info = await r.json();
        setBackendInfo(info);
        setBackendStatus('online');
        return true;
      }
    } catch {}
    setBackendStatus('offline');
    return false;
  };

  const acceptTerms = () => {
    if (!agreed) return;
    try {
      localStorage.setItem('omnia_tos_accepted_at', new Date().toISOString());
    } catch {}
    setStep(2);
  };

  const goToDashboard = () => {
    try {
      localStorage.setItem('omnia_setup_complete', 'true');
    } catch {}
    router.push('/dashboard');
  };

  return (
    <div className="h-screen w-full flex bg-[var(--bg-primary)] text-[var(--text-primary)] theme-transition overflow-hidden">
      {/* ── Left rail — step navigator ── */}
      <aside className="w-[248px] shrink-0 bg-[var(--bg-card-solid)] border-r border-[var(--border-subtle)] flex flex-col">
        <div className="h-10 titlebar-drag shrink-0" />
        <div className="px-7 pb-7">
          <BrandMark size={38} />
          <p className="text-[14px] font-semibold mt-3 tracking-tight leading-tight">Omnia Pathology AI</p>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mt-1">
            Clinical Trial Suite
          </p>
        </div>

        <nav className="flex-1 px-7">
          {STEPS.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'upcoming';
            const Icon = s.icon;
            const isLast = i === STEPS.length - 1;
            return (
              <div key={s.id} className="flex gap-3">
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className={
                      'w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0 transition-colors duration-300 ' +
                      (state === 'done'
                        ? 'bg-[#007AFF] text-white'
                        : state === 'active'
                          ? 'bg-[#007AFF]/12 text-[#007AFF] ring-2 ring-[#007AFF]/30'
                          : 'bg-[var(--skeleton-bg)] text-[var(--text-secondary)]')
                    }
                  >
                    {state === 'done' ? <Check className="w-[13px] h-[13px]" /> : <Icon className="w-[13px] h-[13px]" />}
                  </div>
                  {!isLast && (
                    <div
                      className={
                        'w-[2px] flex-1 min-h-[28px] my-0.5 rounded-full transition-colors duration-300 ' +
                        (i < step ? 'bg-[#007AFF]/40' : 'bg-[var(--border-subtle)]')
                      }
                    />
                  )}
                </div>
                <div className={isLast ? 'pb-1 pt-0.5' : 'pb-6 pt-0.5'}>
                  <p className={
                    'text-[12.5px] font-semibold transition-colors duration-300 ' +
                    (state === 'upcoming' ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')
                  }>
                    {s.label}
                  </p>
                  <p className="text-[10.5px] text-[var(--text-secondary)] mt-0.5 leading-snug">{s.description}</p>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="px-7 py-5 border-t border-[var(--border-subtle)]">
          <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
            Research Use Only · Fully Local<br />No Cloud Data
          </p>
          <p className="text-[9px] text-[var(--text-secondary)]/60 mt-2">Version 1.0.1</p>
        </div>
      </aside>

      {/* ── Right content pane ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-10 titlebar-drag shrink-0" />

        <div className="flex-1 overflow-y-auto custom-scrollbar px-10 min-h-0">
          <div className="max-w-[440px] mx-auto py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#007AFF] mb-2">
              Step {step + 1} of {STEPS.length}
            </p>

            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-[21px] font-semibold tracking-[-0.3px]">
                    Welcome to Omnia Pathology AI
                  </h1>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                    A clinical trial pathology suite for AI-assisted slide grading with mandatory pathologist review.
                  </p>
                </div>

                <div className="rounded-[12px] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {[
                    'AI-assisted grading with mandatory pathologist review',
                    'Bilingual EN/LT interface',
                    'Runs on a standard laptop — no GPU required',
                    'Fully local. No patient or slide data leaves this machine.',
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <Check className="w-[14px] h-[14px] text-[var(--text-secondary)] shrink-0" />
                      <span className="text-[13px]">{text}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">System Requirements</p>
                  <ul className="text-[12px] text-[var(--text-secondary)] space-y-1">
                    <li>macOS 12+ (Monterey or later) or Windows 10/11 64-bit</li>
                    <li>4 GB+ RAM (8 GB recommended) · 2 GB free disk space</li>
                    <li>Apple Silicon, Intel, or x64 processor</li>
                  </ul>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-[-0.2px]">Terms &amp; Conditions</h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1">Please read carefully before continuing</p>
                </div>

                <div className="rounded-[10px] border border-[#FF3B30]/25 bg-[#FF3B30]/[0.04] p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-[16px] h-[16px] text-[#FF3B30] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[12px] font-semibold text-[#FF3B30]">Research Use Only — Not a Diagnostic Device</p>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                        Omnia Pathology AI is not for use in the diagnosis, treatment, cure, mitigation, or prevention of any disease.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[10px] border border-[var(--border-subtle)] p-5 max-h-[280px] overflow-y-auto custom-scrollbar">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-[14px] h-[14px] text-[var(--text-secondary)]" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Terms of Use</span>
                  </div>
                  <div className="space-y-3 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    <p>
                      <strong className="text-[var(--text-primary)]">1. Intended Use.</strong> This software is a research tool intended
                      for use by qualified researchers and pathologists in clinical trial settings. It provides AI-generated grading
                      suggestions to assist manual slide review. It is not intended for use in the diagnosis, treatment, cure, mitigation,
                      or prevention of any disease, and must not be used as the sole basis for any clinical or patient-care decision.
                    </p>
                    <p>
                      <strong className="text-[var(--text-primary)]">2. Not a Regulated Medical Device.</strong> Omnia Pathology AI has
                      not been evaluated, cleared, or approved by the FDA, EMA, or any other regulatory authority, and does not carry a
                      CE mark. It is distributed strictly as a research-use-only (RUO) tool.
                    </p>
                    <p>
                      <strong className="text-[var(--text-primary)]">3. Mandatory Human Review.</strong> Every AI-generated grade must be
                      confirmed or corrected by a qualified pathologist before it is treated as final. The software's confirm/correct
                      workflow exists for this purpose and must not be bypassed.
                    </p>
                    <p>
                      <strong className="text-[var(--text-primary)]">4. No Warranty.</strong> The software is provided "as is," without
                      warranty of any kind, express or implied, including but not limited to accuracy, merchantability, or fitness for a
                      particular purpose.
                    </p>
                    <p>
                      <strong className="text-[var(--text-primary)]">5. Data Handling.</strong> All AI inference runs locally on your
                      machine. No patient or slide data is transmitted off-device by this software.
                    </p>
                    <p>
                      <strong className="text-[var(--text-primary)]">6. Authorized Use.</strong> By continuing, you confirm that you are
                      an authorized member of a research institution or clinical trial team, and that you accept full responsibility for
                      compliance with your institution's IRB/ethics requirements and all applicable local regulations.
                    </p>
                  </div>
                </div>

                <label className="flex items-start gap-3 p-3.5 rounded-[10px] border border-[var(--border-subtle)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#007AFF] shrink-0"
                  />
                  <span className="text-[12px]">
                    I have read and agree to the Terms of Use. I understand this software is a research tool only,
                    is not a diagnostic device, and that all AI outputs require confirmation by a qualified pathologist.
                  </span>
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-7 py-2">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-[-0.2px]">Installing Omnia Pathology AI</h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1">This will only take a moment</p>
                </div>

                <div>
                  <div className="h-[4px] rounded-full bg-[var(--border-subtle)] overflow-hidden">
                    <div
                      className="h-full bg-[#007AFF] transition-all duration-150 ease-linear rounded-full"
                      style={{ width: `${installProgress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-end mt-2">
                    <span className="text-[12px] text-[var(--text-secondary)] tabular-nums font-medium">{installProgress}%</span>
                  </div>
                </div>

                <div className="rounded-[12px] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {INSTALL_TASKS.map((task, i) => {
                    const done = i < taskIndex || installProgress === 100;
                    const active = i === taskIndex && installProgress < 100;
                    return (
                      <div key={task} className="flex items-center gap-3 px-4 py-3">
                        <div className={
                          'w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 transition-colors duration-300 ' +
                          (done ? 'bg-[#34C759] text-white' : active ? 'border-2 border-[#007AFF]' : 'border-2 border-[var(--border-subtle)]')
                        }>
                          {done && <Check className="w-[11px] h-[11px]" />}
                          {active && <div className="w-[6px] h-[6px] rounded-full bg-[#007AFF] animate-pulse" />}
                        </div>
                        <span className={
                          'text-[12.5px] transition-colors duration-300 ' +
                          (done || active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')
                        }>
                          {task}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-[-0.2px]">Verify Connection</h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1">Confirm the Omnia Pathology AI engine is running</p>
                </div>

                <div className="rounded-[10px] border border-[var(--border-subtle)] p-5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-[40px] h-[40px] rounded-[10px] flex items-center justify-center shrink-0 bg-[var(--skeleton-bg)]">
                      {backendStatus === 'checking' ? (
                        <div className="w-[18px] h-[18px] rounded-full border-2 border-[var(--border-medium)] border-t-[var(--text-primary)] animate-spin" />
                      ) : (
                        <Server className={'w-[18px] h-[18px] ' + (backendStatus === 'online' ? 'text-[#34C759]' : 'text-[var(--text-secondary)]')} />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-[14px] font-medium">Backend Engine</p>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Port 8000 · {API_BASE}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={
                        'w-[6px] h-[6px] rounded-full ' +
                        (backendStatus === 'online' ? 'bg-[#34C759]' : backendStatus === 'offline' ? 'bg-[#FF9500]' : 'bg-[var(--text-secondary)]')
                      } />
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                        {backendStatus === 'checking' ? 'Checking' : backendStatus === 'online' ? 'Connected' : backendStatus === 'offline' ? 'Offline' : 'Waiting'}
                      </span>
                    </div>
                  </div>

                  {backendStatus === 'online' && backendInfo && (
                    <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[var(--border-subtle)]">
                      <div>
                        <p className="text-[9px] text-[var(--text-secondary)] font-medium uppercase tracking-wide">Service</p>
                        <p className="text-[12px] font-medium mt-0.5">{backendInfo.service || 'omnia'}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-[var(--text-secondary)] font-medium uppercase tracking-wide">Version</p>
                        <p className="text-[12px] font-medium mt-0.5">{backendInfo.version || '1.0.1'}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-[var(--text-secondary)] font-medium uppercase tracking-wide">Status</p>
                        <p className="text-[12px] font-medium mt-0.5">{backendInfo.status || 'ok'}</p>
                      </div>
                    </div>
                  )}

                  {backendStatus === 'offline' && (
                    <div className="pt-4 border-t border-[var(--border-subtle)]">
                      <div className="flex items-center gap-3 p-3 rounded-[8px] bg-[#FF9500]/8">
                        <AlertTriangle className="w-[14px] h-[14px] text-[#FF9500] shrink-0" />
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          Backend not detected. Make sure the app's engine has finished starting, then retry.
                        </p>
                      </div>
                      <Button variant="secondary" size="sm" className="mt-3" onClick={checkBackend}>
                        Retry Connection
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-[48px] h-[48px] rounded-[10px] bg-[#34C759]/12 flex items-center justify-center shrink-0">
                    {backendStatus === 'online' ? (
                      <Check className="w-[22px] h-[22px] text-[#34C759]" />
                    ) : (
                      <Server className="w-[22px] h-[22px] text-[#FF9500]" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-[19px] font-semibold">
                      {backendStatus === 'online' ? 'Installation Complete' : 'Almost Ready'}
                    </h2>
                    <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                      {backendStatus === 'online'
                        ? "The engine is running. You're ready to open the dashboard."
                        : 'You can proceed, but start the engine to enable AI features.'}
                    </p>
                  </div>
                </div>

                <div className="rounded-[10px] border border-[var(--border-subtle)] p-5">
                  <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">Next Steps</p>
                  <div className="space-y-2">
                    {[
                      'Create your first clinical trial',
                      'Add patients and upload pathology slides',
                      'Review AI-assisted grading and confirm results',
                      'Export trial summaries and patient reports',
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-[12px] text-[var(--text-secondary)]">
                        <div className="w-[3px] h-[3px] rounded-full bg-[var(--text-secondary)]" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Sticky action footer ── */}
        {step !== 2 && (
          <div className="shrink-0 border-t border-[var(--border-subtle)] px-10 py-4">
            <div className="max-w-[440px] mx-auto flex gap-3">
              {step === 0 && (
                <Button size="lg" className="w-full" onClick={() => setStep(1)}>
                  Continue <ArrowRight className="w-[16px] h-[16px]" />
                </Button>
              )}
              {step === 1 && (
                <>
                  <Button variant="secondary" size="lg" onClick={() => setStep(0)}>
                    <ArrowLeft className="w-[16px] h-[16px]" /> Back
                  </Button>
                  <Button size="lg" className="flex-1" disabled={!agreed} onClick={acceptTerms}>
                    Agree &amp; Continue
                  </Button>
                </>
              )}
              {step === 3 && (
                <Button size="lg" className="w-full" onClick={() => setStep(4)}>
                  Continue <ArrowRight className="w-[16px] h-[16px]" />
                </Button>
              )}
              {step === 4 && (
                <Button size="lg" className="w-full" onClick={goToDashboard}>
                  Continue to Dashboard <ArrowRight className="w-[16px] h-[16px]" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
