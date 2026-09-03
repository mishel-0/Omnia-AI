'use client';

/**
 * How a model improves across sites, as a moving diagram.
 *
 * The thing people get wrong about federated training is the direction of
 * travel — they assume slides go somewhere. So the animation is built around
 * the one fact that matters: what leaves this machine is a small file of
 * adjusted weights, and what comes back is an averaged model. Slides never
 * appear in the diagram, because they never leave, and the caption says so
 * rather than leaving the picture to imply it.
 *
 * The four phases loop: sites train locally, weights travel inward, the hub
 * averages them, the merged model travels back out. Each phase is labelled
 * while it runs, so the motion is explanatory rather than decorative — an
 * animation nobody can narrate is a screensaver.
 *
 * Everything animates on transform and opacity, and the whole thing stops
 * under prefers-reduced-motion, where it falls back to the labelled diagram
 * with no movement at all.
 */

import React, { useEffect, useState } from 'react';
import { Network, ShieldCheck, Building2 } from 'lucide-react';
import { Card } from '@/components/ui';

const PHASES = [
  { key: 'train',  label: 'Each site trains on its own slides',
    detail: 'Slides stay on the machine that holds them. Nothing has left yet.' },
  { key: 'send',   label: 'Adjusted weights travel to the hub',
    detail: 'Roughly 1–2 MB of numbers — no image, no identifier, no record field.' },
  { key: 'merge',  label: 'Contributions are averaged into one model',
    detail: 'Reviewed by an operator first. Nothing is merged automatically.' },
  { key: 'return', label: 'The merged model comes back',
    detail: 'And only replaces what you use here if you choose to apply it.' },
] as const;

const SITES = [
  { cx: 44,  cy: 40,  label: 'Site A' },
  { cx: 44,  cy: 150, label: 'Site B' },
  { cx: 300, cy: 40,  label: 'Site C' },
  { cx: 300, cy: 150, label: 'You' },
];
const HUB = { cx: 172, cy: 95 };

export default function FederatedGraphic() {
  const [phase, setPhase] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => setPhase(p => (p + 1) % PHASES.length), 2600);
    return () => window.clearInterval(t);
  }, [reduced]);

  const current = PHASES[phase];
  const sending = !reduced && current.key === 'send';
  const merging = !reduced && current.key === 'merge';
  const returning = !reduced && current.key === 'return';
  const training = !reduced && current.key === 'train';

  return (
    <Card size="md" className="p-5 overflow-hidden">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <div>
          <h2 className="text-[15px] font-semibold">Federated training</h2>
          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 max-w-[560px] leading-relaxed">
            Optional. This installation grades identically whether or not it ever takes part.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold bg-[#34C759]/12 text-[#248A3D] shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          Slides never leave this machine
        </span>
      </div>

      <svg viewBox="0 0 344 190" className="w-full h-[210px]" fill="none"
           role="img" aria-label={`Federated training: ${current.label}. ${current.detail}`}>
        <defs>
          <linearGradient id="fed-link" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.05" />
            <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {SITES.map((s, i) => {
          const d = `M ${s.cx} ${s.cy} Q ${(s.cx + HUB.cx) / 2} ${(s.cy + HUB.cy) / 2 + (s.cy < HUB.cy ? 18 : -18)} ${HUB.cx} ${HUB.cy}`;
          return (
            <g key={s.label}>
              <path d={d} stroke="url(#fed-link)" strokeWidth="1.5" />
              {/* Weights travelling. Direction is the whole point, so the
                  outbound and inbound packets are different colours and never
                  run at the same time. */}
              {sending && (
                <circle r="3.5" fill="var(--accent)">
                  <animateMotion dur="1.5s" repeatCount="indefinite" path={d}
                                 begin={`${i * 0.18}s`} />
                  <animate attributeName="opacity" values="0;1;1;0" dur="1.5s"
                           repeatCount="indefinite" begin={`${i * 0.18}s`} />
                </circle>
              )}
              {returning && (
                <circle r="3.5" fill="#34C759">
                  <animateMotion dur="1.5s" repeatCount="indefinite" path={d}
                                 keyPoints="1;0" keyTimes="0;1" calcMode="linear"
                                 begin={`${i * 0.18}s`} />
                  <animate attributeName="opacity" values="0;1;1;0" dur="1.5s"
                           repeatCount="indefinite" begin={`${i * 0.18}s`} />
                </circle>
              )}
            </g>
          );
        })}

        {SITES.map(s => {
          const you = s.label === 'You';
          return (
            <g key={s.label}>
              <circle cx={s.cx} cy={s.cy} r="21"
                      fill="var(--bg-card-solid)"
                      stroke={you ? 'var(--accent)' : 'var(--border-medium)'}
                      strokeWidth={you ? 2 : 1.5} />
              {/* A site working on its own slides. Only during the training
                  phase, so "busy" never overlaps with "transmitting". */}
              {training && (
                <circle cx={s.cx} cy={s.cy} r="21" fill="none"
                        stroke={you ? 'var(--accent)' : 'var(--border-medium)'} strokeWidth="1.5">
                  <animate attributeName="r" values="21;27;21" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.55;0;0.55" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <text x={s.cx} y={s.cy + 4} textAnchor="middle" fontSize="9.5" fontWeight="700"
                    fill={you ? 'var(--accent)' : 'var(--text-secondary)'}>
                {you ? 'You' : s.label.replace('Site ', '')}
              </text>
            </g>
          );
        })}

        <g>
          <circle cx={HUB.cx} cy={HUB.cy} r="27" fill="var(--bg-card-solid)"
                  stroke="#34C759" strokeWidth="2" />
          {merging && (
            <circle cx={HUB.cx} cy={HUB.cy} r="27" fill="none" stroke="#34C759" strokeWidth="2">
              <animate attributeName="r" values="27;36;27" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0;0.6" dur="1.6s" repeatCount="indefinite" />
            </circle>
          )}
        </g>
      </svg>

      {/* The hub and site glyphs sit over the SVG so they can use the icon set
          rather than hand-drawn paths. */}
      <div className="relative -mt-[210px] h-[210px] pointer-events-none">
        <span className="absolute grid place-items-center"
              style={{ left: `${HUB.cx / 344 * 100}%`, top: `${HUB.cy / 190 * 100}%`, transform: 'translate(-50%,-50%)' }}>
          <Network className="w-[18px] h-[18px] text-[#34C759] -mt-3.5" />
        </span>
        {SITES.filter(s => s.label !== 'You').map(s => (
          <span key={s.label} className="absolute grid place-items-center"
                style={{ left: `${s.cx / 344 * 100}%`, top: `${s.cy / 190 * 100}%`, transform: 'translate(-50%,-50%)' }}>
            <Building2 className="w-3.5 h-3.5 text-[var(--text-secondary)] -mt-3" />
          </span>
        ))}
      </div>

      <div className="mt-2">
        <div className="flex items-center gap-1.5 mb-2">
          {PHASES.map((p, i) => (
            <span key={p.key}
                  className="h-1 rounded-full transition-all duration-500"
                  style={{
                    width: i === phase ? 26 : 12,
                    background: i === phase ? 'var(--accent)' : 'var(--border-medium)',
                  }} />
          ))}
        </div>
        <p className="text-[13px] font-medium">{current.label}</p>
        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
          {current.detail}
        </p>
      </div>
    </Card>
  );
}
