'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackendConnection } from '@/app/dashboard/components/BackendConnection';
import AppBar from './components/AppBar';
import AppErrorBoundary from '@/app/dashboard/components/AppErrorBoundary';
import { useAuth } from '@/lib/auth';
import { OnboardingProvider } from '@/lib/onboarding';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function AuthGate({ children }: { children: React.ReactNode }) {
  const [licenseChecking, setLicenseChecking] = useState(true);
  const [licenseValid, setLicenseValid] = useState(false);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

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

  // AppBar sits inside the providers but outside {children}, so it is mounted
  // once for the whole dashboard segment and survives every navigation.
  return (
    <OnboardingProvider>
      <AppBar />
      {children}
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
