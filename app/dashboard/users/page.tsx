'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, UserX, ShieldCheck } from 'lucide-react';
import { Card, Button, Pill, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth, ROLE_LABELS, Role } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';

interface ManagedUser {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
  created: string;
}

const ROLE_ACCENT: Record<Role, 'blue' | 'green' | 'orange' | 'gray'> = {
  admin: 'blue',
  pathologist: 'green',
  monitor: 'orange',
  sponsor: 'gray',
};

export default function UsersPage() {
  const router = useRouter();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'pathologist' as Role });
  const [error, setError] = useState('');
  const toast = useToast();
  const { confirm } = useDialogs();

  const load = async () => {
    try {
      const res = await apiFetch('/api/users/');
      if (res.status === 403) {
        router.push('/dashboard');
        return;
      }
      setUsers(await res.json());
    } catch (e) {
      console.error('Failed to load users', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createUser = async () => {
    setError('');
    if (!form.username || !form.password || !form.full_name) return;
    try {
      const res = await apiFetch('/api/users/', { method: 'POST', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || 'Failed to create user'); return; }
      setShowCreate(false);
      setForm({ username: '', password: '', full_name: '', role: 'pathologist' });
      load();
      toast.show(`${data.full_name} added as ${ROLE_LABELS[data.role as Role]}`);
    } catch {
      setError('Could not connect to backend.');
    }
  };

  const deactivate = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Deactivate User',
      message: `${name} will no longer be able to sign in. This can be reversed by an administrator later.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiSend(`/api/users/${id}`, { method: 'DELETE' });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Failed to deactivate user', 'error');
      return;
    }
    load();
    toast.show(`${name} deactivated`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
        <div className="border-b border-[var(--border-subtle)] px-6 py-3.5 flex items-center justify-between bg-[var(--bg-card-solid)]">
          <div className="space-y-1.5">
            <div className="w-40 h-3.5 rounded-[4px] skeleton-shimmer" />
            <div className="w-56 h-2.5 rounded-[4px] skeleton-shimmer" />
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Card size="sm" className="overflow-hidden">
            <TableSkeleton rows={3} columns={5} />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] theme-transition">
      <div className="border-b border-[var(--border-subtle)] px-6 py-3.5 flex items-center justify-between bg-[var(--bg-card-solid)]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="p-1.5 rounded-[8px] hover:bg-[var(--skeleton-bg)]">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-[15px] font-semibold">User Management</h1>
            <p className="text-[11px] text-[var(--text-secondary)]">Manage accounts, roles, and access</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5" /> New User
        </Button>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {users.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No users" />
        ) : (
          <Card size="sm" className="overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--skeleton-bg)]">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Name</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Username</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Role</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--skeleton-bg)] transition-colors">
                    <td className="px-4 py-3 text-[13px] font-semibold">{u.full_name}</td>
                    <td className="px-4 py-3 text-[12px] text-[var(--text-secondary)] font-mono">{u.username}</td>
                    <td className="px-4 py-3"><Pill accent={ROLE_ACCENT[u.role]} className="whitespace-nowrap">{ROLE_LABELS[u.role]}</Pill></td>
                    <td className="px-4 py-3"><Pill accent={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Deactivated'}</Pill></td>
                    <td className="px-4 py-3 text-right">
                      {u.active && u.id !== me?.id && (
                        <button
                          title="Deactivate"
                          className="p-1.5 rounded-[6px] hover:bg-[#FF3B30]/10 text-[var(--text-secondary)] hover:text-[#FF3B30] transition-colors inline-flex"
                          onClick={() => deactivate(u.id, u.full_name)}
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setShowCreate(false)}>
          <Card size="lg" className="w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold mb-4">Create User</h2>
            <div className="space-y-3">
              <input
                placeholder="Full name (e.g. Dr. Jane Smith)"
                value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <input
                placeholder="Username"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <input
                type="password"
                placeholder="Temporary password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              />
              <select
                value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value as Role })}
                className="w-full px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px]"
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-[12px] text-[#FF3B30] mt-3">{error}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={createUser}>Create User</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
