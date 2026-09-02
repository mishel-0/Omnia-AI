'use client';

/**
 * The patient registry.
 *
 * The page carried its own title strip with a back button, from when there was
 * no persistent chrome to go back *to*. The rail does that job now, so the
 * strip is a breadcrumb: it says where you are rather than offering an exit.
 *
 * Everything else here follows from the registry being a list people scan for
 * one identifier. Sorting, a filter for the two facets that exist, a copy
 * button on the identifier itself — because the identifier is what gets pasted
 * into a request form or read down a phone, and re-typing a checksummed code by
 * hand is how the wrong patient gets looked up.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Search, Plus, ShieldCheck, X, Copy, Check, ChevronRight, ChevronLeft,
  SlidersHorizontal, ChevronsUpDown, MoreHorizontal, FileText,
} from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton, Pill } from '@/components/ui';
import { apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import RegisterPatientDialog, { PatientProfileDraft } from '../components/RegisterPatientDialog';

interface Patient {
  uid: string;
  initials: string;
  year_of_birth: number | null;
  sex: string;
  site: string;
  notes: string;
  created: string;
  redacted?: boolean;
}

type SortKey = 'uid' | 'created';
const PAGE_SIZE = 25;
const NOTICE_KEY = 'omnia_patients_notice_dismissed';

export default function PatientRegistry() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'created', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [sexFilter, setSexFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  // Starts hidden and is revealed once storage has been read, so a dismissed
  // notice does not flash back on every visit before the effect runs.
  const [notice, setNotice] = useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const writable = canWrite(user?.role);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setNotice(localStorage.getItem(NOTICE_KEY) !== 'true'); } catch { setNotice(true); }
  }, []);

  const dismissNotice = () => {
    setNotice(false);
    try { localStorage.setItem(NOTICE_KEY, 'true'); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!showFilters) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFilters(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showFilters]);

  const load = useCallback(async () => {
    try {
      const data = await apiSend('/api/patients/');
      setPatients(Array.isArray(data) ? data : []);
    } catch {
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const register = async (draft: PatientProfileDraft) => {
    const created = await apiSend('/api/patients/', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    setShowRegister(false);
    load();
    toast.show(`Patient ${created.uid} registered`);
    router.push(`/dashboard/patients/${created.uid}`);
  };

  const sites = useMemo(
    () => [...new Set(patients.map(p => p.site).filter(Boolean))].sort(),
    [patients],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = patients;
    if (q) {
      out = out.filter(p =>
        [p.uid, p.initials, p.site, String(p.year_of_birth ?? '')]
          .join(' ').toLowerCase().includes(q));
    }
    if (sexFilter) out = out.filter(p => p.sex === sexFilter);
    if (siteFilter) out = out.filter(p => p.site === siteFilter);
    return [...out].sort((a, b) => {
      const av = sort.key === 'uid' ? a.uid : a.created;
      const bv = sort.key === 'uid' ? b.uid : b.created;
      const c = String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [patients, search, sexFilter, siteFilter, sort]);

  // Any change to the result set can leave the current page past the end —
  // filtering 200 patients down to 3 while on page 4 would show an empty table
  // rather than the three matches.
  useEffect(() => { setPage(0); }, [search, sexFilter, siteFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const shown = visible.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const activeFilters = (sexFilter ? 1 : 0) + (siteFilter ? 1 : 0);

  const toggleSort = (key: SortKey) =>
    setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div className="max-w-[1200px] px-7 pt-6 pb-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] mb-4">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Dashboard
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="font-medium text-[var(--accent)]" aria-current="page">Patients</span>
      </nav>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.6px] leading-tight">Patients</h1>
          <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
            {patients.length === 0
              ? 'No patients registered yet.'
              : `${patients.length} registered · each identifier is generated and carries a check character`}
          </p>
        </div>
        {writable && (
          <Button size="md" className="btn-gradient shrink-0" onClick={() => setShowRegister(true)}>
            <Plus className="w-4 h-4" /> Register Patient
          </Button>
        )}
      </div>

      {/* Why the profile looks sparse — stated on the screen rather than
          leaving a reviewer to wonder whether fields are missing. Dismissible,
          because it is an explanation, and an explanation you cannot put away
          after reading it becomes furniture. */}
      {notice && (
        <div className="flex items-start gap-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] px-4 py-3.5 mb-5">
          <span className="w-7 h-7 rounded-full bg-[#34C759]/12 grid place-items-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-[#34C759]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium leading-relaxed">
              Records here are pseudonymised by design: no names and no full dates of birth are stored.
            </p>
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
              Your site holds the mapping from these identifiers to people; this application
              deliberately does not, and nothing leaves this machine.
            </p>
          </div>
          <button
            onClick={dismissNotice}
            aria-label="Dismiss"
            className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--cc-tile-hover)] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <TableSkeleton />
      ) : patients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No patients yet"
          subtitle={writable
            ? 'Register a patient to create their record and container.'
            : 'No patients have been registered yet.'}
          action={writable
            ? <Button size="lg" className="btn-gradient" onClick={() => setShowRegister(true)}>Register Patient</Button>
            : undefined}
        />
      ) : (
        <>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by patient ID, initials, or site…"
                className="w-full pl-11 pr-4 py-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setShowFilters(v => !v)}
                aria-expanded={showFilters}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-3 rounded-[14px] border text-[13px] font-medium transition-colors',
                  activeFilters
                    ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card-solid)] hover:border-[var(--border-medium)]',
                )}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
                {activeFilters > 0 && (
                  <span className="text-[11px] tabular-nums">({activeFilters})</span>
                )}
              </button>

              {showFilters && (
                <div className="cc-panel absolute right-0 top-[calc(100%+8px)] w-[240px] z-40 p-3 rounded-[16px] animate-menu-in origin-top-right">
                  <FilterField label="Sex" value={sexFilter} onChange={setSexFilter}
                               options={[['', 'Any'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']]} />
                  {sites.length > 0 && (
                    <FilterField label="Site" value={siteFilter} onChange={setSiteFilter}
                                 options={[['', 'Any'], ...sites.map(s => [s, s] as [string, string])]} />
                  )}
                  {activeFilters > 0 && (
                    <button
                      onClick={() => { setSexFilter(''); setSiteFilter(''); }}
                      className="w-full mt-1 text-[12px] text-[var(--accent)] hover:underline text-left px-1"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={Search} title="No matching patients"
                        subtitle="Try a different search term, or clear the filters." />
          ) : (
            <Card size="md" className="overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[820px]">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <SortableTh label="Patient ID" active={sort.key === 'uid'} dir={sort.dir}
                                  onClick={() => toggleSort('uid')} className="pl-5" />
                      <Th>Initials</Th>
                      <Th>Year of birth</Th>
                      <Th>Sex</Th>
                      <Th>Site</Th>
                      <SortableTh label="Registered" active={sort.key === 'created'} dir={sort.dir}
                                  onClick={() => toggleSort('created')} />
                      <Th className="text-right pr-5">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(p => (
                      <PatientRow key={p.uid} patient={p}
                                  onOpen={() => router.push(`/dashboard/patients/${p.uid}`)} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-[var(--border-subtle)]">
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Showing {shown.length} of {visible.length} patient{visible.length === 1 ? '' : 's'}
                </p>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1.5">
                    <PageBtn onClick={() => setPage(p => p - 1)} disabled={page === 0} aria-label="Previous page">
                      <ChevronLeft className="w-4 h-4" />
                    </PageBtn>
                    <span className="text-[12px] tabular-nums px-2">
                      {page + 1} / {pageCount}
                    </span>
                    <PageBtn onClick={() => setPage(p => p + 1)} disabled={page >= pageCount - 1} aria-label="Next page">
                      <ChevronRight className="w-4 h-4" />
                    </PageBtn>
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      <RegisterPatientDialog
        open={showRegister}
        onCancel={() => setShowRegister(false)}
        onSubmit={register}
      />
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[var(--text-secondary)]', className)}>
      {children}
    </th>
  );
}

function SortableTh({ label, active, dir, onClick, className }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; className?: string;
}) {
  return (
    <th className={cn('px-4 py-3', className)}>
      <button
        onClick={onClick}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(
          'inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.5px] transition-colors',
          active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        )}
      >
        {label}
        <ChevronsUpDown className="w-3 h-3" />
      </button>
    </th>
  );
}

function PageBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function FilterField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="block mb-2 last:mb-0">
      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.5px] text-[var(--text-secondary)] mb-1 px-1">
        {label}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2.5 py-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[12.5px] focus:outline-none focus:border-[var(--accent)]"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function PatientRow({ patient: p, onOpen }: { patient: Patient; onOpen: () => void }) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(p.uid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked; the identifier is still selectable */ }
  };

  const sexAccent = p.sex === 'male' ? 'blue' : p.sex === 'female' ? 'pink' : 'gray';

  return (
    <tr
      onClick={onOpen}
      className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--cc-tile-hover)] transition-colors cursor-pointer"
    >
      <td className="pl-5 pr-4 py-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-[var(--accent-soft)] grid place-items-center shrink-0">
            <Users className="w-4 h-4 text-[var(--accent)]" />
          </span>
          <span className="text-[13px] font-semibold tabular-nums">{p.uid}</span>
          <button
            onClick={copy}
            aria-label={`Copy ${p.uid}`}
            title="Copy identifier"
            className="p-1 rounded-[6px] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--cc-tile-hover)] transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {p.redacted && <Pill accent="gray">Redacted</Pill>}
        </div>
      </td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">{p.initials || '—'}</td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)] tabular-nums">{p.year_of_birth ?? '—'}</td>
      <td className="px-4 py-3">
        {p.sex ? <Pill accent={sexAccent}><span className="capitalize">{p.sex}</span></Pill>
               : <span className="text-[12.5px] text-[var(--text-secondary)]">—</span>}
      </td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">{p.site || '—'}</td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
        {p.created
          ? new Date(p.created).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
          : '—'}
      </td>
      <td className="pr-5 pl-4 py-3 text-right relative" ref={menuRef}>
        <button
          onClick={e => { e.stopPropagation(); setMenu(v => !v); }}
          aria-label="Actions"
          aria-expanded={menu}
          className="inline-grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menu && (
          <div
            onClick={e => e.stopPropagation()}
            className="cc-panel absolute right-5 top-[calc(100%-4px)] w-[184px] z-40 p-1.5 rounded-[14px] animate-menu-in origin-top-right text-left"
          >
            <button onClick={onOpen}
                    className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
              <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Open record
            </button>
            <button onClick={copy}
                    className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
              <Copy className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Copy identifier
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
