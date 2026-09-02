'use client';

/**
 * Renders the real trial register, in the real shell, against sample trials.
 *
 * The sample covers the three statuses and, deliberately, the case the mockup
 * could not show: a running trial has no end date, so it renders a dash rather
 * than a projected one. Every study is prostate, because that is the only
 * tissue this suite grades.
 *
 * Not part of the product; 404 in a production build.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import Sidebar from '../../dashboard/components/Sidebar';
import TopBar from '../../dashboard/components/TopBar';
import TrialsPage from '../../dashboard/trials/page';

const TRIALS = [
  { id: 't1', name: 'Neoadjuvant Prostate AI Study', protocol_id: 'TRI-2026-0012', phase: 'Phase II',
    sponsor: 'Sponsor A', drug: 'Compound-1', indication: 'Non-metastatic CRPC', sites: ['Vilnius'],
    status: 'active', patient_count: 48, slides_analyzed: 190, slides_confirmed: 150,
    created: '2026-08-12T09:00:00', ended: '' },
  { id: 't2', name: 'Active Surveillance Cohort', protocol_id: 'TRI-2026-0009', phase: 'Phase I',
    sponsor: 'Sponsor B', drug: 'Compound-2', indication: 'Localised prostate cancer', sites: ['Riga'],
    status: 'active', patient_count: 32, slides_analyzed: 88, slides_confirmed: 88,
    created: '2026-07-05T09:00:00', ended: '' },
  { id: 't3', name: 'Radical Prostatectomy Grading', protocol_id: 'TRI-2025-0011', phase: 'Phase III',
    sponsor: 'Sponsor C', drug: 'Compound-3', indication: 'Localised prostate cancer', sites: ['Tartu'],
    status: 'closed', patient_count: 120, slides_analyzed: 402, slides_confirmed: 402,
    created: '2025-03-10T09:00:00', ended: '2026-06-20T09:00:00' },
  { id: 't4', name: 'Prostate Biomarker Substudy', protocol_id: 'TRI-2025-0007', phase: 'Phase II',
    sponsor: 'Sponsor A', drug: 'Compound-1', indication: 'Metastatic prostate cancer', sites: ['Gdansk'],
    status: 'on_hold', patient_count: 25, slides_analyzed: 60, slides_confirmed: 41,
    created: '2025-05-18T09:00:00', ended: '' },
  { id: 't5', name: 'Prostate Screening Pilot', protocol_id: 'TRI-2024-0003', phase: 'Phase II',
    sponsor: 'Sponsor D', drug: 'Compound-4', indication: 'Localised prostate cancer', sites: ['Vilnius'],
    status: 'closed', patient_count: 64, slides_analyzed: 210, slides_confirmed: 210,
    created: '2024-01-15T09:00:00', ended: '2025-04-30T09:00:00' },
];

const USER = { id: 'u1', username: 'm.adnan', full_name: 'Dr Mishel Adnan', role: 'admin' };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let installed = false;
function installStub() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/trials/')) return Promise.resolve(json(TRIALS));
    if (url.includes('/api/users/me')) return Promise.resolve(json(USER));
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function TrialsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  installStub();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <div className="flex min-h-screen bg-[var(--bg-primary)]">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <TopBar />
            <TrialsPage />
          </div>
        </div>
      </OnboardingProvider>
    </AuthProvider>
  );
}
