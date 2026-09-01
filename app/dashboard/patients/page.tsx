'use client';

/**
 * Patient registry — the index of people, as distinct from the per-trial
 * subject lists. A person enrolled in three trials is one row here and three
 * rows in the trial views; this is the screen that treats them as one record.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Search, ArrowLeft, Plus, ShieldCheck } from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiSend, useAuth, canWrite } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import RegisterPatientDialog, { PatientProfileDraft } from '../components/RegisterPatientDialog';

interface Patient {
  uid: string;
  initials: string;
  year_of_birth: number | null;
  sex: string;
  site: string;
  notes: string;
  created: string;
}

export default function PatientRegistry() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const writable = canWrite(user?.role);

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

  const q = search.trim().toLowerCase();
  const visible = q
    ? patients.filter(p =>
        [p.uid, p.initials, p.site, String(p.year_of_birth ?? '')]
          .join(' ').toLowerCase().includes(q))
    : patients;

  return (
    <div className="min-h-screen">
      <div className="titlebar-drag titlebar-inset border-b border-[var(--border-subtle)] flex items-center gap-4 pr-6 py-3">
        <button
          onClick={() => router.push('/dashboard')}
          className="titlebar-no-drag inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </button>
        <h1 className="text-[13px] font-semibold">Patient registry</h1>
        <div className="flex-1" />
        {writable && (
          <Button size="sm" className="titlebar-no-drag" onClick={() => setShowRegister(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Register patient
          </Button>
        )}
      </div>

      <div className="max-w-6xl mx-auto px-6 pt-7 pb-1">
        <h2 className="text-[26px] font-semibold tracking-[-0.5px] leading-tight">Patients</h2>
        <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
          {patients.length === 0
            ? 'No patients registered yet.'
            : `${patients.length} registered · each identifier is generated and carries a check character`}
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Why the profile looks sparse — stated on the screen rather than
            leaving a reviewer to wonder whether fields are missing. */}
        <div className="flex items-start gap-2.5 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] px-4 py-3 mb-5">
          <ShieldCheck className="w-4 h-4 text-[#34C759] shrink-0 mt-[1px]" />
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
            Records here are pseudonymised by design: no names and no full dates of birth are
            stored. Your site holds the mapping from these identifiers to people; this
            application deliberately does not, and nothing leaves this machine.
          </p>
        </div>

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
              ? <Button size="lg" onClick={() => setShowRegister(true)}>Register patient</Button>
              : undefined}
          />
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by patient ID, initials, or site…"
                className="w-full pl-9 pr-3 py-2 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            {visible.length === 0 ? (
              <EmptyState icon={Search} title="No matching patients" subtitle="Try a different search term." />
            ) : (
              <Card size="sm" className="overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--skeleton-bg)]">
                      {['Patient ID', 'Initials', 'Year of birth', 'Sex', 'Site', 'Registered'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(p => (
                      <tr
                        key={p.uid}
                        onClick={() => router.push(`/dashboard/patients/${p.uid}`)}
                        className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--skeleton-bg)] transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 text-[13px] font-semibold tabular-nums">{p.uid}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">{p.initials || '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)] tabular-nums">{p.year_of_birth ?? '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)] capitalize">{p.sex || '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">{p.site || '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)]">
                          {p.created ? new Date(p.created).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </Card>
            )}
          </>
        )}
      </div>

      <RegisterPatientDialog
        open={showRegister}
        onCancel={() => setShowRegister(false)}
        onSubmit={register}
      />
    </div>
  );
}
