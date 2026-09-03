'use client';

/**
 * Renders the real patient registry, with the real shell, against sample data.
 *
 * The registry needs an account, a licence and a backend, which made the one
 * screen people spend the most time in also the hardest to look at while
 * changing it. Rather than rebuild the table here — a copy would drift from
 * the real one and stop being evidence of anything — this stubs `fetch` for
 * the two endpoints the page and the auth provider call, and mounts the
 * genuine component above it.
 *
 * The sample identifiers are deliberately not real Crockford-checksummed IDs
 * the application would mint, and the initials are letters rather than
 * anything that could be mistaken for a person. Not part of the product;
 * returns 404 in a production build.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import Shell from '../../dashboard/components/Shell';
import PatientRegistry from '../../dashboard/patients/page';

const SAMPLE = [
  { uid: 'OMN-7K45-KGKM', initials: 'M',  year_of_birth: 2006, sex: 'male',   site: '',        notes: '', created: '2026-08-27T10:00:00' },
  { uid: 'OMN-2QT9-XR4B', initials: 'AB', year_of_birth: 1958, sex: 'male',   site: 'Vilnius', notes: '', created: '2026-08-14T09:12:00' },
  { uid: 'OMN-9WD3-PL7H', initials: 'CD', year_of_birth: 1971, sex: 'female', site: 'Riga',    notes: '', created: '2026-07-30T15:40:00' },
  { uid: 'OMN-5NB8-ZT2Q', initials: '',   year_of_birth: null, sex: '',       site: 'Tartu',   notes: '', created: '2026-07-02T11:05:00', redacted: true },
];

const USER = { id: 'u1', username: 'preview', full_name: 'Dr Mishel Adnan', role: 'admin' };

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

let installed = false;
function installStub() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/patients/')) return Promise.resolve(json(SAMPLE));
    if (url.includes('/api/users/me')) return Promise.resolve(json(USER));
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PatientsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  installStub();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <Shell>
            <PatientRegistry />
        </Shell>
      </OnboardingProvider>
    </AuthProvider>
  );
}
