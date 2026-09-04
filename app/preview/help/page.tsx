'use client';

/**
 * Renders the real Help screen against a machine whose checks partly fail,
 * because a status panel where everything passes proves the least.
 *
 * Not part of the product; 404 in a production build.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import Shell from '../../dashboard/components/Shell';
import HelpPage from '../../dashboard/help/page';

const PREFLIGHT = { checks: [
  { key: 'grading', label: 'Grading is real', ok: true, detail: 'Slides are graded by the bundled model.', fatal: true },
  { key: 'model', label: 'Model checkpoint', ok: true, detail: 'omnia_prostate_v1.pt loaded (48 MB).', fatal: true },
  { key: 'torch', label: 'Inference engine', ok: true, detail: 'torch 2.6.0 (cpu).', fatal: true },
  { key: 'openslide', label: 'Slide reader', ok: false, detail: 'OpenSlide loaded, but no vendor driver for .mrxs.', fatal: false },
  { key: 'storage', label: 'Data directory', ok: true, detail: 'Writable, 214 GB free.', fatal: true },
] };
const HEALTH = { status: 'ok', version: '1.18.0' };
const USER = { id: 'u1', username: 'm.adnan', full_name: 'Dr Mishel Adnan', role: 'admin' };
const CHANGELOG = { version: '1.18.0', markdown: '# Changelog\n\n## 1.18.0 — 2026-09-03\n\n- Help screen: guided tour, live status of this machine, and a diagnostics\n  file containing no patient data.\n- Removed the support channels that could not exist on an offline machine.\n' };

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
    if (url.includes('/api/system/preflight')) return Promise.resolve(json(PREFLIGHT));
    if (url.includes('/api/system/changelog')) return Promise.resolve(json(CHANGELOG));
    if (url.includes('/health')) return Promise.resolve(json(HEALTH));
    if (url.includes('/api/users/me')) return Promise.resolve(json(USER));
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function HelpPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  installStub();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <Shell><HelpPage /></Shell>
      </OnboardingProvider>
    </AuthProvider>
  );
}
