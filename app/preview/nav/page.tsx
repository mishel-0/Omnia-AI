'use client';

/**
 * Renders the real AppBar outside the dashboard's auth gate.
 *
 * The bar only exists under /dashboard, which needs an account, a licence and
 * a reachable backend — so the one piece of chrome that is on every screen was
 * also the piece that could not be looked at while changing it. This mounts
 * the actual component, with the actual stylesheet, so the sliding indicator
 * and the theme switch can be seen moving rather than assumed to move.
 *
 * Not part of the product. Returns 404 in a production build.
 */

import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';
import AppBar from '../../dashboard/components/AppBar';

export default function NavPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <AuthProvider>
      <OnboardingProvider>
        <div className="min-h-screen bg-[var(--bg-primary)]">
          <AppBar />
          <div className="max-w-4xl mx-auto px-6 py-10 space-y-3">
            <p className="text-[13px] text-[var(--text-secondary)]">
              AppBar preview — no account, so only the always-visible sections render.
            </p>
          </div>
        </div>
      </OnboardingProvider>
    </AuthProvider>
  );
}
