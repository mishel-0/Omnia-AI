'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  FlaskConical, Users, Upload, Sparkles, PenLine, MessageSquareWarning,
  ScrollText, FileDown, ShieldCheck, ArrowRight, ArrowLeft, X, Check,
  HelpCircle, Search, BookOpen, Info, ChevronDown, Lock, Microscope,
} from 'lucide-react';
import { Card, Button, BrandMark } from '@/components/ui';

const SEEN_KEY = 'omnia_onboarding_seen';

export interface GuideStep {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  detail?: string;
}

/** The clinical workflow, in the order a pathologist actually performs it. */
export const GUIDE_STEPS: GuideStep[] = [
  {
    icon: FlaskConical,
    title: 'Start with a trial',
    body: 'Everything in Omnia lives under a clinical trial — the sponsor, the investigational drug, the indication, and the participating sites.',
    detail: 'Create one from "New Trial" on the dashboard. The trial list shows enrolment and review progress at a glance, and can be filtered by Active or Closed.',
  },
  {
    icon: Users,
    title: 'Enrol patients by visit',
    body: 'Each patient is recorded per visit — Baseline, Week 12, End of Treatment, and so on — so longitudinal timepoints stay separate.',
    detail: 'The same patient ID may appear at several visits, but never twice at the same visit; Omnia rejects duplicates to protect data integrity.',
  },
  {
    icon: Upload,
    title: 'Upload whole-slide images',
    body: 'Add the patient’s digitised pathology slides (.svs). Files are stored locally on this machine — nothing is uploaded to any cloud service.',
    detail: 'Large whole-slide images are streamed to disk rather than held in memory, so multi-gigabyte scans are handled safely.',
  },
  {
    icon: Sparkles,
    title: 'AI analysis runs automatically',
    body: 'Each slide is analysed for Gleason score and WHO/ISUP Grade Group, with an attention map showing which regions drove the result.',
    detail: 'A trained attention-based model samples 32 tissue regions per slide and weights them to reach a slide-level grade. It scored 0.7996 QWK on 1,827 held-out slides. It does not measure tumour burden, invasion, or biomarkers — those show as “Not assessed”.',
  },
  {
    icon: PenLine,
    title: 'You review and sign',
    body: 'No AI result is ever final. A qualified pathologist must Confirm the grade or Correct it, re-entering their password as an electronic signature.',
    detail: 'Signed slides become part of the regulatory record: they cannot be re-analysed, edited, or deleted afterwards.',
  },
  {
    icon: MessageSquareWarning,
    title: 'Raise queries on discrepancies',
    body: 'Anything questionable — a mismatched label, a suspect scan — can be flagged as a query against the patient, answered, and closed.',
    detail: 'Open query counts surface on both the trial list and the patient row so nothing is missed before database lock.',
  },
  {
    icon: ScrollText,
    title: 'Everything is audited',
    body: 'Every sign-in, edit, analysis, signature, and query is written to an append-only audit trail in 21 CFR Part 11 style.',
    detail: 'Administrators and monitors can review and export the full trail as CSV for inspection.',
  },
  {
    icon: FileDown,
    title: 'Export for the sponsor',
    body: 'Produce per-slide pathology PDFs, a trial summary report, and CSV extracts of patients and graded corrections.',
    detail: 'Corrections exports include the AI grade alongside the pathologist’s final grade — the dataset used to retrain and validate the model.',
  },
];

interface OnboardingContextValue {
  open: () => void;
  openHelp: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  // Show once per installation, after the user has actually signed in.
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY) !== 'true') setVisible(true);
    } catch { /* storage unavailable — just skip the tour */ }
  }, []);

  const open = useCallback(() => { setStep(0); setHelpOpen(false); setVisible(true); }, []);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  const finish = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, 'true'); } catch { /* noop */ }
    setVisible(false);
  }, []);

  return (
    <OnboardingContext.Provider value={{ open, openHelp }}>
      {children}
      {visible && <GuideOverlay step={step} setStep={setStep} onClose={finish} />}
      {!visible && (
        <HelpLauncher
          open={helpOpen}
          onOpen={() => setHelpOpen(true)}
          onClose={() => setHelpOpen(false)}
          onReplayGuide={open}
        />
      )}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within an OnboardingProvider');
  return ctx;
}

function GuideOverlay({
  step, setStep, onClose,
}: { step: number; setStep: (n: number) => void; onClose: () => void }) {
  const isIntro = step === 0;
  const stepIndex = step - 1;
  const total = GUIDE_STEPS.length;
  const current = GUIDE_STEPS[stepIndex];

  const next = () => (step >= total ? onClose() : setStep(step + 1));
  const back = () => setStep(Math.max(0, step - 1));

  return (
    <div className="fixed inset-0 z-[300] bg-black/55 flex items-center justify-center px-4">
      <Card size="lg" className="w-full max-w-[560px] p-0 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {isIntro ? 'Welcome' : `Step ${step} of ${total}`}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded-[6px] hover:bg-[var(--skeleton-bg)]" title="Skip guide">
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="px-8 py-7">
          {isIntro ? (
            <>
              <BrandMark size={54} className="mb-5" />
              <h2 className="text-[21px] font-semibold tracking-[-0.3px]">Welcome to Omnia Pathology AI</h2>
              <p className="text-[13px] text-[var(--text-secondary)] mt-2 leading-relaxed">
                Omnia is a clinical trial pathology suite. It manages your trials, patients and
                whole-slide images, runs AI-assisted grading over each slide, and records the
                pathologist review and electronic signature that makes a result final.
              </p>
              <div className="mt-5 rounded-[10px] border border-[#FF9500]/30 bg-[#FF9500]/[0.06] p-4">
                <div className="flex items-start gap-3">
                  <FlaskConical className="w-4 h-4 text-[#FF9500] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12px] font-semibold text-[#FF9500]">Research Use Only</p>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                      Not a diagnostic device. Every AI result requires confirmation by a qualified
                      pathologist before it may be used.
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-[12px] text-[var(--text-secondary)] mt-5">
                The next {total} steps walk through the workflow, end to end. It takes about a minute.
              </p>
            </>
          ) : (
            <>
              <div className="w-[46px] h-[46px] rounded-[12px] bg-[var(--accent-soft)] flex items-center justify-center mb-4">
                <current.icon className="w-[22px] h-[22px] text-[var(--accent)]" />
              </div>
              <h2 className="text-[19px] font-semibold tracking-[-0.2px]">{current.title}</h2>
              <p className="text-[13px] text-[var(--text-secondary)] mt-2 leading-relaxed">{current.body}</p>
              {current.detail && (
                <div className="mt-4 rounded-[10px] bg-[var(--skeleton-bg)] px-4 py-3">
                  <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{current.detail}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: total + 1 }).map((_, i) => (
              <span
                key={i}
                className="rounded-full transition-all"
                style={{
                  width: i === step ? 18 : 6, height: 6,
                  background: i === step ? 'var(--accent)' : 'var(--border-medium)',
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={back}>
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {isIntro ? 'Start Guide' : step >= total ? 'Get Started' : 'Next'}
              {step >= total ? <Check className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Short plain-language definitions shown next to clinical terms in the UI. */
export const GLOSSARY: Record<string, string> = {
  'Gleason Grade': 'Sum of the two most common tumour growth patterns (e.g. 4+3=7). Higher totals indicate more aggressive disease.',
  'WHO/ISUP Grade Group': 'The modern 1–5 prostate grading scale that replaced raw Gleason totals. Group 1 is least aggressive, Group 5 most.',
  'Risk Category': 'Approximate NCCN-style risk band derived from the grade group. Full clinical risk also factors in PSA and stage.',
  'Tumour Involvement': 'Percentage of the sampled tissue occupied by tumour.',
  'Perineural Invasion': 'Tumour tracking along nerves — an adverse prognostic feature.',
  'Lymphovascular Invasion': 'Tumour within lymphatic or blood vessels — associated with higher spread risk.',
  'Cribriform Pattern': 'A sieve-like growth pattern linked to worse outcomes in prostate cancer.',
  'Ki-67 Index': 'Proportion of dividing cells; a proliferation marker.',
  'PTEN': 'Tumour-suppressor gene. Loss of PTEN is associated with adverse prognosis.',
  'ERG': 'Positive staining suggests a TMPRSS2-ERG gene fusion.',
  'Confidence Score': 'How certain the analysis engine is in its own grade — not a measure of how advanced the disease is. Low confidence is a cue to look closer, not a diagnosis in itself.',
  'Electronic Signature': 'Re-entering your password to confirm or correct a grade. It is the legal marker that a qualified human, not the AI, is responsible for the final result.',
  'Audit Trail': 'An append-only log of every sign-in, edit, analysis, signature and query, kept in 21 CFR Part 11 style for sponsor inspection.',
  'Research Use Only': 'The grading model is not a certified diagnostic device and has not been cleared by any regulator. It is a single-fold model validated only on held-out PANDA data, never externally on other hospitals’ slides. Every result requires pathologist sign-off.',
};

/** Trust-building answers to the questions doctors actually ask before relying on the app. */
export interface FaqEntry { q: string; a: string }
export const FAQ: FaqEntry[] = [
  {
    q: 'Does any patient data leave this computer?',
    a: 'No. Trials, patients and slide images are stored locally in this app’s data folder on this machine. Nothing is uploaded to a cloud service.',
  },
  {
    q: 'Is the AI grade a final diagnosis?',
    a: 'No. Every AI-generated grade is a suggestion for review. It only becomes part of the record once a qualified pathologist confirms or corrects it and re-enters their password as an electronic signature.',
  },
  {
    q: 'What happens after I sign a slide?',
    a: 'It’s locked. Signed slides can’t be re-analysed, edited, or deleted, so the record stays trustworthy right through to database lock and sponsor audit.',
  },
  {
    q: 'What does the confidence score actually mean?',
    a: 'How certain the model is in its own output — not how advanced the disease is. Treat a low score as a prompt to look closer, not as a clinical finding.',
  },
  {
    q: 'Can I undo a mistake before I sign?',
    a: 'Yes. An unsigned slide can be deleted or re-analysed freely. Nothing about it is permanent until you confirm or correct it.',
  },
  {
    q: 'Who can see the audit trail, and can it be exported?',
    a: 'Admins and monitors can view it from the profile menu, and export the full trail as CSV for a sponsor or inspector at any time.',
  },
  {
    q: 'Why does the app say "Research Use Only"?',
    a: 'Because the grading model has not been cleared by any regulator as a diagnostic device. It is a single-fold model validated on held-out PANDA data only, never externally on other hospitals’ slides, and it grades prostate biopsies specifically. A qualified pathologist reviews and signs every result.',
  },
];

export function InfoHint({ term, className }: { term: string; className?: string }) {
  const text = GLOSSARY[term];
  const [openState, setOpenState] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!openState) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenState(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenState(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [openState]);

  if (!text) return null;
  return (
    <span ref={ref} className={'relative inline-flex align-middle ' + (className || '')}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpenState(v => !v); }}
        aria-expanded={openState}
        aria-label={`What does "${term}" mean?`}
        className={
          'inline-flex items-center justify-center w-[13px] h-[13px] rounded-full border transition-colors ' +
          (openState
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
            : 'border-[var(--border-medium)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]') +
          ' text-[9px] font-semibold cursor-pointer select-none'
        }
      >
        ?
      </button>
      {openState && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-[250] top-[calc(100%+6px)] left-1/2 -translate-x-1/2 w-[220px] rounded-[10px] bg-[var(--bg-card-solid)] border border-[var(--border-medium)] shadow-xl px-3 py-2.5 text-left"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] mb-1">{term}</p>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed normal-case font-normal">{text}</p>
        </div>
      )}
    </span>
  );
}

/** Floating "?" button, present on every dashboard page, opening a searchable
 * help panel (glossary + FAQ) plus a way to replay the full guided tour. */
function HelpLauncher({
  open, onOpen, onClose, onReplayGuide,
}: { open: boolean; onOpen: () => void; onClose: () => void; onReplayGuide: () => void }) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const matchedFaq = q ? FAQ.filter(f => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)) : FAQ;
  const matchedGlossary = q
    ? Object.entries(GLOSSARY).filter(([term, def]) => term.toLowerCase().includes(q) || def.toLowerCase().includes(q))
    : Object.entries(GLOSSARY);

  return (
    <>
      {!open && (
        <button
          onClick={onOpen}
          title="Help & Guides"
          aria-label="Open help center"
          className="fixed bottom-6 right-6 z-[220] w-12 h-12 rounded-full bg-[var(--accent)] text-white shadow-xl flex items-center justify-center hover:bg-[#0066D6] transition-colors hover:scale-105 active:scale-95"
          style={{ boxShadow: '0 8px 24px var(--accent-border)' }}
        >
          <HelpCircle className="w-6 h-6" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[280] flex justify-end" role="dialog" aria-label="Help center">
          <div className="fixed inset-0 bg-black/30" onClick={onClose} />
          <Card
            size="lg"
            className="relative w-full max-w-[380px] h-full !rounded-none flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)] shrink-0">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[var(--accent)]" />
                <h2 className="text-[14px] font-semibold">Help &amp; Guides</h2>
              </div>
              <button onClick={onClose} className="p-1 rounded-[6px] hover:bg-[var(--skeleton-bg)]">
                <X className="w-4 h-4 text-[var(--text-secondary)]" />
              </button>
            </div>

            <div className="px-5 pt-4 pb-2 shrink-0">
              <button
                onClick={() => { onClose(); onReplayGuide(); }}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-[12px] bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] transition-colors text-left mb-3"
              >
                <BookOpen className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span className="flex-1">
                  <span className="block text-[12.5px] font-semibold text-[var(--accent)]">Replay the full guided tour</span>
                  <span className="block text-[10.5px] text-[var(--text-secondary)]">The 8-step walkthrough, start to export</span>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search guides and terms…"
                  className="w-full pl-9 pr-3 py-2 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6">
              {matchedFaq.length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2 mt-2">Common Questions</p>
                  <div className="space-y-1.5">
                    {matchedFaq.map((f) => <FaqItem key={f.q} entry={f} />)}
                  </div>
                </div>
              )}

              {matchedGlossary.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Clinical Glossary</p>
                  <div className="space-y-2.5">
                    {matchedGlossary.map(([term, def]) => (
                      <div key={term} className="rounded-[10px] border border-[var(--border-subtle)] px-3 py-2.5">
                        <p className="text-[11.5px] font-semibold mb-0.5">{term}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{def}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {matchedFaq.length === 0 && matchedGlossary.length === 0 && (
                <p className="text-[12px] text-[var(--text-secondary)] text-center py-8">No results for &quot;{query}&quot;.</p>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[var(--border-subtle)] shrink-0 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
              <p className="text-[10px] text-[var(--text-secondary)] leading-snug">
                Everything above reflects how Omnia actually behaves — not marketing copy.
              </p>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function FaqItem({ entry }: { entry: FaqEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(v => !v)}
      className="w-full text-left rounded-[10px] border border-[var(--border-subtle)] px-3 py-2.5 hover:border-[var(--border-medium)] transition-colors"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium leading-snug">{entry.q}</span>
        <Info className={'w-3 h-3 shrink-0 transition-transform text-[var(--text-secondary)] ' + (expanded ? 'rotate-180' : '')} />
      </span>
      {expanded && (
        <span className="block text-[11.5px] text-[var(--text-secondary)] leading-relaxed mt-2">{entry.a}</span>
      )}
    </button>
  );
}

/** Expandable "how was this produced" panel shown directly on an AI result —
 * the one place trust actually needs to be earned, not just asserted once at login. */
export function TrustDisclosure({ signed }: { signed?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] overflow-hidden mb-5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-[var(--skeleton-bg)] transition-colors text-left"
      >
        <span className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
          <span className="text-[11.5px] font-medium">How this result was produced</span>
        </span>
        <ChevronDown className={'w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform ' + (expanded ? 'rotate-180' : '')} />
      </button>
      {expanded && (
        <div className="px-3.5 pb-3.5 pt-0.5 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <Microscope className="w-3.5 h-3.5 text-[var(--accent)] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              The grade comes from an <strong className="text-[var(--text-primary)]">attention-based
              deep learning model</strong> trained on the PANDA prostate biopsy dataset. It samples
              32 tissue regions from the slide, scores each one, and weights them to reach a
              slide-level ISUP grade.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <FlaskConical className="w-3.5 h-3.5 text-[#FF9500] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              It scored <strong className="text-[var(--text-primary)]">0.7996 QWK</strong> on 1,827
              held-out slides &mdash; a single-fold model, not externally validated on other
              hospitals&apos; data. It grades prostate biopsies only, and will still return a grade
              if given other tissue. It does not measure tumour size, invasion, or biomarkers.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Info className="w-3.5 h-3.5 text-[var(--accent)] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              The <strong className="text-[var(--text-primary)]">confidence score</strong> reflects how
              certain the model is in its own output, not how advanced the disease is. Treat a low
              score as a prompt to look closer, not as a finding.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Lock className="w-3.5 h-3.5 text-[#34C759] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              {signed
                ? 'A pathologist has confirmed or corrected this grade and signed it — it is now part of the permanent record and cannot be re-analysed, edited, or deleted.'
                : 'Nothing here is final. It becomes part of the record only once a qualified pathologist confirms or corrects it and re-enters their password as an electronic signature.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
