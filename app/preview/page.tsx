'use client';

/**
 * A rendering harness for the dashboard's cards. Not part of the product.
 *
 * The dashboard cannot be looked at without a backend, an account and some
 * trials, which makes reviewing a visual change slow and, in a sandbox that
 * blocks cross-origin requests, sometimes impossible. This route renders the
 * real components — the same StatCard, TrialCard, AreaChart and CardHeader the
 * dashboard uses — against fixed sample data and makes no network calls at
 * all, so the design can be seen and judged on its own.
 *
 * Sample data only. Nothing here reaches the API or the patient store.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { Users, Layers, ScrollText, FlaskConical, Search, ArrowRight } from 'lucide-react';
import { Card, CardHeader, PillButton, AreaChart,
         Toggle, Segmented, SettingGroup, SettingRow, Pill } from '@/components/ui';
import { StatCard, TrialCard, type Trial } from '../dashboard/page';
import { useTheme } from '@/lib/theme';

const SAMPLE: Trial[] = [
  {
    id: 't1', name: 'DEMO-301', protocol_id: 'DEMO-301', phase: 'Phase III',
    sponsor: 'Sponsor A', drug: 'Compound-1', indication: 'Non-metastatic CRPC',
    notes: '', sites: ['Vilnius', 'Kaunas', 'Riga'], status: 'active',
    patient_count: 148, slides_analyzed: 412, slides_confirmed: 351, created: '',
  },
  {
    id: 't2', name: 'DEMO-202', protocol_id: 'DEMO-202', phase: 'Phase II',
    sponsor: 'Sponsor B', drug: 'Compound-2', indication: 'Neoadjuvant prostate',
    notes: '', sites: ['Tartu'], status: 'active',
    patient_count: 62, slides_analyzed: 190, slides_confirmed: 190, created: '',
  },
  {
    id: 't3', name: 'DEMO-101', protocol_id: 'DEMO-101', phase: 'Phase I',
    sponsor: 'Sponsor C', drug: 'Compound-3', indication: 'Active surveillance',
    notes: '', sites: ['Vilnius', 'Gdansk'], status: 'closed',
    patient_count: 31, slides_analyzed: 88, slides_confirmed: 40, created: '',
  },
];

export default function DashboardPreview() {
  // Never in a shipped build. Fabricated records that look like trials, one
  // URL away from a pathologist, is the same failure as a grading mode that
  // invents results. The sample data above is also deliberately synthetic —
  // "Sponsor A / Compound-1", never a real sponsor or a real drug — so that
  // even the dead strings left in a production bundle cannot be mistaken for
  // clinical data by anyone reading it.
  if (process.env.NODE_ENV === 'production') notFound();

  const { theme, toggle } = useTheme();
  const [filter, setFilter] = React.useState<'all' | 'active' | 'closed'>('all');
  const [sysOn, setSysOn] = React.useState(true);
  const [seg, setSeg] = React.useState<'light' | 'dark'>('light');

  const shown = SAMPLE.filter(t => filter === 'all' || t.status === filter);
  const totals = {
    patients: SAMPLE.reduce((n, t) => n + t.patient_count, 0),
    slides: SAMPLE.reduce((n, t) => n + t.slides_analyzed, 0),
    pending: SAMPLE.reduce((n, t) => n + (t.slides_analyzed - t.slides_confirmed), 0),
    active: SAMPLE.filter(t => t.status === 'active').length,
    trials: SAMPLE.length,
  };
  const reviewedPct = Math.round(((totals.slides - totals.pending) / totals.slides) * 100);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      <div className="border-b border-[var(--border-subtle)] px-6 py-3 bg-[var(--bg-card-solid)] flex items-center justify-between">
        <span className="text-[13px] font-semibold">Dashboard preview — sample data, no API</span>
        <PillButton onClick={toggle}>{theme === 'dark' ? 'Light' : 'Dark'} mode</PillButton>
      </div>

      <div className="max-w-6xl mx-auto px-6 pt-7 pb-10">
        <h2 className="text-[26px] font-semibold tracking-[-0.5px] leading-tight">
          Good afternoon, <span className="text-[var(--accent)]">Dr Adnan</span>
        </h2>
        <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
          {totals.pending} slides awaiting your review
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <StatCard icon={Users} label="Patients" value={totals.patients} tone="#5856D6" sub="Total patients" />
          <StatCard icon={Layers} label="Slides analysed" value={totals.slides} tone="var(--accent)" sub="Total slides" />
          <StatCard icon={ScrollText} label="Awaiting review" value={totals.pending} tone="#FF9500" sub="Slides" />
          <StatCard icon={FlaskConical} label="Active trials" value={totals.active} tone="#34C759" sub={`of ${totals.trials} in progress`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
          <Card size="md" className="p-5">
            <CardHeader
              title="Review progress"
              action={
                <span className="text-[11.5px] font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-2.5 py-1 tabular-nums">
                  {reviewedPct}%
                </span>
              }
            />
            <AreaChart points={[42, 55, 51, 68, 74, 71, 85]} max={100} height={96} />
            <div className="flex items-center gap-4 text-[11px] text-[var(--text-secondary)] mt-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                Signed {totals.slides - totals.pending}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--skeleton-bg)] border border-[var(--border-subtle)]" />
                Pending {totals.pending}
              </span>
            </div>
          </Card>

          <div className="rounded-[20px] p-5 flex flex-col justify-between"
               style={{ background: 'linear-gradient(145deg, var(--hero-from) 0%, var(--hero-to) 100%)' }}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-[var(--hero-fg)]/95">Needs a pathologist</p>
                <span className="text-[10px] font-medium text-[var(--hero-fg)]/80 bg-[var(--hero-fg)]/15 rounded-full px-2 py-0.5">
                  {totals.active} active
                </span>
              </div>
              <p className="text-[38px] font-semibold text-[var(--hero-fg)] leading-none tabular-nums mt-3">
                {totals.pending}
              </p>
              <p className="text-[12px] text-[var(--hero-fg)]/85 leading-relaxed mt-2">
                Analysed slides become part of the record only once a qualified pathologist
                confirms or corrects the grade.
              </p>
            </div>
            <button className="mt-4 self-start inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] bg-[var(--bg-card-solid)] rounded-full px-3.5 py-1.5 transition-colors">
              Open DEMO-301 <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <Card size="md" className="p-5">
            <CardHeader title="Portfolio" />
            <div className="space-y-3">
              {[['Trials', 3, undefined], ['Active', 2, '#34C759'], ['Closed', 1, undefined], ['Open queries', 4, '#FF9500']]
                .map(([label, value, tone]) => (
                  <div key={String(label)} className="flex items-center justify-between">
                    <span className="text-[12.5px] text-[var(--text-secondary)]">{String(label)}</span>
                    <span className="text-[14px] font-semibold tabular-nums" style={{ color: tone as string | undefined }}>
                      {String(value)}
                    </span>
                  </div>
                ))}
            </div>
          </Card>
        </div>

        <div className="flex items-center gap-2 mt-6 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              placeholder="Search trials, sponsors, drugs…"
              className="w-full pl-10 pr-4 py-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[12.5px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          {(['all', 'active', 'closed'] as const).map(s => (
            <PillButton key={s} active={filter === s} onClick={() => setFilter(s)} className="capitalize">
              {s}
            </PillButton>
          ))}
        </div>

        <div className="mt-8 max-w-2xl">
          <SettingGroup title="Settings primitives" footnote="The same Toggle, Segmented and grouped rows the Settings screen uses.">
            <SettingRow
              title="Follow system"
              description="Match the light or dark setting of macOS."
              control={<Toggle checked={sysOn} onChange={setSysOn} label="Follow system" />}
            />
            <SettingRow
              title="Theme"
              description="Choosing a theme stops the app following your system setting."
              control={<Segmented value={seg} options={[{value:'light',label:'Light'},{value:'dark',label:'Dark'}]} onChange={setSeg} />}
            />
            <SettingRow
              title="Licence"
              description="Licensed to Demo Organisation · expires 2030-12-31"
              control={<Pill accent="green">Licensed</Pill>}
            />
            <SettingRow
              title="Grading source"
              description="Grades are produced by the model, not fabricated."
              control={<Pill accent="blue">Real model</Pill>}
            />
          </SettingGroup>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {shown.map(t => (
            <TrialCard
              key={t.id}
              trial={t}
              openQueries={t.id === 't1' ? 4 : 0}
              writable
              onOpen={() => {}}
              onExport={() => {}}
              onToggleStatus={() => {}}
              onDelete={() => {}}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
