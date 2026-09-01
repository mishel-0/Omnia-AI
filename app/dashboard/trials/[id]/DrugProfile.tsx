'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Pill as PillIcon, ChevronDown, AlertCircle, Check, X, FlaskConical } from 'lucide-react';
import { apiFetch } from '@/lib/auth';
import { Button, Pill } from '@/components/ui';
import { useToast } from '@/lib/toast';

interface Chemistry {
  valid: boolean; error?: string;
  canonical_smiles?: string; formula?: string; molecular_weight?: number;
  logp?: number; tpsa?: number; hbd?: number; hba?: number;
  rotatable_bonds?: number; aromatic_rings?: number; heavy_atoms?: number;
  fraction_csp3?: number; lipinski_violations?: string[]; lipinski_pass?: boolean;
  inchikey?: string | null;
}
interface Drug {
  trial_id?: string; name?: string; code?: string; drug_class?: string;
  target?: string; mechanism?: string; modality?: string;
  dose?: string; route?: string; schedule?: string; smiles?: string;
  comparator?: string; notes?: string; chemistry?: Chemistry;
}
interface Evidence {
  drug: Drug | null;
  observations: string[];
  limits: string[];
  can_conclude: string;
  cannot_conclude: string;
  cohort: {
    subject_count: number; graded_slide_count: number; signed_slide_count: number;
    subjects_with_paired_timepoints: number;
    trajectory_counts: Record<string, number>;
    significant_movers: { patient_id: string; from_visit: string; to_visit: string; delta: number }[];
    mean_confidence: number | null;
  };
}

const FIELDS: { key: keyof Drug; label: string; placeholder: string; wide?: boolean }[] = [
  { key: 'name', label: 'Name', placeholder: 'e.g. Enzalutamide' },
  { key: 'code', label: 'Code', placeholder: 'e.g. MDV3100' },
  { key: 'drug_class', label: 'Class', placeholder: 'e.g. Androgen receptor inhibitor' },
  { key: 'modality', label: 'Modality', placeholder: 'e.g. Small molecule' },
  { key: 'target', label: 'Target (as stated)', placeholder: 'e.g. Androgen receptor' },
  { key: 'comparator', label: 'Comparator arm', placeholder: 'e.g. Placebo' },
  { key: 'dose', label: 'Dose', placeholder: 'e.g. 160 mg' },
  { key: 'route', label: 'Route', placeholder: 'e.g. Oral' },
  { key: 'schedule', label: 'Schedule', placeholder: 'e.g. Once daily' },
  { key: 'mechanism', label: 'Mechanism (as stated)', placeholder: 'Sponsor-stated mechanism of action', wide: true },
  { key: 'smiles', label: 'Structure (SMILES)', placeholder: 'e.g. CC(=O)Oc1ccccc1C(=O)O', wide: true },
  { key: 'notes', label: 'Notes', placeholder: 'Anything else the team should see', wide: true },
];

/** Investigational product record, computed chemistry, and an evidence
 * summary pairing the compound with observed histology.
 *
 * The compound record and the grading results are shown side by side and
 * are NOT fused: the grading model reads pixels and has no input channel
 * for structure, target or dose. The evidence panel states what that
 * pairing can and cannot support rather than asserting a verdict. */
export function DrugProfile({ trialId, writable }: { trialId: string; writable: boolean }) {
  const [drug, setDrug] = useState<Drug | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Drug>({});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [structUrl, setStructUrl] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [dRes, eRes] = await Promise.all([
        apiFetch(`/api/trials/${trialId}/drug`),
        apiFetch(`/api/trials/${trialId}/evidence`),
      ]);
      if (dRes.ok) {
        const d = await dRes.json();
        setDrug(d && Object.keys(d).length ? d : null);
        setForm(d || {});
      }
      if (eRes.ok) setEvidence(await eRes.json());
    } catch { /* panel is supplementary; never block the page */ }
  }, [trialId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (!drug?.chemistry?.valid) { setStructUrl(null); return; }
    (async () => {
      try {
        const res = await apiFetch(`/api/trials/${trialId}/drug/structure.png`);
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        revoked = u;
        setStructUrl(u);
      } catch { /* structure image is optional */ }
    })();
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [trialId, drug?.chemistry?.valid, drug?.smiles]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/trials/${trialId}/drug`, {
        method: 'PUT', body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || 'Could not save');
      const saved = await res.json();
      setDrug(saved);
      setEditing(false);
      if (saved.smiles && saved.chemistry && !saved.chemistry.valid) {
        toast.show(`Saved, but the structure was not accepted: ${saved.chemistry.error}`, 'error');
      } else {
        toast.show('Investigational product saved', 'info');
      }
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally { setSaving(false); }
  };

  const chem = drug?.chemistry;

  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--skeleton-bg)] transition-colors text-left"
      >
        <span className="flex items-center gap-2 flex-wrap">
          <PillIcon className="w-4 h-4 text-[#5856D6]" />
          <span className="text-[13px] font-semibold">Investigational product</span>
          {drug?.name ? (
            <span className="text-[11px] text-[var(--text-secondary)]">
              {drug.name}{drug.code ? ` (${drug.code})` : ''}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--text-secondary)]">Not recorded</span>
          )}
          {chem?.valid && <Pill accent="purple" className="!text-[9px] !py-0.5">{chem.formula}</Pill>}
        </span>
        <ChevronDown className={'w-4 h-4 text-[var(--text-secondary)] transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {editing ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {FIELDS.filter(f => !f.wide).map(f => (
                  <label key={f.key} className="block">
                    <span className="text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">{f.label}</span>
                    <input
                      value={(form[f.key] as string) || ''}
                      placeholder={f.placeholder}
                      onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-[8px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[12px]"
                    />
                  </label>
                ))}
              </div>
              {FIELDS.filter(f => f.wide).map(f => (
                <label key={f.key} className="block">
                  <span className="text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">{f.label}</span>
                  <input
                    value={(form[f.key] as string) || ''}
                    placeholder={f.placeholder}
                    onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    className={'w-full mt-0.5 px-2.5 py-1.5 rounded-[8px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[12px] ' + (f.key === 'smiles' ? 'font-mono' : '')}
                  />
                </label>
              ))}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                <Button size="sm" className="!bg-transparent !border !border-[var(--border-medium)]" onClick={() => { setEditing(false); setForm(drug || {}); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              {!drug ? (
                <div className="text-[11px] text-[var(--text-secondary)]">
                  No investigational product recorded for this trial.
                  {writable && <> <button className="text-[var(--accent)] underline" onClick={() => setEditing(true)}>Add one</button></>}
                </div>
              ) : (
                <>
                  <div className="flex gap-4 flex-wrap">
                    {structUrl && (
                      <div className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={structUrl} alt={`Structure of ${drug.name || 'compound'}`}
                             className="w-[160px] h-[160px] rounded-[8px] border border-[var(--border-subtle)]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-[240px] grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {FIELDS.filter(f => f.key !== 'smiles' && f.key !== 'notes').map(f => (
                        drug[f.key] ? (
                          <div key={f.key}>
                            <p className="text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">{f.label}</p>
                            <p className="text-[11.5px]">{drug[f.key] as string}</p>
                          </div>
                        ) : null
                      ))}
                    </div>
                  </div>

                  {chem && (
                    chem.valid ? (
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1.5">
                          Computed from structure
                        </p>
                        <div className="grid grid-cols-4 gap-2">
                          <Chip label="Formula" value={chem.formula} />
                          <Chip label="MW" value={chem.molecular_weight?.toFixed(2)} />
                          <Chip label="logP" value={chem.logp?.toFixed(2)} />
                          <Chip label="TPSA" value={chem.tpsa?.toFixed(1)} />
                          <Chip label="HBD" value={String(chem.hbd)} />
                          <Chip label="HBA" value={String(chem.hba)} />
                          <Chip label="Rot. bonds" value={String(chem.rotatable_bonds)} />
                          <Chip label="Arom. rings" value={String(chem.aromatic_rings)} />
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {chem.lipinski_pass
                            ? <Pill accent="green" className="!text-[9px] !py-0.5"><Check className="w-2.5 h-2.5 inline mr-0.5" />Lipinski Ro5</Pill>
                            : <Pill accent="orange" className="!text-[9px] !py-0.5">Ro5: {chem.lipinski_violations?.join(', ')}</Pill>}
                          {chem.inchikey && (
                            <span className="text-[9px] font-mono text-[var(--text-secondary)]">{chem.inchikey}</span>
                          )}
                        </div>
                        <p className="text-[9px] text-[var(--text-secondary)]/70 mt-1.5 leading-relaxed">
                          These are deterministic computations over the structure you entered. The system
                          cannot verify that the structure corresponds to the name recorded above.
                        </p>
                      </div>
                    ) : drug.smiles ? (
                      <div className="flex items-center gap-2 text-[11px] text-[#FF3B30]">
                        <X className="w-3.5 h-3.5" /> Structure not accepted: {chem.error}
                      </div>
                    ) : null
                  )}

                  {writable && (
                    <Button size="sm" className="!bg-transparent !border !border-[var(--border-medium)]" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  )}
                </>
              )}
            </>
          )}

          {evidence && (
            <div className="rounded-[10px] border border-[var(--border-subtle)] p-3">
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="w-3.5 h-3.5 text-[var(--accent)]" />
                <p className="text-[11.5px] font-semibold">Evidence summary</p>
              </div>

              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">What was observed</p>
              <ul className="space-y-1 mb-3">
                {evidence.observations.map((o, i) => (
                  <li key={i} className="text-[11px] leading-relaxed pl-3 border-l-2 border-[var(--border-subtle)]">{o}</li>
                ))}
              </ul>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-[8px] bg-[#34C759]/10 p-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[#1a7a35] mb-1">This data can establish</p>
                  <p className="text-[10.5px] text-[var(--text-primary)] leading-relaxed">{evidence.can_conclude}</p>
                </div>
                <div className="rounded-[8px] bg-[#FF9500]/10 p-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[#8a5200] mb-1">This data cannot establish</p>
                  <p className="text-[10.5px] text-[var(--text-primary)] leading-relaxed">{evidence.cannot_conclude}</p>
                </div>
              </div>

              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">Why — specific missing inputs</p>
              <ul className="space-y-1">
                {evidence.limits.map((l, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertCircle className="w-3 h-3 text-[var(--text-secondary)] shrink-0 mt-0.5" />
                    <span className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--skeleton-bg)] px-2.5 py-1.5">
      <p className="text-[9px] text-[var(--text-secondary)]">{label}</p>
      <p className="text-[11.5px] font-medium tabular-nums truncate" title={value}>{value ?? '—'}</p>
    </div>
  );
}
