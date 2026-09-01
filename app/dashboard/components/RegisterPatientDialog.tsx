'use client';

/**
 * Patient registration.
 *
 * Short by intent. The identifier — the field that used to be typed, and the
 * one that caused subjects to split under inconsistent spellings — is not on
 * this form at all: the server generates it. What remains is the small set of
 * pseudonymised attributes that are clinically useful and not identifying.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { useDialogs } from '@/lib/dialogs';

export interface PatientProfileDraft {
  initials: string;
  year_of_birth: number | null;
  sex: string;
  site: string;
  notes: string;
}

const EMPTY: PatientProfileDraft = {
  initials: '', year_of_birth: null, sex: '', site: '', notes: '',
};

const THIS_YEAR = new Date().getFullYear();
const MIN_BIRTH_YEAR = 1900; // mirrors backend/patients.py

export default function RegisterPatientDialog({
  open, onCancel, onSubmit,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (draft: PatientProfileDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PatientProfileDraft>(EMPTY);
  const [yearText, setYearText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { confirm } = useDialogs();

  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY) || yearText !== '';

  useEffect(() => {
    if (open) {
      setDraft(EMPTY); setYearText(''); setErrors({});
      setSubmitError(''); setSubmitting(false);
    }
  }, [open]);

  const attemptClose = useCallback(async () => {
    if (submitting) return;
    if (dirty) {
      const ok = await confirm({
        title: 'Discard registration?',
        message: 'The details you have entered for this patient will be lost.',
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

  const validate = () => {
    const e: Record<string, string> = {};
    if (draft.initials && !/^[A-Za-z]{1,4}$/.test(draft.initials)) {
      e.initials = 'Use 1–4 letters, or leave blank.';
    }
    if (yearText.trim()) {
      const n = Number(yearText.trim());
      if (!Number.isInteger(n) || n < MIN_BIRTH_YEAR || n > THIS_YEAR) {
        e.year_of_birth = `Enter a year between ${MIN_BIRTH_YEAR} and ${THIS_YEAR}.`;
      }
    }
    return e;
  };

  const submit = async () => {
    if (submitting) return;
    const e = validate();
    setErrors(e); setSubmitError('');
    if (Object.keys(e).length > 0) {
      document.getElementById(`pt-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...draft,
        initials: draft.initials.trim().toUpperCase(),
        site: draft.site.trim(),
        notes: draft.notes.trim(),
        year_of_birth: yearText.trim() ? Number(yearText.trim()) : null,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not register the patient.');
      setSubmitting(false);
    }
  };

  const inputCls = (bad?: boolean) =>
    'w-full px-3 py-2.5 rounded-[10px] border bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:ring-2 transition-colors ' +
    (bad ? 'border-[#FF3B30] focus:ring-[#FF3B30]' : 'border-[var(--border-medium)] focus:ring-[var(--accent)]');

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4 py-6"
      onMouseDown={e => { if (e.target === e.currentTarget) void attemptClose(); }}
    >
      <div
        role="dialog" aria-modal="true" aria-labelledby="pt-dialog-title"
        className="w-full max-w-[520px] max-h-full flex flex-col rounded-[18px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 id="pt-dialog-title" className="text-[17px] font-semibold tracking-[-0.2px]">Register a patient</h2>
            <p className="text-[12px] text-[var(--text-secondary)] mt-1">
              A patient ID and container are created automatically.
            </p>
          </div>
          <button
            onClick={() => void attemptClose()} aria-label="Close"
            className="p-1.5 -mr-1.5 rounded-[8px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--skeleton-bg)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
          {/* The absence of name/DOB fields is deliberate and worth saying,
              so it does not read as an unfinished form. */}
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[#34C759]/25 bg-[#34C759]/10 px-3.5 py-3">
            <ShieldCheck className="w-4 h-4 text-[#34C759] shrink-0 mt-[1px]" />
            <p className="text-[12px] leading-relaxed">
              Do not enter names or full dates of birth. Every field here is optional and
              deliberately non-identifying — your site keeps the link between this record
              and the person.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pt-initials" className="block text-[12.5px] font-medium mb-1.5">Initials</label>
              <input
                id="pt-initials" value={draft.initials} maxLength={4}
                onChange={e => setDraft({ ...draft, initials: e.target.value })}
                placeholder="AB" aria-invalid={!!errors.initials || undefined}
                className={inputCls(!!errors.initials)}
              />
              {errors.initials
                ? <p role="alert" className="text-[11px] text-[#FF3B30] mt-1.5">{errors.initials}</p>
                : <p className="text-[11px] text-[var(--text-secondary)] mt-1.5">Common on CRFs. Optional.</p>}
            </div>
            <div>
              <label htmlFor="pt-year_of_birth" className="block text-[12.5px] font-medium mb-1.5">Year of birth</label>
              <input
                id="pt-year_of_birth" value={yearText} inputMode="numeric"
                onChange={e => setYearText(e.target.value)}
                placeholder="1958" aria-invalid={!!errors.year_of_birth || undefined}
                className={inputCls(!!errors.year_of_birth)}
              />
              {errors.year_of_birth
                ? <p role="alert" className="text-[11px] text-[#FF3B30] mt-1.5">{errors.year_of_birth}</p>
                : <p className="text-[11px] text-[var(--text-secondary)] mt-1.5">Year only — not a full date.</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pt-sex" className="block text-[12.5px] font-medium mb-1.5">Sex</label>
              <select
                id="pt-sex" value={draft.sex}
                onChange={e => setDraft({ ...draft, sex: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                <option value="">Not stated</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="pt-site" className="block text-[12.5px] font-medium mb-1.5">Site</label>
              <input
                id="pt-site" value={draft.site}
                onChange={e => setDraft({ ...draft, site: e.target.value })}
                placeholder="Massachusetts General Hospital"
                className={inputCls(false)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="pt-notes" className="block text-[12.5px] font-medium mb-1.5">Notes</label>
            <textarea
              id="pt-notes" value={draft.notes}
              onChange={e => setDraft({ ...draft, notes: e.target.value })}
              className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>

        <div className="border-t border-[var(--border-subtle)] px-6 py-4">
          {submitError && (
            <div className="flex items-start gap-2 mb-3 text-[12px] text-[#FF3B30]" role="alert">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
              <span>{submitError}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => void attemptClose()} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting
                ? <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Registering…</span>
                : 'Register patient'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
