'use client';

/**
 * Help and support, for software that runs offline on the site's own hardware.
 *
 * The reference design offered live chat, a phone number, hosted video
 * tutorials, an API reference and a cloud status page. None of those exist
 * here and none of them could: there is no server to chat with, no support
 * desk behind a number, and no status to poll — the only system whose status
 * matters is the machine the page is running on.
 *
 * Two of its items were worse than merely absent.
 *
 *   A phone number of +1 (555) 123-4567. 555 is the reserved fictional range.
 *   A support number that cannot be dialled is worse on a clinical screen than
 *   no number, because someone will try it during the one hour it matters.
 *
 *   "HIPAA/GDPR compliant". Neither is a property software can have on its
 *   own: they describe an organisation's processing, its lawful basis, its
 *   agreements and its procedures. This application implements the technical
 *   measures — pseudonymisation, access control, an audit trail, the
 *   data-subject rights in Settings — and saying more than that on a help page
 *   is a claim a regulator would hold the deploying organisation to.
 *
 * What replaces them is what a site actually needs when something goes wrong
 * and there is no internet: the built-in guide, the live state of this
 * machine, the release notes for the build they are running, and a diagnostics
 * file they can send onward by whatever means their organisation already uses.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Activity, FileText, LifeBuoy, ChevronRight, Download, Search,
  CheckCircle2, AlertTriangle, ShieldCheck, RefreshCw, Cpu,
} from 'lucide-react';
import { Card, Button, Skeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth } from '@/lib/auth';
import { useOnboarding } from '@/lib/onboarding';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface Check { key: string; label: string; ok: boolean; detail: string; fatal: boolean }

/** Answers about this installation, not about a product category. */
const FAQ = [
  {
    q: 'How do I register a patient?',
    a: 'Patients → Register Patient. Identifiers are generated here and carry a check character, so a mistyped ID is rejected rather than silently resolving to a different person. You never type the identifier yourself.',
  },
  {
    q: 'Why does a patient record hold so little?',
    a: 'By design. No name and no full date of birth is stored — only initials, year of birth, sex and site. Your site holds the mapping from an identifier to a person; this application deliberately does not.',
  },
  {
    q: 'Does anything leave this machine?',
    a: 'No. Grading, storage and the audit trail are all local, and the service binds to loopback. The one exception is optional: if you join the Omnia Network, a file of adjusted model weights can be sent — never a slide, never an identifier — and only when you choose to send it.',
  },
  {
    q: 'Is this software HIPAA or GDPR compliant?',
    a: 'Compliance describes your organisation, not a piece of software, so no application can be compliant on your behalf. What this one provides is the technical side: pseudonymisation by design, role-based access, an append-only audit trail, and the data-subject rights — export, redaction and erasure — under Settings → Data protection. Your lawful basis, DPIA, records of processing and agreements remain yours.',
  },
  {
    q: 'Can I trust a grade the model produced?',
    a: 'Treat it as a second read, never as a diagnosis. This is research-use-only software: an analysed slide becomes part of the record only once a qualified pathologist confirms or corrects the grade, and that signature is what the audit trail records.',
  },
  {
    q: 'Which model is grading right now?',
    a: 'Models shows every model this installation holds and which one is in use, with its agreement score against the baseline measured on held-out slides. Runs that did not beat the baseline are listed too, marked Not promoted.',
  },
  {
    q: 'Something is wrong — what do I send to support?',
    a: 'Use Download diagnostics below. It produces a small file containing software versions, record counts and a summary of recent activity by type. It contains no patient data, so it can be sent by ordinary email.',
  },
];

export default function HelpPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { open: openGuide } = useOnboarding();
  const toast = useToast();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = user?.role === 'admin';

  const loadStatus = useCallback(async () => {
    setChecks(null);
    const [pf, h] = await Promise.all([
      apiSend('/api/system/preflight').catch(() => null),
      apiSend('/health').catch(() => null),
    ]);
    setChecks(Array.isArray(pf?.checks) ? pf.checks : []);
    setVersion(h?.version ?? '');
  }, []);

  useEffect(() => {
    loadStatus();
    apiSend('/api/system/changelog')
      .then(r => setNotes(r?.markdown ?? ''))
      .catch(() => setNotes(''));
  }, [loadStatus]);

  const downloadDiagnostics = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/api/system/diagnostics');
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'omnia-diagnostics.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      toast.show('Diagnostics file saved');
    } catch {
      toast.show('Could not generate the diagnostics file.', 'error');
    } finally { setBusy(false); }
  };

  const q = query.trim().toLowerCase();
  const faq = q ? FAQ.filter(f => (f.q + f.a).toLowerCase().includes(q)) : FAQ;

  const failing = (checks ?? []).filter(c => !c.ok && c.fatal);
  const warning = (checks ?? []).filter(c => !c.ok && !c.fatal);
  const healthy = checks !== null && failing.length === 0 && warning.length === 0;

  // The most recent release's section, which is what "what's new" means.
  const latest = (notes ?? '').split(/\n(?=## )/)[1] ?? '';

  return (
    <div className="max-w-[1200px] px-7 pt-6 pb-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] mb-4">
        <button onClick={() => router.push('/dashboard')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          Dashboard
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="font-medium text-[var(--accent)]" aria-current="page">Help</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.6px] leading-tight">Help</h1>
        <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
          Everything here works offline. This installation has no connection to a support
          service, and nothing on this page contacts one.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <ActionCard icon={BookOpen} tone="var(--accent)" title="Guided tour"
                    body="Replay the walkthrough that runs on first launch."
                    action="Start" onClick={openGuide} />
        <ActionCard icon={Activity} tone={healthy ? '#34C759' : failing.length ? '#FF3B30' : '#FF9500'}
                    title="This machine"
                    body={checks === null ? 'Checking…'
                      : failing.length ? `${failing.length} component not working`
                      : warning.length ? `${warning.length} warning`
                      : 'Every grading component loaded'}
                    action="Re-check" onClick={loadStatus} />
        <ActionCard icon={Download} tone="#5856D6" title="Diagnostics"
                    body={isAdmin
                      ? 'A file you can email on. Contains no patient data.'
                      : 'An administrator can generate this.'}
                    action={busy ? 'Preparing…' : 'Download'}
                    onClick={downloadDiagnostics} disabled={!isAdmin || busy} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card size="md" className="p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-[14px] bg-[var(--accent-soft)] grid place-items-center shrink-0">
                <LifeBuoy className="w-4 h-4 text-[var(--accent)]" />
              </span>
              <h2 className="text-[15px] font-semibold">Common questions</h2>
            </div>

            <div className="relative mb-3">
              <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search these answers…"
                className="w-full pl-11 pr-4 py-2.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            {faq.length === 0 ? (
              <p className="text-[12.5px] text-[var(--text-secondary)] py-4">
                Nothing here matches that. The guided tour above covers the main screens.
              </p>
            ) : (
              <div className="space-y-1.5">
                {faq.map(f => <Faq key={f.q} q={f.q} a={f.a} />)}
              </div>
            )}
          </Card>

          {latest && (
            <Card size="md" className="p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="w-9 h-9 rounded-[14px] bg-[#FF9500]/12 grid place-items-center shrink-0">
                  <FileText className="w-4 h-4 text-[#FF9500]" />
                </span>
                <h2 className="text-[15px] font-semibold">What changed in this version</h2>
              </div>
              {/* Read from the notes bundled with this build, so they describe
                  the version actually running rather than the newest release. */}
              <pre className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap font-sans max-h-[280px] overflow-y-auto custom-scrollbar">
                {latest.trim()}
              </pre>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card size="md" className="p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-[14px] bg-[#34C759]/12 grid place-items-center shrink-0">
                <ShieldCheck className="w-4 h-4 text-[#34C759]" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold">System status</h2>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  This machine, checked just now
                </p>
              </div>
            </div>

            {checks === null ? (
              <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-6 rounded-full" />)}</div>
            ) : checks.length === 0 ? (
              <p className="text-[12.5px] text-[var(--text-secondary)]">
                Status is unavailable — the backend did not answer.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                {checks.map(c => (
                  <div key={c.key} className="flex items-start gap-2.5 py-1">
                    {c.ok
                      ? <CheckCircle2 className="w-4 h-4 text-[#34C759] shrink-0 mt-[1px]" />
                      : <AlertTriangle className={cn('w-4 h-4 shrink-0 mt-[1px]',
                          c.fatal ? 'text-[#FF3B30]' : 'text-[#FF9500]')} />}
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium">{c.label}</span>
                      <span className="block text-[11px] text-[var(--text-secondary)] leading-snug">
                        {c.detail}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={loadStatus}>
              <RefreshCw className="w-3.5 h-3.5" /> Re-check
            </Button>
          </Card>

          <SystemRequirements />

          <Card size="md" className="p-5">
            <h2 className="text-[15px] font-semibold mb-1">Getting support</h2>
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
              Support for this installation is arranged by your own organisation — this
              software has no built-in channel to contact, and would have no way to reach
              one from an offline machine.
            </p>
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mt-2">
              When you report a problem, include the version below and the diagnostics
              file. Together they answer most of what anyone would ask first.
            </p>
            <dl className="mt-3 space-y-1.5">
              <Row label="Version" value={version || '—'} />
              <Row label="Intended use" value="Research use only" />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[11.5px] text-[var(--text-secondary)]">{label}</dt>
      <dd className="text-[11.5px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ActionCard({ icon: Icon, tone, title, body, action, onClick, disabled }: {
  icon: React.ElementType; tone: string; title: string; body: string;
  action: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <Card size="md" className="p-4 flex flex-col gap-2.5">
      <span className="w-11 h-11 rounded-[16px] grid place-items-center"
            style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon className="w-[18px] h-[18px]" style={{ color: tone }} />
      </span>
      <span>
        <span className="block text-[13.5px] font-semibold">{title}</span>
        <span className="block text-[11.5px] text-[var(--text-secondary)] leading-snug mt-0.5">{body}</span>
      </span>
      <Button variant="secondary" size="sm" className="mt-auto self-start"
              onClick={onClick} disabled={disabled}>
        {action}
      </Button>
    </Card>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[18px] border border-[var(--border-subtle)] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--cc-tile-hover)]"
      >
        <span className="text-[13px] font-medium">{q}</span>
        <ChevronRight className={cn('w-4 h-4 text-[var(--text-secondary)] shrink-0 transition-transform duration-200',
                                    open && 'rotate-90')} />
      </button>
      {open && (
        <p className="px-4 pb-3.5 -mt-0.5 text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
          {a}
        </p>
      )}
    </div>
  );
}


/** What a machine needs to run this, so a site can check before installing.
 *
 * Every figure here was measured on a build of this application rather than
 * estimated: peak memory while grading, the installed size, and the minimum OS
 * from the bundle itself. The processor line is the one that actually excludes
 * machines, so it is stated first and without hedging — PyTorch stopped
 * publishing macOS x86_64 builds after 2.2.2, and this application runs a much
 * later version, so an Intel Mac cannot be supported by packaging alone.
 */
function SystemRequirements() {
  const platform = typeof window !== 'undefined'
    ? (window as unknown as { omnia?: { platform?: string } }).omnia?.platform
    : undefined;
  const isWindows = platform === 'win32';

  return (
    <Card size="md" className="p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-9 h-9 rounded-[14px] bg-[#5856D6]/12 grid place-items-center shrink-0">
          <Cpu className="w-4 h-4 text-[#5856D6]" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold">System requirements</h2>
          <p className="text-[11px] text-[var(--text-secondary)]">
            To run grading — training needs more
          </p>
        </div>
      </div>

      <dl className="space-y-2.5">
        {isWindows ? (
          <Req label="Operating system" value="Windows 10 or 11, 64-bit" />
        ) : (
          <>
            <Req label="Operating system" value="macOS 12 Monterey or later" />
            {/* The one requirement that rules machines out, so it does not sit
                quietly in a list as though it were negotiable. */}
            <div className="rounded-[14px] border border-[#FF9500]/30 bg-[#FF9500]/10 px-3.5 py-2.5">
              <p className="text-[12px] font-medium">Apple Silicon required</p>
              <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
                M1 or later. Intel Macs are not supported and cannot be: the inference
                engine this version uses is no longer published for Intel processors.
              </p>
            </div>
          </>
        )}
        <Req label="Memory" value="8 GB" note="Grading itself peaks near 1 GB" />
        <Req label="Disk" value="2 GB" note="1.4 GB for the application, plus your slides" />
        <Req label="Graphics" value="Not required" note="Grading runs on the processor" />
        <Req label="Network" value="Not required" note="Nothing is sent anywhere" />
      </dl>

      <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed mt-3.5 pt-3.5 border-t border-[var(--border-subtle)]">
        A slide takes a few seconds to grade, most of it spent finding tissue rather
        than running the model — so a large slide takes longer than a small one, and
        a faster processor helps more than extra memory.
      </p>
    </Card>
  );
}

function Req({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[12px] text-[var(--text-secondary)] shrink-0">{label}</dt>
      <dd className="text-right min-w-0">
        <span className="block text-[12px] font-medium">{value}</span>
        {note && <span className="block text-[11px] text-[var(--text-secondary)] leading-snug">{note}</span>}
      </dd>
    </div>
  );
}
