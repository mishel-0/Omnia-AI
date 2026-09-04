'use client';

/**
 * Renders the real Settings screen outside the dashboard's auth gate.
 *
 * Settings sits under /dashboard, so it cannot be looked at without an
 * account and a reachable backend. This mounts the same component with the
 * onboarding provider it expects; its own fetches fail harmlessly and each
 * row falls back to its empty state, which is itself worth being able to see —
 * a settings screen is judged as much on how it reads with nothing loaded as
 * with everything.
 *
 * Not part of the product. Returns 404 in a production build.
 */

import { notFound } from 'next/navigation';
import { OnboardingProvider } from '@/lib/onboarding';
import SettingsPage from '../../dashboard/settings/page';

export default function SettingsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <OnboardingProvider>
      <SettingsPage />
    </OnboardingProvider>
  );
}
