'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity, ShieldCheck, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, FlaskConical, Users, FileCheck,
} from 'lucide-react';
import { apiBase } from '@/lib/constants';
import { Card, Button } from '@/components/ui';

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  time: string;
}

interface LicenseStatus {
  valid: boolean;
  organization?: string;
  expires?: string;
  message?: string;
}

interface Trial {
  patient_count: number;
  slides_analyzed: number;
  slides_confirmed: number;
}

function StatCard({ label, value, icon: Icon, valueColor }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; valueColor?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="w-[14px] h-[14px] text-[var(--text-secondary)]" />
        <p className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-[16px] font-semibold" style={{ color: valueColor }}>{value}</p>
    </Card>
  );
}

export default function AdminPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, l, t] = await Promise.all([
        fetch(`${apiBase()}/health`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase()}/api/license/status`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase()}/api/trials/`).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      setHealth(h);
      setLicense(l);
      setTrials(t || []);
      if (!h) setError('Could not reach backend');
    } catch {
      setError('Could not reach backend');
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--accent-border)] border-t-[var(--accent)] animate-spin" />
          <p className="text-[12px] text-[var(--text-secondary)]">Loading system status…</p>
        </div>
      </div>
    );
  }

  const totalPatients = trials.reduce((sum, t) => sum + (t.patient_count || 0), 0);
  const totalSlides = trials.reduce((sum, t) => sum + (t.slides_analyzed || 0), 0);
  const totalConfirmed = trials.reduce((sum, t) => sum + (t.slides_confirmed || 0), 0);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-bold">System Health</h1>
            <p className="text-[11px] text-[var(--text-secondary)]">Omnia Pathology AI server status overview</p>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchAll}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {error && (
          <Card className="p-4" style={{ background: 'rgba(255,59,48,0.06)' }}>
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-[#FF3B30] shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-[#FF3B30]">Connection Error</p>
                <p className="text-[10px] text-[var(--text-secondary)]">{error}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Status Bar */}
        <Card className="p-4" style={{ background: health ? 'rgba(52,199,89,0.06)' : 'rgba(255,59,48,0.06)' }}>
          <div className="flex items-center gap-3">
            {health ? <CheckCircle className="w-5 h-5 text-[#34C759]" /> : <XCircle className="w-5 h-5 text-[#FF3B30]" />}
            <div className="flex-1">
              <p className="text-[13px] font-bold">{health ? 'All Systems Operational' : 'Backend Unreachable'}</p>
              <p className="text-[10px] text-[var(--text-secondary)]">{apiBase()}</p>
            </div>
          </div>
        </Card>

        {/* Backend + License Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Service" value={health?.service || 'N/A'} icon={Activity} />
          <StatCard label="Version" value={health?.version || 'N/A'} icon={FlaskConical} />
          <StatCard label="License" value={license?.valid ? 'Valid' : 'Inactive'} icon={ShieldCheck} valueColor={license?.valid ? '#34C759' : '#FF9500'} />
          <StatCard label="Organization" value={license?.organization || '—'} icon={Users} />
        </div>

        {/* Trial Summary */}
        <h2 className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mt-2">Trial Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Trials" value={String(trials.length)} icon={FlaskConical} />
          <StatCard label="Patients" value={String(totalPatients)} icon={Users} />
          <StatCard label="Slides Analyzed" value={String(totalSlides)} icon={Activity} />
          <StatCard label="Confirmed" value={String(totalConfirmed)} icon={FileCheck} valueColor="#34C759" />
        </div>

        {/* License Detail */}
        {license && (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-[36px] h-[36px] rounded-[8px] bg-[var(--skeleton-bg)] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-[16px] h-[16px]" style={{ color: license.valid ? '#34C759' : '#FF3B30' }} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold">{license.valid ? 'Licensed' : 'No Valid License'}</p>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    {license.valid ? `${license.organization} — Expires ${license.expires}` : license.message || 'Activate a license to continue'}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        <div className="text-center py-6">
          <p className="text-[9px] text-[var(--text-secondary)]">Omnia Pathology AI · Clinical Trial Pathology Suite &middot; Research Use Only</p>
        </div>
      </div>
    </div>
  );
}
