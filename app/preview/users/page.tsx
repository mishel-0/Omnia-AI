'use client';

/**
 * Renders the real user administration screen, in the real shell.
 *
 * The sample covers what a fresh install cannot show: an account that has
 * never been signed into, one that has been deactivated, and the signed-in
 * administrator's own row, which must refuse to deactivate itself.
 *
 * Not part of the product; 404 in a production build.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import { DialogProvider } from '@/lib/dialogs';
import Shell from '../../dashboard/components/Shell';
import UsersPage from '../../dashboard/users/page';

const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString();

const USER = { id: 'u1', username: 'm.adnan', full_name: 'Dr Mishel Adnan', role: 'admin' };
const USERS = [
  { ...USER, active: true, created: ago(90000), last_login: ago(0) },
  { id: 'u2', username: 's.johnson', full_name: 'Dr Sarah Johnson', role: 'pathologist', active: true, created: ago(80000), last_login: ago(120) },
  { id: 'u3', username: 'a.khan',    full_name: 'Dr Ahmed Khan',    role: 'pathologist', active: true, created: ago(70000), last_login: ago(300) },
  { id: 'u4', username: 'e.davis',   full_name: 'Emily Davis',      role: 'monitor',     active: false, created: ago(60000), last_login: ago(2880) },
  { id: 'u5', username: 'm.brown',   full_name: 'Michael Brown',    role: 'sponsor',     active: true, created: ago(50), last_login: '' },
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
    if (url.includes('/api/users/me')) return Promise.resolve(json(USER));
    if (url.includes('/api/users/')) return Promise.resolve(json(USERS));
    return real(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function UsersPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  installStub();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <DialogProvider>
          <Shell>
              <UsersPage />
        </Shell>
        </DialogProvider>
      </OnboardingProvider>
    </AuthProvider>
  );
}
