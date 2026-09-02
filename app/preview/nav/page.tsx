'use client';

/**
 * Renders the real navigation shell outside the dashboard's auth gate.
 *
 * The rail and the header are on every screen, which made them the two pieces
 * that could not be looked at while being changed — they need an account, a
 * licence and a reachable backend. This mounts the actual components with the
 * actual stylesheet, so the travelling indicator, the Control Centre panel and
 * the theme control can be seen rather than assumed.
 *
 * Not part of the product. Returns 404 in a production build.
 */

import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import Sidebar from '../../dashboard/components/Sidebar';
import TopBar from '../../dashboard/components/TopBar';

export default function NavPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <div className="flex min-h-screen bg-[var(--bg-primary)]">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <TopBar />
            <div className="max-w-[1200px] px-7 py-8">
              <p className="text-[13px] text-[var(--text-secondary)]">
                Navigation preview — no account, so only the always-visible
                sections render.
              </p>
            </div>
          </div>
        </div>
      </OnboardingProvider>
    </AuthProvider>
  );
}
