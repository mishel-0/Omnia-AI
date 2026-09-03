'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BackendConnection } from '@/app/dashboard/components/BackendConnection';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import AppErrorBoundary from '@/app/dashboard/components/AppErrorBoundary';
import { useAuth } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function AuthGate({ children }: { children: React.ReactNode }) {
  const [licenseChecking, setLicenseChecking] = useState(true);
  const [licenseValid, setLicenseValid] = useState(false);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    const setupDone = (() => {
      try { return localStorage.getItem('omnia_setup_complete') === 'true'; } catch { return false; }
    })();
    if (!setupDone) {
      router.push('/install');
      return;
    }

    fetch(`${API_BASE}/api/license/status`)
      .then(r => r.json())
      .then(data => {
        if (!data.valid) {
          router.push('/login');
        } else {
          setLicenseValid(true);
          setLicenseChecking(false);
        }
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  useEffect(() => {
    if (licenseValid && !authLoading && !user) {
      router.push('/login');
    }
  }, [licenseValid, authLoading, user, router]);

  if (licenseChecking || (licenseValid && (authLoading || !user))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-[var(--text-secondary)]">Loading...</p>
      </div>
    );
  }

  // The rail and the header sit inside the providers but outside {children},
  // so they are mounted once for the whole dashboard segment and survive every
  // navigation — only the page below them swaps.
  return (
    <OnboardingProvider>
      {/* The window's own ground shows through as a margin around both panels.
          That margin is what the frosted surfaces pick up — glass over an
          opaque fill of the same colour is just a lighter opaque fill. */}
      <div className="flex min-h-screen gap-2.5 p-2.5 bg-[var(--shell-bg)]">
        <Sidebar />
        <div className="shell-panel flex-1 min-w-0 flex flex-col rounded-[26px]">
          <TopBar />
      {/* Keyed on the path so React treats each section as a new element and
          restarts the animation. The wrapper is what animates, not the page's
          contents — one compositor-only fade on a single node, rather than a
          transition on the hundreds of cards inside it. */}
          <div key={pathname} className="page-in flex-1 min-w-0">
            {children}
          </div>
        </div>
      </div>
    </OnboardingProvider>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppErrorBoundary>
      <BackendConnection>
        <AuthGate>{children}</AuthGate>
      </BackendConnection>
    </AppErrorBoundary>
  );
}
