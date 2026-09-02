'use client';

/**
 * Settings.
 *
 * Everything here reflects state the application actually holds — the theme,
 * the licence, the network configuration, the model in use, what this build
 * reports about itself. Nothing is a placeholder switch that writes to
 * localStorage and changes no behaviour; a settings screen full of controls
 * that do nothing is worse than a short one that is all real.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  Button, Toggle, Segmented, SettingGroup, SettingRow, Skeleton, Pill,
} from '@/components/ui';
import { apiFetch, useAuth, canWrite } from '@/lib/auth';
import { useTheme, type Theme } from '@/lib/theme';
import { useToast } from '@/lib/toast';

interface Health { version: string; status: string; grading_fabricated?: boolean; warning?: string }
interface License {
  valid: boolean; organization?: string; edition?: string; expires?: string;
  days_remaining?: number; message?: string; insecure_signing?: boolean;
}
interface ActiveModel { source: string; description: string; qwk?: number | null }
interface NetStatus { configured: boolean; has_local_finetune: boolean; terms_version?: string }

export default function SettingsPage() {
  const { user } = useAuth();
  const writable = canWrite(user?.role);
  const { theme, setTheme } = useTheme();
  const toast = useToast();

  const [health, setHealth] = useState<Health | null>(null);
  const [license, setLicense] = useState<License | null>(null);
  const [model, setModel] = useState<ActiveModel | null>(null);
  const [net, setNet] = useState<NetStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Follow-the-system is a third state, not a second one: with no stored
  // preference the app tracks the OS. Choosing light or dark pins it.
  const [followSystem, setFollowSystem] = useState(false);
  useEffect(() => {
    try { setFollowSystem(!localStorage.getItem('omnia_theme')); } catch { /* storage off */ }
  }, []);

  const load = useCallback(async () => {
    const get = async (url: string) => {
      try { const r = await apiFetch(url); return r.ok ? await r.json() : null; }
      catch { return null; }
    };
    const [h, l, m, n] = await Promise.all([
      get('/health'), get('/api/license/status'),
      get('/api/training/model'), get('/api/training/network/status'),
    ]);
    setHealth(h); setLicense(l); setModel(m); setNet(n);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const applyTheme = (t: Theme) => { setFollowSystem(false); setTheme(t); };

  const useSystem = (on: boolean) => {
    setFollowSystem(on);
    if (on) {
      try { localStorage.removeItem('omnia_theme'); } catch { /* storage off */ }
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', sys);
      toast.show('Appearance now follows your system setting');
    } else {
      setTheme((document.documentElement.getAttribute('data-theme') as Theme) || 'light');
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">

      <div className="max-w-3xl mx-auto px-6 py-7">
        <h2 className="text-[26px] font-semibold tracking-[-0.5px] leading-tight">Settings</h2>
        <p className="text-[12.5px] text-[var(--text-secondary)] mt-1 mb-7">
          This installation, and what it reports about itself.
        </p>

        <SettingGroup title="Appearance">
          <SettingRow
            title="Follow system"
            description="Match the light or dark setting of macOS."
            control={<Toggle checked={followSystem} onChange={useSystem} label="Follow system appearance" />}
          />
          <SettingRow
            title="Theme"
            description="Choosing a theme stops the app following your system setting."
            control={
              <Segmented
                value={followSystem ? ('' as Theme) : theme}
                options={[{ value: 'light' as Theme, label: 'Light' }, { value: 'dark' as Theme, label: 'Dark' }]}
                onChange={applyTheme}
              />
            }
          />
        </SettingGroup>

        <SettingGroup
          title="Licence"
          footnote={license?.insecure_signing
            ? 'This build signs licence keys with the published development secret, so keys can be forged. Set OMNIA_LICENSE_SECRET at build time before issuing any licence you intend to rely on.'
            : undefined}
        >
          {loading ? <RowSkeleton /> : (
            <>
              <SettingRow
                title="Status"
                description={license?.message || 'No licence information available.'}
                control={<Pill accent={license?.valid ? 'green' : 'orange'}>{license?.valid ? 'Licensed' : 'Unlicensed'}</Pill>}
              />
              {license?.organization && (
                <SettingRow title="Licensed to" control={<Value>{license.organization}</Value>} />
              )}
              {license?.expires && (
                <SettingRow
                  title="Expires"
                  description={typeof license.days_remaining === 'number'
                    ? `${license.days_remaining.toLocaleString()} days remaining` : undefined}
                  control={<Value>{license.expires}</Value>}
                />
              )}
              {license?.insecure_signing && (
                <SettingRow
                  title="Key signing"
                  description="Keys are signed with the published development secret."
                  control={
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#FF9500]">
                      <AlertTriangle className="w-3.5 h-3.5" /> Insecure
                    </span>
                  }
                />
              )}
            </>
          )}
        </SettingGroup>

        <SettingGroup
          title="Grading model"
          footnote="Fine-tuning trains this site's attention and classifier heads on slides your pathologists have signed. It replaces the model in use only when it agrees with them more closely on slides it never trained on."
        >
          {loading ? <RowSkeleton /> : (
            <>
              <SettingRow
                title="Model in use"
                description={model?.description}
                control={<Pill accent={model?.source === 'finetuned' ? 'blue' : 'gray'}>
                  {model?.source === 'finetuned' ? 'Fine-tuned' : 'Supplied'}
                </Pill>}
              />
              {typeof model?.qwk === 'number' && (
                <SettingRow
                  title="Agreement"
                  description="Quadratic weighted kappa against your pathologists, on slides held out of training."
                  control={<Value>{model.qwk.toFixed(3)}</Value>}
                />
              )}
              <SettingRow
                title="Grading source"
                description={health?.grading_fabricated
                  ? health.warning
                  : 'Grades are produced by the model, not fabricated.'}
                control={health?.grading_fabricated
                  ? <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#FF3B30]">
                      <AlertTriangle className="w-3.5 h-3.5" /> Test mode
                    </span>
                  : <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#34C759]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Real model
                    </span>}
              />
            </>
          )}
        </SettingGroup>

        <SettingGroup
          title="Omnia Network"
          footnote="Contributing sends the adjusted model weights only — never a slide, never a patient identifier. It is optional and this installation works identically without it."
        >
          {loading ? <RowSkeleton /> : (
            <>
              <SettingRow
                title="Configured"
                description={net?.configured
                  ? 'This installation can contribute to the shared model.'
                  : 'Set OMNIA_NETWORK_URL and OMNIA_NETWORK_SITE_KEY to take part.'}
                control={<Pill accent={net?.configured ? 'green' : 'gray'}>
                  {net?.configured ? 'Yes' : 'No'}
                </Pill>}
              />
              <SettingRow
                title="Local fine-tune"
                description={net?.has_local_finetune
                  ? 'A locally trained model is available to contribute.'
                  : 'Nothing to contribute yet — train on this site’s reviewed slides first.'}
                control={<Value>{net?.has_local_finetune ? 'Ready' : 'None'}</Value>}
              />
            </>
          )}
        </SettingGroup>

        <SettingGroup title="About">
          {loading ? <RowSkeleton /> : (
            <>
              <SettingRow title="Version" control={<Value>{health?.version ?? '—'}</Value>} />
              <SettingRow
                title="Data location"
                description="Slides, patients and the audit trail are stored on this computer and are never uploaded."
                control={<Value>Local</Value>}
              />
              <SettingRow
                title="Intended use"
                description="Research use only. Not for use in the diagnosis or clinical management of individual patients."
                control={<Pill accent="orange">RUO</Pill>}
              />
            </>
          )}
        </SettingGroup>

        {writable && (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => { setLoading(true); load(); }}>
              Refresh
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="text-[12.5px] font-medium tabular-nums">{children}</span>;
}

function RowSkeleton() {
  return (
    <div className="px-4 py-3.5 space-y-2">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-2.5 w-56" />
    </div>
  );
}
