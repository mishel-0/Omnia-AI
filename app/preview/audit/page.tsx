'use client';

/**
 * Renders the real audit trail, in the real shell, against sample events.
 *
 * The sample deliberately includes the cases that are easy to get wrong and
 * impossible to see with a fresh database: an entry from a background worker
 * with no request behind it (so no origin), one from a user who no longer
 * exists (so no role), and one of every action colour.
 *
 * Not part of the product; 404 in a production build.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import Shell from '../../dashboard/components/Shell';
import AuditPage from '../../dashboard/audit/page';

const now = Date.now();
const at = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();

const EVENTS = [
  { id: '1', timestamp: at(12),   user_id: 'u1', username: 'm.adnan', action: 'create',       entity_type: 'patient', entity_id: 'OMN-7K45-KGKM', trial_id: null, details: 'Patient registered', ip: '192.168.1.24' },
  { id: '2', timestamp: at(38),   user_id: 'u2', username: 's.johnson', action: 'analyze',    entity_type: 'slide',   entity_id: 'SLD-2026-0001', trial_id: null, details: 'Slide analysed', ip: '192.168.1.18' },
  { id: '3', timestamp: at(95),   user_id: 'u3', username: 'a.khan',  action: 'update',       entity_type: 'trial',   entity_id: 'TRI-2026-0092', trial_id: null, details: 'Trial status updated', ip: '192.168.1.35' },
  { id: '4', timestamp: at(160),  user_id: 'u4', username: 'e.davis', action: 'sign_confirm', entity_type: 'slide',   entity_id: 'SLD-2026-0004', trial_id: null, details: 'Grade confirmed by the reporting pathologist', ip: '192.168.1.22' },
  { id: '5', timestamp: at(240),  user_id: 'u1', username: 'm.adnan', action: 'gdpr_erase',   entity_type: 'patient', entity_id: 'OMN-5NB8-ZT2Q', trial_id: null, details: 'Subject erased under Article 17', ip: '192.168.1.24' },
  { id: '6', timestamp: at(300),  user_id: 'u2', username: 's.johnson', action: 'raise_query',entity_type: 'query',   entity_id: 'Q-0014', trial_id: null, details: 'Query raised on discordant grade', ip: '192.168.1.18' },
  // No request behind it, so no origin — and a user that no longer exists, so no role.
  { id: '7', timestamp: at(420),  user_id: null, username: 'system',  action: 'train_start',  entity_type: 'training', entity_id: 'run-2026-08-31', trial_id: null, details: 'Scheduled fine-tune started by the supervisor', ip: '' },
  { id: '8', timestamp: at(1500), user_id: 'u9', username: 'r.olsen', action: 'login',        entity_type: 'user',    entity_id: 'u9', trial_id: null, details: 'Signed in', ip: '192.168.1.51' },
];

const USER = { id: 'u1', username: 'm.adnan', full_name: 'Dr Mishel Adnan', role: 'admin' };
const USERS = [
  USER,
  { id: 'u2', username: 's.johnson', full_name: 'Sarah Johnson', role: 'pathologist' },
  { id: 'u3', username: 'a.khan', full_name: 'Ahmed Khan', role: 'pathologist' },
  { id: 'u4', username: 'e.davis', full_name: 'Emily Davis', role: 'admin' },
];

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
    if (url.includes('/api/audit/export-csv')) return Promise.resolve(json({}));
    if (url.includes('/api/audit/')) return Promise.resolve(json(EVENTS));
    if (url.includes('/api/users/me')) return Promise.resolve(json(USER));
    if (url.includes('/api/users/')) return Promise.resolve(json(USERS));
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function AuditPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  installStub();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <Shell>
            <AuditPage />
        </Shell>
      </OnboardingProvider>
    </AuthProvider>
  );
}
