'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Key, User, Lock, UserPlus } from 'lucide-react';
import { Card, Button, BrandMark } from '@/components/ui';
import { useAuth } from '@/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Stage = 'checking' | 'license' | 'auth';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, login, bootstrap } = useAuth();

  const [stage, setStage] = useState<Stage>('checking');
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  // License state
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseStatus, setLicenseStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [licenseMessage, setLicenseMessage] = useState('');

  // Auth state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [authError, setAuthError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const setupDone = (() => {
      try { return localStorage.getItem('omnia_setup_complete') === 'true'; } catch { return false; }
    })();
    if (!setupDone) {
      window.location.href = '/install';
      return;
    }

    fetch(`${API_BASE}/api/license/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setLicenseStatus('valid');
          setLicenseMessage(`Licensed to ${data.organization} — Expires ${data.expires}`);
          checkAuthStage();
        } else {
          setStage('license');
        }
      })
      .catch(() => setStage('license'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authLoading && user && stage !== 'checking') {
      router.push('/dashboard');
    }
  }, [authLoading, user, stage, router]);

  const checkAuthStage = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users/bootstrap-needed`);
      const data = await res.json();
      setNeedsBootstrap(!!data.needed);
    } catch {
      setNeedsBootstrap(false);
    }
    setStage('auth');
  };

  const activateLicense = async () => {
    if (!licenseKey.trim()) return;
    setLicenseStatus('validating');
    try {
      const res = await fetch(`${API_BASE}/api/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: licenseKey.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        setLicenseStatus('valid');
        setLicenseMessage(`Licensed to ${data.organization} — Expires ${data.expires}`);
        await checkAuthStage();
      } else {
        setLicenseStatus('invalid');
        setLicenseMessage(data.message || 'Invalid license key.');
      }
    } catch {
      setLicenseStatus('invalid');
      setLicenseMessage('Could not connect to backend.');
    }
  };

  const submitAuth = async () => {
    setAuthError('');
    if (!username.trim() || !password) return;
    if (needsBootstrap && !fullName.trim()) {
      setAuthError('Full name is required for the administrator account.');
      return;
    }
    setSubmitting(true);
    const result = needsBootstrap
      ? await bootstrap(username.trim(), password, fullName.trim())
      : await login(username.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setAuthError(result.message || 'Something went wrong.');
      return;
    }
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] theme-transition px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <BrandMark size={64} />
          </div>
          <h1 className="text-[24px] font-bold text-[var(--text-primary)]">Omnia Pathology AI</h1>
          <p className="text-[14px] text-[var(--text-secondary)] mt-1">Clinical Trial Pathology Suite</p>
          <p className="text-[12px] text-[var(--text-secondary)]/70 mt-2">Research Use Only. Not for clinical diagnosis.</p>
        </div>

        {stage === 'checking' && (
          <Card size="lg" className="p-6 text-center">
            <p className="text-[13px] text-[var(--text-secondary)]">Checking system status…</p>
          </Card>
        )}

        {stage === 'license' && (
          licenseStatus === 'valid' ? (
            <Card size="lg" className="p-6 text-center">
              <CheckCircle className="w-12 h-12 text-[#34C759] mx-auto mb-2" />
              <p className="text-[#34C759] font-semibold">{licenseMessage}</p>
            </Card>
          ) : (
            <Card size="lg" className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Key className="w-4 h-4 text-[var(--text-secondary)]" />
                <label className="text-[13px] font-medium text-[var(--text-secondary)]">License Key</label>
              </div>
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && activateLicense()}
                placeholder="Enter your license key…"
                className="w-full px-4 py-3 rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[#007AFF] font-mono text-[13px]"
                disabled={licenseStatus === 'validating'}
              />
              <Button
                onClick={activateLicense}
                disabled={licenseStatus === ('validating' as typeof licenseStatus) || !licenseKey.trim()}
                className="w-full mt-4"
                size="lg"
              >
                {licenseStatus === 'validating' ? 'Validating…' : 'Activate License'}
              </Button>
              {licenseStatus === 'invalid' && (
                <div className="mt-4 flex items-start gap-2 text-[#FF3B30] text-[13px]">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>{licenseMessage}</p>
                </div>
              )}
            </Card>
          )
        )}

        {stage === 'auth' && (
          <Card size="lg" className="p-6">
            <div className="flex items-center gap-2 mb-1">
              {needsBootstrap ? <UserPlus className="w-4 h-4 text-[var(--text-secondary)]" /> : <User className="w-4 h-4 text-[var(--text-secondary)]" />}
              <h2 className="text-[15px] font-semibold">
                {needsBootstrap ? 'Create Administrator Account' : 'Sign In'}
              </h2>
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] mb-4">
              {needsBootstrap
                ? 'This is the first run — set up the administrator account for this installation.'
                : 'Enter your credentials to access the trial suite.'}
            </p>

            <div className="space-y-3">
              {needsBootstrap && (
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Full name (e.g. Dr. Jane Smith)"
                  className="w-full px-4 py-3 rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[#007AFF] text-[13px]"
                />
              )}
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                autoComplete="username"
                className="w-full px-4 py-3 rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[#007AFF] text-[13px]"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAuth()}
                placeholder="Password"
                autoComplete={needsBootstrap ? 'new-password' : 'current-password'}
                className="w-full px-4 py-3 rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[#007AFF] text-[13px]"
              />
            </div>

            <Button
              onClick={submitAuth}
              disabled={submitting || !username.trim() || !password || (needsBootstrap && !fullName.trim())}
              className="w-full mt-4"
              size="lg"
            >
              {submitting ? 'Please wait…' : needsBootstrap ? 'Create Account & Continue' : 'Sign In'}
            </Button>

            {authError && (
              <div className="mt-4 flex items-start gap-2 text-[#FF3B30] text-[13px]">
                <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{authError}</p>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
