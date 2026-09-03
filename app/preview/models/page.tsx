'use client';

/**
 * Renders the real model registry against a sample lineage.
 *
 * The sample deliberately includes a run that did *not* beat the baseline,
 * because a registry that only shows winners hides how often adaptation fails
 * to help — and that row is the one most likely to be got wrong.
 *
 * Not part of the product; 404 in a production build.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import Shell from '../../dashboard/components/Shell';
import ModelsPage from '../../dashboard/models/page';

const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

const ACTIVE = {
  source: 'finetuned', path: '/x.pt', qwk: 0.8241, baseline_qwk: 0.7996,
  examples_used: 412, activated: ago(2),
  description: 'Adapted to this site using slides your pathologists have signed.',
};
const RUNS = [
  { id: 'r3', state: 'completed', started_at: ago(2), finished_at: ago(2),
    baseline_qwk: 0.7996, finetuned_qwk: 0.8241, selection_qwk: 0.8390, examples_used: 412, improved: true },
  { id: 'r2', state: 'completed', started_at: ago(9), finished_at: ago(9),
    baseline_qwk: 0.7996, finetuned_qwk: 0.7903, selection_qwk: 0.8102, examples_used: 260, improved: false },
  { id: 'r1', state: 'failed', started_at: ago(21), finished_at: ago(21) },
];
const USER = { id: 'u1', username: 'm.adnan', full_name: 'Dr Mishel Adnan', role: 'admin' };

function json(b: unknown) {
  return new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
let installed = false;
function installStub() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/training/model')) return Promise.resolve(json(ACTIVE));
    if (url.includes('/api/training/runs')) return Promise.resolve(json(RUNS));
    if (url.includes('/api/users/me')) return Promise.resolve(json(USER));
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function ModelsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  installStub();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <Shell>
            <ModelsPage />
        </Shell>
      </OnboardingProvider>
    </AuthProvider>
  );
}
