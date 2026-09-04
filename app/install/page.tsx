'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Check, AlertTriangle, ArrowRight, ArrowLeft, Server, KeyRound,
  Sparkles, ShieldCheck, CheckCircle2, UserPlus, Loader2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiBase } from '@/lib/constants';
import { Button, BrandMark } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Setup runs as one linear sequence, the way a desktop installer does.
 *
 * It used to stop after a "Ready" screen and then hand the user to a
 * separate login page that asked for a licence key and an administrator
 * account — so the wizard announced the product was ready before it was
 * licensed or had a single user. Licence activation and account creation
 * are part of installation, so they belong in these steps. */
const STEPS = [
  { id: 'welcome', label: 'Welcome', description: 'Overview & requirements', icon: Sparkles },
  { id: 'terms', label: 'Licence Terms', description: 'Review & accept', icon: ShieldCheck },
  { id: 'license', label: 'Product Licence', description: 'Enter your licence key', icon: KeyRound },
  { id: 'checks', label: 'System Check', description: 'Verify this machine', icon: Server },
  { id: 'account', label: 'Administrator', description: 'Create the first account', icon: UserPlus },
  { id: 'complete', label: 'Finish', description: 'Launch the suite', icon: CheckCircle2 },
];

interface PreflightCheck { key: string; label: string; ok: boolean; detail: string; fatal: boolean; }
interface Preflight { version: string; checks: PreflightCheck[]; ready: boolean; blocking_failures: string[]; }

export default function InstallPage() {
  const router = useRouter();
  const { bootstrap } = useAuth();

  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);

  // Licence
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseState, setLicenseState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [licenseMessage, setLicenseMessage] = useState('');
  const [licenseOrg, setLicenseOrg] = useState<{ organization: string; expires: string } | null>(null);

  // System checks
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const checksStarted = useRef(false);

  // Administrator account
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [accountError, setAccountError] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountDone, setAccountDone] = useState(false);
  const [bootstrapNeeded, setBootstrapNeeded] = useState<boolean | null>(null);

  // An already-licensed machine should not be asked for a key again.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase()}/api/license/status`);
        if (r.ok) {
          const d = await r.json();
          if (d.valid) {
            setLicenseState('valid');
            setLicenseOrg({ organization: d.organization, expires: d.expires });
          }
        }
      } catch { /* surfaced on the checks step */ }
      try {
        const r = await fetch(`${apiBase()}/api/users/bootstrap-needed`);
        if (r.ok) setBootstrapNeeded((await r.json()).needed);
      } catch { setBootstrapNeeded(null); }
    })();
  }, []);

  const runChecks = useCallback(async () => {
    setPreflight(null);
    try {
      const r = await fetch(`${apiBase()}/api/system/preflight`);
      if (r.ok) { setPreflight(await r.json()); return; }
    } catch { /* fall through to the unreachable case */ }
    setPreflight({
      version: '', ready: false,
      blocking_failures: ['Local engine not reachable'],
      checks: [{ key: 'backend', label: 'Local engine reachable', ok: false,
                 detail: 'Could not contact the engine on this machine', fatal: true }],
    });
  }, []);

  useEffect(() => {
    if (step === 3 && !checksStarted.current) {
      checksStarted.current = true;
      runChecks();
    }
  }, [step, runChecks]);

  const activateLicense = async () => {
    const key = licenseKey.trim();
    if (!key) return;
    setLicenseState('checking');
    setLicenseMessage('');
    try {
      const r = await fetch(`${apiBase()}/api/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const d = await r.json();
      if (r.ok && d.valid) {
        setLicenseState('valid');
        setLicenseOrg({ organization: d.organization, expires: d.expires });
      } else {
        setLicenseState('invalid');
        setLicenseMessage(d.message || 'This licence key was not accepted.');
      }
    } catch {
      setLicenseState('invalid');
      setLicenseMessage('Could not reach the local engine to verify this key.');
    }
  };

  const createAccount = async () => {
    setAccountError('');
    if (!fullName.trim()) { setAccountError('Enter the account holder’s full name.'); return; }
    if (!username.trim()) { setAccountError('Choose a username.'); return; }
    if (password.length < 10) { setAccountError('Use a password of at least 10 characters.'); return; }
    if (password !== confirmPw) { setAccountError('The two passwords do not match.'); return; }
    setAccountBusy(true);
    const res = await bootstrap(username.trim(), password, fullName.trim());
    setAccountBusy(false);
    if (res.ok) { setAccountDone(true); setStep(5); }
    else setAccountError(res.message || 'Could not create the account.');
  };

  const finish = () => {
    try { localStorage.setItem('omnia_setup_complete', 'true'); } catch { /* private mode */ }
    router.push(accountDone || bootstrapNeeded === false ? '/dashboard' : '/login');
  };

  const acceptTerms = () => {
    if (!agreed) return;
    try { localStorage.setItem('omnia_tos_accepted_at', new Date().toISOString()); } catch { /* private mode */ }
    setStep(2);
  };

  // Each step states whether it may be left, so the footer button is disabled
  // for one concrete reason rather than by conditionals scattered through JSX.
  const canAdvance = (() => {
    switch (step) {
      case 0: return true;
      case 1: return agreed;
      case 2: return licenseState === 'valid';
      case 3: return preflight !== null;
      default: return true;
    }
  })();

  return (
    <div className="h-screen w-full flex bg-[var(--bg-primary)] text-[var(--text-primary)] theme-transition overflow-hidden">
      {/* ── Step rail ── */}
      <aside className="w-[262px] shrink-0 bg-[var(--bg-card-solid)] border-r border-[var(--border-subtle)] flex flex-col">
        <div className="h-10 titlebar-drag shrink-0" />
        <div className="px-7 pb-6">
          <BrandMark size={36} />
          <p className="text-[14px] font-semibold mt-3 tracking-tight leading-tight">Omnia Pathology AI</p>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mt-1">Setup</p>
        </div>

        <nav className="flex-1 px-7 overflow-y-auto">
          {STEPS.map((s, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'upcoming';
            const Icon = s.icon;
            const isLast = i === STEPS.length - 1;
            return (
              <div key={s.id} className="flex gap-3">
                <div className="flex flex-col items-center shrink-0">
                  <div className={
                    'w-[24px] h-[24px] rounded-full flex items-center justify-center shrink-0 transition-colors duration-300 ' +
                    (state === 'done' ? 'bg-[var(--accent)] text-white'
                      : state === 'active' ? 'bg-[var(--accent-soft)] text-[var(--accent)] ring-2 ring-[var(--accent-border)]'
                      : 'bg-[var(--skeleton-bg)] text-[var(--text-secondary)]')
                  }>
                    {state === 'done' ? <Check className="w-[12px] h-[12px]" /> : <Icon className="w-[12px] h-[12px]" />}
                  </div>
                  {!isLast && (
                    <div className={
                      'w-[2px] flex-1 min-h-[22px] my-0.5 rounded-full transition-colors duration-300 ' +
                      (i < step ? 'bg-[var(--accent-soft)]' : 'bg-[var(--border-subtle)]')
                    } />
                  )}
                </div>
                <div className={isLast ? 'pb-1' : 'pb-5'}>
                  <p className={
                    'text-[12.5px] font-semibold leading-tight transition-colors duration-300 ' +
                    (state === 'upcoming' ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')
                  }>{s.label}</p>
                  <p className="text-[10.5px] text-[var(--text-secondary)] mt-0.5 leading-snug">{s.description}</p>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="px-7 py-4 border-t border-[var(--border-subtle)] shrink-0">
          <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
            Research Use Only<br />Runs entirely on this machine
          </p>
          {preflight?.version && (
            <p className="text-[9px] text-[var(--text-secondary)]/60 mt-1.5">Version {preflight.version}</p>
          )}
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-10 titlebar-drag shrink-0" />

        <div className="flex-1 overflow-y-auto custom-scrollbar px-10 min-h-0 flex flex-col">
          <div className="w-full max-w-[460px] mx-auto my-auto py-8">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] mb-2">
              Step {step + 1} of {STEPS.length}
            </p>

            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-[21px] font-semibold tracking-[-0.3px]">Welcome to Omnia Pathology AI</h1>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                    A clinical trial pathology suite for AI-assisted slide grading with mandatory
                    pathologist review. Setup takes about a minute.
                  </p>
                </div>
                <div className="rounded-[12px] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {[
                    'AI-assisted Gleason grading with mandatory pathologist sign-off',
                    'Attention overlay showing which regions drove each grade',
                    'Runs on a standard laptop — no GPU required',
                    'Fully local. No patient or slide data leaves this machine.',
                  ].map((text) => (
                    <div key={text} className="flex items-start gap-3 px-4 py-3">
                      <Check className="w-[14px] h-[14px] text-[#34C759] shrink-0 mt-[2px]" />
                      <span className="text-[12.5px] leading-snug">{text}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
                    System Requirements
                  </p>
                  <ul className="text-[12px] text-[var(--text-secondary)] space-y-1">
                    <li>macOS 12+ (Monterey or later), Apple Silicon or Intel</li>
                    <li>8 GB RAM recommended · ~1 GB for the application</li>
                    <li>Additional space for slides — whole-slide images are 50 MB&ndash;2 GB each</li>
                  </ul>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-[-0.2px]">Licence Terms</h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1">Please read carefully before continuing</p>
                </div>
                <div className="rounded-[10px] border border-[#FF3B30]/30 bg-[#FF3B30]/8 px-4 py-3 flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[#FF3B30] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12.5px] font-semibold text-[#FF3B30]">Research Use Only — Not a Diagnostic Device</p>
                    <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                      Not for use in the diagnosis, treatment, cure, mitigation, or prevention of any disease.
                    </p>
                  </div>
                </div>
                <div className="rounded-[12px] border border-[var(--border-subtle)] p-4 max-h-[240px] overflow-y-auto custom-scrollbar space-y-3 text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                  <p><strong className="text-[var(--text-primary)]">1. Intended Use.</strong> A research tool for qualified
                  researchers and pathologists in clinical trial settings. It provides AI-generated grading suggestions to
                  assist manual review and must not be the sole basis for any clinical or patient-care decision.</p>
                  <p><strong className="text-[var(--text-primary)]">2. Not a Regulated Medical Device.</strong> Not evaluated,
                  cleared, or approved by the FDA, EMA, or any other authority, and it carries no CE mark.</p>
                  <p><strong className="text-[var(--text-primary)]">3. Mandatory Human Review.</strong> Every AI-generated
                  grade must be confirmed or corrected by a qualified pathologist before it is treated as final.</p>
                  <p><strong className="text-[var(--text-primary)]">4. No Warranty.</strong> Provided &ldquo;as is&rdquo;,
                  without warranty of any kind, express or implied.</p>
                  <p><strong className="text-[var(--text-primary)]">5. Data Handling.</strong> All inference runs locally.
                  No patient or slide data is transmitted off-device by this software.</p>
                  <p><strong className="text-[var(--text-primary)]">6. Authorised Use.</strong> By continuing you confirm you
                  are an authorised member of a research institution or clinical trial team and accept responsibility for
                  compliance with your institution&rsquo;s IRB/ethics requirements.</p>
                </div>
                <label className="flex items-start gap-3 p-3.5 rounded-[10px] border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--skeleton-bg)] transition-colors">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                         className="mt-0.5 w-4 h-4 accent-[var(--accent)] shrink-0" />
                  <span className="text-[12px] leading-relaxed">
                    I have read and agree to the Licence Terms. I understand this software is a research tool only, is not a
                    diagnostic device, and that all AI output requires confirmation by a qualified pathologist.
                  </span>
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-[-0.2px]">Product Licence</h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                    Enter the licence key issued to your organisation.
                  </p>
                </div>

                {licenseState === 'valid' && licenseOrg ? (
                  <div className="rounded-[12px] border border-[#34C759]/30 bg-[#34C759]/8 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-4 h-4 text-[#34C759]" />
                      <p className="text-[13px] font-semibold text-[#34C759]">Licence active</p>
                    </div>
                    <Field label="Licensed to" value={licenseOrg.organization} />
                    <Field label="Expires" value={licenseOrg.expires} />
                  </div>
                ) : (
                  <>
                    <div>
                      <label htmlFor="licence" className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                        Licence key
                      </label>
                      <input
                        id="licence"
                        value={licenseKey}
                        onChange={(e) => { setLicenseKey(e.target.value); if (licenseState === 'invalid') setLicenseState('idle'); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') activateLicense(); }}
                        placeholder="Organisation|YYYY-MM-DD|signature"
                        spellCheck={false}
                        autoComplete="off"
                        className={
                          'w-full mt-1.5 px-3.5 py-2.5 rounded-[10px] border bg-[var(--bg-primary)] font-mono text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-border)] ' +
                          (licenseState === 'invalid' ? 'border-[#FF3B30]' : 'border-[var(--border-medium)]')
                        }
                      />
                      {licenseState === 'invalid' && (
                        <p className="text-[11.5px] text-[#FF3B30] mt-1.5">{licenseMessage}</p>
                      )}
                    </div>
                    <Button size="lg" className="w-full" onClick={activateLicense}
                            disabled={!licenseKey.trim() || licenseState === 'checking'}>
                      {licenseState === 'checking'
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                        : 'Activate Licence'}
                    </Button>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      The key is verified on this machine. Nothing is sent to a licence server — the
                      application makes no outbound network requests.
                    </p>
                  </>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-[-0.2px]">System Check</h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                    Verifying that everything needed to read and grade slides is present.
                  </p>
                </div>

                {preflight === null ? (
                  <div className="flex items-center gap-2.5 py-3">
                    <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
                    <span className="text-[12.5px] text-[var(--text-secondary)]">Running checks…</span>
                  </div>
                ) : (
                  <>
                    <div className="rounded-[12px] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                      {preflight.checks.map((c) => (
                        <div key={c.key} className="flex items-start gap-3 px-4 py-2.5">
                          <div className={
                            'w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 mt-[1px] ' +
                            (c.ok ? 'bg-[#34C759] text-white' : c.fatal ? 'bg-[#FF3B30] text-white' : 'bg-[#FF9500] text-white')
                          }>
                            {c.ok ? <Check className="w-[11px] h-[11px]" /> : <AlertTriangle className="w-[10px] h-[10px]" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] leading-tight">{c.label}</p>
                            <p className="text-[11px] text-[var(--text-secondary)] leading-snug break-words mt-0.5">{c.detail}</p>
                          </div>
                          {!c.ok && !c.fatal && <span className="text-[10px] text-[#FF9500] shrink-0">optional</span>}
                        </div>
                      ))}
                    </div>

                    {!preflight.ready && (
                      <div className="rounded-[10px] border border-[#FF3B30]/30 bg-[#FF3B30]/8 px-4 py-3">
                        <p className="text-[12px] font-semibold text-[#FF3B30]">This machine cannot grade slides yet</p>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                          {preflight.blocking_failures.join(' · ')} — setup can continue, but slide analysis
                          will fail until this is resolved.
                        </p>
                        <button onClick={runChecks} className="text-[11.5px] text-[var(--accent)] font-medium mt-2 hover:underline">
                          Run checks again
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-[-0.2px]">Administrator Account</h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1">
                    {bootstrapNeeded === false
                      ? 'An account already exists on this machine.'
                      : 'This first account administers the installation and can add colleagues later.'}
                  </p>
                </div>

                {bootstrapNeeded === false ? (
                  <div className="rounded-[12px] border border-[var(--border-subtle)] px-4 py-3.5 flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#34C759] shrink-0" />
                    <p className="text-[12.5px]">Accounts are already configured — nothing to do here.</p>
                  </div>
                ) : (
                  <>
                    <TextField label="Full name" value={fullName} onChange={setFullName}
                               placeholder="e.g. Dr Sarah Chen" />
                    <TextField label="Username" value={username} onChange={setUsername}
                               placeholder="e.g. schen" autoComplete="username" />
                    <div className="grid grid-cols-2 gap-3">
                      <TextField label="Password" value={password} onChange={setPassword}
                                 type="password" placeholder="Min. 10 characters" autoComplete="new-password" />
                      <TextField label="Confirm" value={confirmPw} onChange={setConfirmPw}
                                 type="password" placeholder="Repeat" autoComplete="new-password" />
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      This password is also the electronic signature used to confirm or correct a grade,
                      so it must not be shared.
                    </p>
                    {accountError && <p className="text-[11.5px] text-[#FF3B30]">{accountError}</p>}
                    <Button size="lg" className="w-full" onClick={createAccount} disabled={accountBusy}>
                      {accountBusy ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : 'Create Account'}
                    </Button>
                  </>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-5">
                <div className="w-[52px] h-[52px] rounded-full bg-[#34C759]/12 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-[#34C759]" />
                </div>
                <div>
                  <h2 className="text-[21px] font-semibold tracking-[-0.3px]">Setup complete</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                    Omnia Pathology AI is licensed and ready on this machine.
                  </p>
                </div>
                <div className="rounded-[12px] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  <SummaryRow label="Licensed to" value={licenseOrg?.organization ?? '—'} />
                  <SummaryRow label="Licence expires" value={licenseOrg?.expires ?? '—'} />
                  <SummaryRow label="Slide grading"
                              value={preflight?.ready ? 'Ready' : 'Needs attention'}
                              accent={preflight?.ready ? '#34C759' : '#FF9500'} />
                  <SummaryRow label="Administrator"
                              value={accountDone ? fullName : bootstrapNeeded === false ? 'Existing account' : '—'} />
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  Every AI grade requires confirmation by a qualified pathologist before it becomes part of
                  the record.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="border-t border-[var(--border-subtle)] px-10 py-4 flex items-center gap-3 shrink-0 bg-[var(--bg-card-solid)]">
          {step > 0 && step < 5 && (
            <Button size="lg"
                    className="!bg-transparent !border !border-[var(--border-medium)] !text-[var(--text-primary)]"
                    onClick={() => setStep(step - 1)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step === 5 ? (
            <Button size="lg" className="min-w-[210px]" onClick={finish}>
              {accountDone || bootstrapNeeded === false ? 'Open Dashboard' : 'Continue to Sign In'}
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : step === 4 ? (
            bootstrapNeeded === false ? (
              <Button size="lg" className="min-w-[210px]" onClick={() => setStep(5)}>
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            ) : null
          ) : (
            <Button size="lg" className="min-w-[210px]" disabled={!canAdvance}
                    onClick={() => (step === 1 ? acceptTerms() : setStep(step + 1))}>
              {step === 1 ? 'Agree & Continue' : 'Continue'}
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, type = 'text', placeholder, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1.5 px-3.5 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--accent-border)]"
      />
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
      <span className="text-[12px] font-medium truncate">{value}</span>
    </div>
  );
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-[11.5px] text-[var(--text-secondary)]">{label}</span>
      <span className="text-[12.5px] font-medium truncate" style={{ color: accent }}>{value}</span>
    </div>
  );
}
