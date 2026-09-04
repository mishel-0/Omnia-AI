'use client';

/**
 * Trial registration dialog.
 *
 * Deliberately a single grouped form rather than a multi-step wizard: there
 * are seven fields, and splitting seven fields across paged screens adds
 * clicks and state without adding clarity. What makes registration reliable
 * here is labelling, validation, and an explicit scope warning — not pagination.
 *
 * The design constraints this satisfies, each of which the previous version
 * violated:
 *   - Every field has a real <label>. Placeholder-as-label loses the field's
 *     meaning the moment the coordinator types, which in a trial record is a
 *     transcription-error risk, not a cosmetic one.
 *   - Required fields are validated with a visible, field-level reason. The
 *     old form returned early on missing input, so the button appeared dead.
 *   - Sites are discrete rows. Comma-joining meant a site named
 *     "Site B, Chicago" silently split into two sites.
 *   - Submission is single-flight, so a double click cannot create two trials.
 *   - Typed data is never discarded without confirmation.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { useDialogs } from '@/lib/dialogs';

/** Must match TRIAL_PHASES in backend/trials.py — the backend rejects others. */
const PHASES = [
  'Preclinical', 'Phase I', 'Phase I/II', 'Phase II',
  'Phase II/III', 'Phase III', 'Phase IV', 'Observational',
] as const;

/** Mirrors MAX_NAME_LEN / MAX_PROTOCOL_LEN so the user sees the limit before
 *  the server rejects the submission. */
const MAX_NAME_LEN = 200;
const MAX_PROTOCOL_LEN = 100;

/** The grading model is prostate-only. Anything else is flagged so a
 *  coordinator does not register a trial expecting automated grades that this
 *  system cannot produce. Substring match, lowercased. */
const IN_SCOPE_TERMS = ['prostate', 'prostatic'];

export interface TrialDraft {
  name: string;
  protocol_id: string;
  phase: string;
  sponsor: string;
  drug: string;
  indication: string;
  notes: string;
  sites: string[];
}

const EMPTY: TrialDraft = {
  name: '', protocol_id: '', phase: '', sponsor: '',
  drug: '', indication: '', notes: '', sites: [''],
};

type Errors = Partial<Record<keyof TrialDraft, string>>;

function validate(d: TrialDraft): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = 'Trial name is required.';
  else if (d.name.trim().length > MAX_NAME_LEN) e.name = `Must be ${MAX_NAME_LEN} characters or fewer.`;

  if (!d.sponsor.trim()) e.sponsor = 'Sponsor is required.';
  else if (d.sponsor.trim().length > MAX_NAME_LEN) e.sponsor = `Must be ${MAX_NAME_LEN} characters or fewer.`;

  if (!d.drug.trim()) e.drug = 'Investigational product is required.';
  else if (d.drug.trim().length > MAX_NAME_LEN) e.drug = `Must be ${MAX_NAME_LEN} characters or fewer.`;

  if (d.indication.trim().length > MAX_NAME_LEN) e.indication = `Must be ${MAX_NAME_LEN} characters or fewer.`;
  if (d.protocol_id.trim().length > MAX_PROTOCOL_LEN) e.protocol_id = `Must be ${MAX_PROTOCOL_LEN} characters or fewer.`;
  return e;
}

export default function CreateTrialDialog({
  open, onCancel, onSubmit,
}: {
  open: boolean;
  onCancel: () => void;
  /** Should throw on failure; the dialog stays open and shows the message. */
  onSubmit: (draft: TrialDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TrialDraft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Errors appear only after a submit attempt. Validating every keystroke
  // marks a field invalid while it is still being typed into.
  const [attempted, setAttempted] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const { confirm } = useDialogs();

  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY);

  useEffect(() => {
    if (open) {
      setDraft(EMPTY); setErrors({}); setSubmitError('');
      setSubmitting(false); setAttempted(false);
      // Focus the first field so the form is keyboard-usable immediately.
      const t = setTimeout(() => firstFieldRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Uses the app's own confirm dialog rather than window.confirm, so the
  // discard prompt is styled like every other destructive confirmation in
  // the product instead of a bare browser alert.
  const attemptClose = useCallback(async () => {
    if (submitting) return; // never abandon an in-flight create
    if (dirty) {
      const ok = await confirm({
        title: 'Discard registration?',
        message: 'Everything you have entered for this trial will be lost.',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return;
    }
    onCancel();
  }, [dirty, submitting, onCancel, confirm]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') void attemptClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, attemptClose]);

  if (!open) return null;

  const set = <K extends keyof TrialDraft>(k: K, v: TrialDraft[K]) => {
    setDraft(prev => {
      const next = { ...prev, [k]: v };
      if (attempted) setErrors(validate(next));
      return next;
    });
  };

  const setSite = (i: number, v: string) =>
    setDraft(p => ({ ...p, sites: p.sites.map((s, j) => (j === i ? v : s)) }));
  const addSite = () => setDraft(p => ({ ...p, sites: [...p.sites, ''] }));
  const removeSite = (i: number) =>
    setDraft(p => ({ ...p, sites: p.sites.length === 1 ? [''] : p.sites.filter((_, j) => j !== i) }));

  const indication = draft.indication.trim().toLowerCase();
  const outOfScope = indication.length > 0 && !IN_SCOPE_TERMS.some(t => indication.includes(t));

  const submit = async () => {
    if (submitting) return;
    setAttempted(true);
    const e = validate(draft);
    setErrors(e);
    setSubmitError('');
    if (Object.keys(e).length > 0) {
      // Move focus to the first problem so the reason is on screen.
      const el = document.getElementById(`trial-${Object.keys(e)[0]}`);
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...draft,
        name: draft.name.trim(),
        protocol_id: draft.protocol_id.trim(),
        sponsor: draft.sponsor.trim(),
        drug: draft.drug.trim(),
        indication: draft.indication.trim(),
        sites: draft.sites.map(s => s.trim()).filter(Boolean),
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create the trial.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4 py-6"
      onMouseDown={e => { if (e.target === e.currentTarget) void attemptClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-dialog-title"
        className="w-full max-w-[620px] max-h-full flex flex-col rounded-[18px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="trial-dialog-title" className="text-[17px] font-semibold tracking-[-0.2px]">
              Register a clinical trial
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)] mt-1">
              Identifying details are recorded with every slide analysed under this trial.
            </p>
          </div>
          <button
            onClick={() => void attemptClose()}
            aria-label="Close"
            className="p-1.5 -mr-1.5 rounded-[8px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--skeleton-bg)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto custom-scrollbar px-6 py-5 space-y-6">
          <Section title="Trial identification">
            <Field
              id="trial-name" label="Trial name" required error={errors.name}
              hint="The name coordinators will recognise on this dashboard."
            >
              <Input
                ref={firstFieldRef} id="trial-name" value={draft.name}
                onChange={v => set('name', v)} placeholder="ALK-427"
                invalid={!!errors.name}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                id="trial-protocol_id" label="Protocol / registry ID" error={errors.protocol_id}
                hint="e.g. an NCT or EudraCT number."
              >
                <Input
                  id="trial-protocol_id" value={draft.protocol_id}
                  onChange={v => set('protocol_id', v)} placeholder="NCT01234567"
                  invalid={!!errors.protocol_id}
                />
              </Field>
              <Field id="trial-phase" label="Phase">
                <select
                  id="trial-phase" value={draft.phase}
                  onChange={e => set('phase', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">Not stated</option>
                  {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Sponsor & investigational product">
            <Field id="trial-sponsor" label="Sponsor" required error={errors.sponsor}>
              <Input
                id="trial-sponsor" value={draft.sponsor}
                onChange={v => set('sponsor', v)} placeholder="Roche"
                invalid={!!errors.sponsor}
              />
            </Field>
            <Field
              id="trial-drug" label="Investigational product" required error={errors.drug}
              hint="The compound or agent under study."
            >
              <Input
                id="trial-drug" value={draft.drug}
                onChange={v => set('drug', v)} placeholder="Enzalutamide"
                invalid={!!errors.drug}
              />
            </Field>
            <Field
              id="trial-indication" label="Indication" error={errors.indication}
              hint="The condition being treated."
            >
              <Input
                id="trial-indication" value={draft.indication}
                onChange={v => set('indication', v)} placeholder="Prostate adenocarcinoma"
                invalid={!!errors.indication}
              />
            </Field>

            {/* Scope is a safety matter, not a preference: the bundled model
                grades prostate histology only. Registering an out-of-scope
                trial is allowed — the record is still useful — but the
                coordinator is told plainly that no automated grade will
                be produced, rather than discovering it after uploading. */}
            {outOfScope && (
              <div className="flex items-start gap-2.5 rounded-[10px] border border-[#FF9500]/30 bg-[#FF9500]/10 px-3.5 py-3">
                <AlertTriangle className="w-4 h-4 text-[#FF9500] shrink-0 mt-[1px]" />
                <p className="text-[12px] leading-relaxed text-[var(--text-primary)]">
                  Automated grading in this build is validated for <strong>prostate</strong> histology
                  only (ISUP grade groups). You can still register this trial and store its slides,
                  but Omnia will not produce a grade for &ldquo;{draft.indication.trim()}&rdquo;.
                </p>
              </div>
            )}
          </Section>

          <Section
            title="Participating sites"
            aside={
              <button
                onClick={addSite}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> Add site
              </button>
            }
          >
            {/* One row per site. The previous comma-separated field split any
                site whose own name contained a comma. */}
            <div className="space-y-2">
              {draft.sites.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    id={`trial-site-${i}`} value={s}
                    onChange={v => setSite(i, v)}
                    placeholder={i === 0 ? 'Massachusetts General Hospital, Boston' : 'Additional site'}
                    aria-label={`Site ${i + 1}`}
                  />
                  <button
                    onClick={() => removeSite(i)}
                    aria-label={`Remove site ${i + 1}`}
                    disabled={draft.sites.length === 1 && !s}
                    className="p-2 rounded-[8px] text-[var(--text-secondary)] hover:text-[#FF3B30] hover:bg-[var(--skeleton-bg)] disabled:opacity-30 disabled:hover:text-[var(--text-secondary)] disabled:hover:bg-transparent transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] mt-2">Optional. Blank rows are ignored.</p>
          </Section>

          <Section title="Notes">
            <Field id="trial-notes" label="Protocol notes" hint="Optional. Visible to anyone with access to this trial.">
              <textarea
                id="trial-notes" value={draft.notes}
                onChange={e => set('notes', e.target.value)}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </Field>
          </Section>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-subtle)] px-6 py-4">
          {submitError && (
            <div className="flex items-start gap-2 mb-3 text-[12px] text-[#FF3B30]" role="alert">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
              <span>{submitError}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] text-[var(--text-secondary)]">
              <span className="text-[#FF3B30]">*</span> Required
            </p>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => void attemptClose()} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting
                  ? <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Registering…</span>
                  : 'Register trial'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Form primitives ── */

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.6px] text-[var(--text-secondary)]">{title}</h3>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  id, label, required, hint, error, children,
}: {
  id: string; label: string; required?: boolean; hint?: string;
  error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[12.5px] font-medium mb-1.5">
        {label}{required && <span className="text-[#FF3B30] ml-0.5">*</span>}
      </label>
      {children}
      {/* An error replaces the hint rather than stacking, so the row height
          stays stable and the message is the thing that is read. */}
      {error
        ? <p id={`${id}-error`} role="alert" className="text-[11px] text-[#FF3B30] mt-1.5">{error}</p>
        : hint ? <p className="text-[11px] text-[var(--text-secondary)] mt-1.5">{hint}</p> : null}
    </div>
  );
}

const Input = React.forwardRef<HTMLInputElement, {
  id: string; value: string; onChange: (v: string) => void;
  placeholder?: string; invalid?: boolean; 'aria-label'?: string;
}>(function Input({ id, value, onChange, placeholder, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      id={id}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      className={
        'w-full px-3 py-2.5 rounded-[10px] border bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:ring-2 transition-colors ' +
        (invalid
          ? 'border-[#FF3B30] focus:ring-[#FF3B30]'
          : 'border-[var(--border-medium)] focus:ring-[var(--accent)]')
      }
      {...rest}
    />
  );
});
