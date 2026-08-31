'use client';

import React, { useEffect, useState } from 'react';
import { Network, ShieldCheck, Send, Lock, FileText, X, CheckCircle2 } from 'lucide-react';
import { Card, Button, Pill } from '@/components/ui';
import { apiFetch, apiSend } from '@/lib/auth';
import { useToast } from '@/lib/toast';

interface NetworkStatus {
  configured: boolean;
  has_local_finetune: boolean;
  local_val_qwk: number | null;
  sample_count: number | null;
  terms_version: string;
}

/** The federated-learning diagram: a packet travels from "this device" into
 * the shared hub, and a second travels back out toward other sites — the
 * whole shape of what federated training is, before a single word of
 * explanation. Paths are plain SVG; motion runs on CSS offset-path (see
 * globals.css) so it degrades to a static diagram under
 * prefers-reduced-motion instead of breaking. */
function FederatedDiagram() {
  const outPath = 'M 40 70 C 100 70, 130 70, 170 70';
  const inPath = 'M 170 70 C 210 70, 240 40, 280 40';
  const inPath2 = 'M 170 70 C 210 70, 240 100, 280 100';

  return (
    <div className="relative w-full h-[150px] select-none">
      <svg viewBox="0 0 320 140" className="w-full h-full" fill="none">
        {/* connecting lines, drawn once, static */}
        <path d={outPath} stroke="var(--border-medium)" strokeWidth="1.5" />
        <path d={inPath} stroke="var(--border-medium)" strokeWidth="1.5" />
        <path d={inPath2} stroke="var(--border-medium)" strokeWidth="1.5" />

        {/* this device */}
        <circle cx="30" cy="70" r="18" fill="var(--bg-card-solid)" stroke="#007AFF" strokeWidth="2" />
        <text x="30" y="74" textAnchor="middle" fontSize="9" fontWeight="700" fill="#007AFF">You</text>

        {/* other sites, faint — they exist but this device never sees who they are */}
        <circle cx="290" cy="40" r="13" fill="var(--bg-card-solid)" stroke="var(--border-medium)" strokeWidth="1.5" />
        <circle cx="290" cy="100" r="13" fill="var(--bg-card-solid)" stroke="var(--border-medium)" strokeWidth="1.5" />
      </svg>

      {/* hub, pulsing, positioned over the SVG's (170,70) */}
      <div
        className="absolute w-11 h-11 rounded-full bg-[var(--bg-card-solid)] border-2 border-[#34C759] flex items-center justify-center animate-hub-pulse"
        style={{ left: 'calc(170 / 320 * 100%)', top: 'calc(70 / 140 * 100%)', transform: 'translate(-50%, -50%)' }}
      >
        <Network className="w-4 h-4 text-[#34C759]" />
      </div>

      {/* moving packets */}
      <div
        className="absolute w-2 h-2 rounded-full bg-[#007AFF] animate-network-flow-out"
        style={{
          left: 0, top: 0,
          ['--flow-path-out' as string]: `"${outPath.replace(/"/g, "'")}"`,
          offsetRotate: '0deg',
        } as React.CSSProperties}
      />
      <div
        className="absolute w-2 h-2 rounded-full bg-[#34C759] animate-network-flow-in"
        style={{
          left: 0, top: 0, animationDelay: '1.3s',
          ['--flow-path-in' as string]: `"${inPath.replace(/"/g, "'")}"`,
          offsetRotate: '0deg',
        } as React.CSSProperties}
      />
    </div>
  );
}

const TERMS_TEXT = [
  {
    heading: 'What actually leaves this device',
    body: 'Only the small file of adjusted model weights produced by a local training run on this device — never a slide image, never a patient identifier, never any field from a patient record. The upload is the numerical weights of two small neural network layers (roughly 1–2 MB); it does not contain anything that can be decoded back into a slide or a name.',
  },
  {
    heading: 'What the model weights can and cannot reveal',
    body: 'Model weights are not a copy of your data — they are the result of adjusting a small set of numbers based on it. No serious method exists to reconstruct a specific patient’s slide from weights this small and this constrained. Omnia does not claim a formal information-theoretic guarantee beyond that, and does not represent this as anonymisation of patient data, because no data is transmitted in the first place.',
  },
  {
    heading: 'What happens after you send it',
    body: 'Your contribution is stored, unmerged, until an Omnia operator manually reviews it alongside contributions from other sites and averages them into a new shared model version. Nothing is merged automatically. A merged version only replaces what you use locally if you choose to pull and apply it — sending a contribution does not change the model running on this device.',
  },
  {
    heading: 'Consent and withdrawal',
    body: 'Sending a contribution is optional and this device will function identically whether or not you ever use this feature. Each contribution is tied to the consent you give at the moment you press Send, recorded in this installation’s audit trail with the terms version shown here. You can ask Omnia to delete a specific contribution from the pending queue before it has been merged into a published release; a contribution already merged into a published model cannot be individually extracted back out, in the same way an average cannot be decomposed back into its inputs.',
  },
  {
    heading: 'Data protection basis',
    body: 'Because no personal data is transmitted, this action does not itself constitute a transfer of personal data under GDPR. Your organisation remains the data controller for all patient data at all times, which never leaves this device through this feature or any other part of Omnia. This statement describes this specific action only and is not a substitute for your organisation’s own data protection assessment of Omnia as a whole.',
  },
];

export default function NetworkPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [sent, setSent] = useState<{ contribution_id: string } | null>(null);

  useEffect(() => {
    apiFetch('/api/training/network/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  const send = async () => {
    if (!status || !agreed) return;
    setSending(true);
    try {
      const result = await apiSend('/api/training/network/contribute', {
        method: 'POST',
        body: JSON.stringify({ consented: true, terms_version: status.terms_version }),
      });
      setSent(result);
      toast.show('Sent to the Omnia Network — logged to the audit trail', 'success');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not send to the Omnia Network', 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) return null;

  const canSend = !!status?.configured && !!status?.has_local_finetune && agreed && !sending;

  return (
    <Card size="sm" className="p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-[10px] bg-[#34C759]/10 flex items-center justify-center shrink-0">
          <Network className="w-[18px] h-[18px] text-[#34C759]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[14px] font-semibold">Omnia Network</h2>
            <Pill accent={status?.configured ? 'green' : 'gray'}>
              {status?.configured ? 'Configured' : 'Not configured'}
            </Pill>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed max-w-[620px]">
            Contribute this device&rsquo;s local fine-tune to a shared model trained across every
            participating Omnia site, without any site ever seeing another site&rsquo;s data.
          </p>

          <FederatedDiagram />

          <div className="grid sm:grid-cols-2 gap-3 mt-1">
            <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-3">
              <p className="text-[12px] font-semibold flex items-center gap-1.5">
                What federated training is
              </p>
              <p className="text-[11.5px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Every participating site trains on its own slides, locally. Only the resulting
                adjustments — never the slides — are combined into one shared model. Each site
                benefits from every other site&rsquo;s corrections without any site&rsquo;s data
                ever leaving its building.
              </p>
            </div>
            <div className="rounded-[10px] border border-[#34C759]/30 bg-[#34C759]/[0.06] px-3.5 py-3">
              <p className="text-[12px] font-semibold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#34C759]" />
                What is sent — and what is not
              </p>
              <p className="text-[11.5px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                Sent: the corrected model&rsquo;s adjusted weights only (~1–2 MB).<br />
                Never sent: slide images, patient identifiers, or any field from a patient
                record. This device makes no exception to that for this feature.
              </p>
            </div>
          </div>

          {!status?.configured && (
            <p className="text-[11px] text-[var(--text-secondary)] mt-3">
              This installation has not been set up with an Omnia Network address and site key yet.
            </p>
          )}
          {status?.configured && !status?.has_local_finetune && (
            <p className="text-[11px] text-[var(--text-secondary)] mt-3">
              No local fine-tune to send yet — train a model on this device&rsquo;s reviewed slides
              first, above.
            </p>
          )}

          {status?.configured && status?.has_local_finetune && (
            <div className="mt-4 flex items-center justify-between flex-wrap gap-3 rounded-[10px] border border-[var(--border-subtle)] px-3.5 py-3">
              <div className="text-[11.5px] text-[var(--text-secondary)]">
                Ready to send: local fine-tune built from{' '}
                <strong className="text-[var(--text-primary)] tabular-nums">{status.sample_count}</strong>{' '}
                reviewed slides, agreement{' '}
                <strong className="text-[var(--text-primary)] tabular-nums">
                  {status.local_val_qwk?.toFixed(3) ?? '—'}
                </strong>.
              </div>
              {sent ? (
                <span className="text-[12px] font-medium text-[#34C759] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Sent
                </span>
              ) : (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="w-3.5 h-3.5"
                    />
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setShowTerms(true); }}
                      className="underline text-[#007AFF] hover:text-[#0060df]"
                    >
                      Omnia Network terms
                    </button>
                  </label>
                  <Button size="sm" onClick={send} disabled={!canSend}>
                    <Send className="w-3.5 h-3.5" /> Send to Omnia Network
                  </Button>
                </div>
              )}
            </div>
          )}

          <p className="text-[10.5px] text-[var(--text-secondary)] mt-3 flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3" />
            Every contribution and consent is recorded in this installation&rsquo;s audit trail —
            not just this button click.
          </p>
        </div>
      </div>

      {showTerms && status && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4"
          onClick={() => setShowTerms(false)}
        >
          <Card
            size="lg"
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto custom-scrollbar p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#007AFF]" />
                <h3 className="text-[14px] font-semibold">
                  Omnia Network terms — {status.terms_version}
                </h3>
              </div>
              <button onClick={() => setShowTerms(false)} className="p-1 rounded hover:bg-[var(--skeleton-bg)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4">
              {TERMS_TEXT.map((section) => (
                <div key={section.heading}>
                  <p className="text-[12.5px] font-semibold">{section.heading}</p>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                    {section.body}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowTerms(false)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => { setAgreed(true); setShowTerms(false); }}
              >
                I agree
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}
