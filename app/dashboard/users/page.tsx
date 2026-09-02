'use client';

/**
 * User administration.
 *
 * This is a desktop application that runs on one machine, so the columns a
 * hosted product would carry here do not apply and are not invented.
 *
 *   Email — there is no email address for anyone, and no mail to send. The
 *   username is how someone signs in and what the audit trail attributes their
 *   actions to, so that is the identifier the row shows.
 *
 *   Department — an organisational directory field. It belongs to whatever
 *   system runs the org chart, not to a single-site install that has no way to
 *   verify it and nothing to do with the answer.
 *
 *   Last sign-in — kept, because it is a local security fact rather than a
 *   presence indicator: it answers "is this account dormant, and should it
 *   still exist", which is a question a Part 11 access review actually asks.
 *   Stamped when a credential is accepted, so a rejected attempt cannot make a
 *   dormant account look live, and an account never used says exactly that.
 *
 * Status means what this system means by it: whether the account may sign in.
 * The reference labels a disabled account "Not logged in", which is a different
 * thing entirely — an active user who is simply not at the machine has not been
 * deactivated, and an administrator has to be able to tell the difference
 * before going looking for why someone is locked out.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users as UsersIcon, ShieldCheck, UserX, Crown, Search, Plus, ChevronRight, ChevronLeft,
  MoreHorizontal, SlidersHorizontal, Filter, UserCog, Ban, RotateCcw, X,
} from 'lucide-react';
import { Card, Button, EmptyState, TableSkeleton } from '@/components/ui';
import { apiFetch, apiSend, useAuth, ROLE_LABELS, Role } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useDialogs } from '@/lib/dialogs';
import { cn, initials } from '@/lib/utils';

interface ManagedUser {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
  created: string;
  last_login?: string;
}

const ROLE_TONE: Record<Role, string> = {
  admin: '#5856D6',
  pathologist: '#34C759',
  monitor: '#FF9500',
  sponsor: '#8E8E93',
};

const PAGE_SIZE = 25;

/** "Just now", "5h ago", "2 days ago" — and an honest blank for never. */
function relative(iso?: string): string {
  if (!iso) return 'Never signed in';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never signed in';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function UsersPage() {
  const router = useRouter();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    username: '', password: '', full_name: '', role: 'pathologist' as Role,
  });
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<{ key: 'full_name' | 'last_login'; dir: 'asc' | 'desc' }>(
    { key: 'full_name', dir: 'asc' });
  const [page, setPage] = useState(0);
  const toast = useToast();
  const { confirm } = useDialogs();

  const load = async () => {
    try {
      const res = await apiFetch('/api/users/');
      if (res.status === 403) { router.push('/dashboard'); return; }
      setUsers(await res.json());
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createUser = async () => {
    setError('');
    if (!form.username || !form.password || !form.full_name) {
      setError('Name, username and password are all required.');
      return;
    }
    try {
      const res = await apiFetch('/api/users/', { method: 'POST', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || 'Failed to create user'); return; }
      setShowCreate(false);
      setForm({ username: '', password: '', full_name: '', role: 'pathologist' });
      load();
      toast.show(`${data.full_name} added as ${ROLE_LABELS[data.role as Role]}`);
    } catch {
      setError('Could not connect to the backend.');
    }
  };

  const setActive = async (u: ManagedUser, active: boolean) => {
    if (!active) {
      const ok = await confirm({
        title: 'Deactivate user',
        message: `${u.full_name} will no longer be able to sign in. Their entries in the audit trail are unaffected — a signed record keeps the identity of whoever signed it. This can be reversed by an administrator.`,
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      if (active) await apiSend(`/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
      else await apiSend(`/api/users/${u.id}`, { method: 'DELETE' });
      load();
      toast.show(`${u.full_name} ${active ? 'reactivated' : 'deactivated'}`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not change the account.', 'error');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = users;
    if (roleFilter) out = out.filter(u => u.role === roleFilter);
    if (statusFilter) out = out.filter(u => (statusFilter === 'active') === (u.active !== false));
    if (q) out = out.filter(u =>
      [u.full_name, u.username, ROLE_LABELS[u.role] ?? u.role]
        .join(' ').toLowerCase().includes(q));
    return [...out].sort((a, b) => {
      if (sort.key === 'full_name') {
        const c = (a.full_name || '').localeCompare(b.full_name || '');
        return sort.dir === 'asc' ? c : -c;
      }
      // Never-signed-in sorts last on a most-recent-first list rather than
      // first, which is what an empty string would otherwise do.
      const av = a.last_login || '', bv = b.last_login || '';
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const c = av.localeCompare(bv);
      return sort.dir === 'asc' ? c : -c;
    });
  }, [users, search, roleFilter, statusFilter, sort]);

  useEffect(() => { setPage(0); }, [search, roleFilter, statusFilter, sort]);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.active !== false).length,
    inactive: users.filter(u => u.active === false).length,
    admins: users.filter(u => u.role === 'admin').length,
  }), [users]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const from = page * PAGE_SIZE;
  const shown = filtered.slice(from, from + PAGE_SIZE);

  const toggleSort = (key: 'full_name' | 'last_login') =>
    setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="max-w-[1200px] px-7 pt-6 pb-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px] mb-4">
        <button onClick={() => router.push('/dashboard')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          Dashboard
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        <span className="font-medium text-[var(--accent)]" aria-current="page">Users</span>
      </nav>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.6px] leading-tight">Users</h1>
          <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
            Who may sign in, and what they may do. Every action they take is attributed to them
            in the audit trail.
          </p>
        </div>
        <Button size="md" className="btn-gradient shrink-0" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Add User
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <UserStat icon={UsersIcon} tone="#5856D6" label="Total users"
                  value={loading ? '—' : String(counts.total)} sub="All accounts" />
        <UserStat icon={ShieldCheck} tone="#34C759" label="Active"
                  value={loading ? '—' : String(counts.active)} sub="Able to sign in" />
        <UserStat icon={UserX} tone="#FF9500" label="Deactivated"
                  value={loading ? '—' : String(counts.inactive)} sub="Sign-in blocked" />
        <UserStat icon={Crown} tone="var(--accent)" label="Administrators"
                  value={loading ? '—' : String(counts.admins)} sub="Full access" />
      </div>

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, username, or role…"
            className="w-full pl-11 pr-4 py-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
        <SelectControl icon={UserCog} value={roleFilter} onChange={setRoleFilter}
                       options={[['', 'Role: All'],
                                 ...(Object.keys(ROLE_LABELS) as Role[]).map(r => [r, ROLE_LABELS[r]] as [string, string])]} />
        <SelectControl icon={Filter} value={statusFilter} onChange={setStatusFilter}
                       options={[['', 'Status: All'], ['active', 'Active'], ['inactive', 'Deactivated']]} />
      </div>

      {loading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No matching users"
                    subtitle="Try a different search term, role, or status." />
      ) : (
        <Card size="md" className="overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <SortableTh label="User" active={sort.key === 'full_name'} dir={sort.dir}
                              onClick={() => toggleSort('full_name')} className="pl-5" />
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <SortableTh label="Last sign-in" active={sort.key === 'last_login'} dir={sort.dir}
                              onClick={() => toggleSort('last_login')} />
                  <Th className="text-right pr-5">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map(u => (
                  <UserRow key={u.id} user={u} isYou={u.id === me?.id}
                           onSetActive={active => setActive(u, active)} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-[var(--border-subtle)]">
            <p className="text-[12px] text-[var(--text-secondary)]">
              Showing {from + 1} to {from + shown.length} of {filtered.length} user{filtered.length === 1 ? '' : 's'}
            </p>
            {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPage={setPage} />}
          </div>
        </Card>
      )}

      {showCreate && (
        <CreateUserDialog
          form={form} setForm={setForm} error={error}
          onCancel={() => { setShowCreate(false); setError(''); }}
          onSubmit={createUser}
        />
      )}
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
      <button onClick={onClick}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(
          'inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.5px] transition-colors',
          active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        )}>
        {label}
        <SlidersHorizontal className="w-3 h-3" />
      </button>
    </th>
  );
}

function UserStat({ icon: Icon, tone, label, value, sub }: {
  icon: React.ElementType; tone: string; label: string; value: string; sub: string;
}) {
  return (
    <Card size="md" className="p-4 flex items-center gap-3.5">
      <span className="w-11 h-11 rounded-[14px] grid place-items-center shrink-0"
            style={{ background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon className="w-[18px] h-[18px]" style={{ color: tone }} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-[var(--text-secondary)] truncate">{label}</span>
        <span className="block text-[22px] font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block text-[11px] text-[var(--text-secondary)] truncate">{sub}</span>
      </span>
    </Card>
  );
}

function SelectControl({ icon: Icon, value, onChange, options }: {
  icon: React.ElementType; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  const label = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1] ?? '';
  return (
    <label className="relative inline-flex items-center gap-2 px-4 py-3 rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] font-medium cursor-pointer transition-colors hover:border-[var(--border-medium)]">
      <Icon className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
      <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
      <select value={value} onChange={e => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Pagination({ page, pageCount, onPage }: {
  page: number; pageCount: number; onPage: (p: number) => void;
}) {
  const nums: (number | '…')[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="flex items-center gap-1.5">
      <PageBtn onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        <ChevronLeft className="w-4 h-4" />
      </PageBtn>
      {nums.map((n, i) => n === '…' ? (
        <span key={`gap${i}`} className="px-1 text-[12px] text-[var(--text-secondary)]">…</span>
      ) : (
        <button key={n} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}
          className={cn(
            'min-w-8 h-8 px-2 rounded-[10px] text-[12px] tabular-nums font-medium transition-colors border',
            n === page
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]',
          )}>
          {n + 1}
        </button>
      ))}
      <PageBtn onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1} aria-label="Next page">
        <ChevronRight className="w-4 h-4" />
      </PageBtn>
    </div>
  );
}

function PageBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest}
      className="grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] disabled:opacity-40 disabled:pointer-events-none">
      {children}
    </button>
  );
}

function UserRow({ user: u, isYou, onSetActive }: {
  user: ManagedUser; isYou: boolean; onSetActive: (active: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const active = u.active !== false;
  const tone = ROLE_TONE[u.role] ?? '#8E8E93';

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (cellRef.current && !cellRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  return (
    <tr className={cn('border-b border-[var(--border-subtle)] last:border-0 transition-colors hover:bg-[var(--cc-tile-hover)]',
                      !active && 'opacity-60')}>
      <td className="pl-5 pr-4 py-3 max-w-[260px]">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[12px] font-bold grid place-items-center shrink-0">
            {initials(u.full_name || u.username)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold truncate">{u.full_name}</span>
              {isYou && (
                <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
                  You
                </span>
              )}
            </span>
            {/* The username, not an email. This system has no email address for
                anyone, and the username is what the audit trail attributes
                actions to — so it is the identifier worth showing. */}
            <span className="block text-[11px] text-[var(--text-secondary)] truncate">{u.username}</span>
          </span>
        </div>
      </td>

      <td className="px-4 py-3">
        <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
              style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>
          {ROLE_LABELS[u.role] ?? u.role}
        </span>
      </td>

      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap"
              style={{ color: active ? '#248A3D' : '#FF9500' }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: active ? '#34C759' : '#FF9500' }} />
          {active ? 'Active' : 'Deactivated'}
        </span>
      </td>

      <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)] whitespace-nowrap">
        {relative(u.last_login)}
      </td>

      <td className="pr-5 pl-4 py-3 text-right relative" ref={cellRef}>
        <button
          onClick={() => setMenu(v => !v)}
          aria-label="User actions"
          aria-expanded={menu}
          className="inline-grid place-items-center w-8 h-8 rounded-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menu && (
          <div className="cc-panel absolute right-5 top-[calc(100%-4px)] w-[210px] z-40 p-1.5 rounded-[14px] animate-menu-in origin-top-right text-left">
            {/* Deactivating your own account would lock you out of the screen
                you would need in order to undo it. */}
            {isYou ? (
              <p className="px-2.5 py-2 text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                This is your own account. Another administrator has to change it.
              </p>
            ) : active ? (
              <button onClick={() => { setMenu(false); onSetActive(false); }}
                      className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px] text-[#FF3B30] hover:bg-[#FF3B30]/10">
                <Ban className="w-3.5 h-3.5" /> Deactivate
              </button>
            ) : (
              <button onClick={() => { setMenu(false); onSetActive(true); }}
                      className="cc-tile w-full flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]">
                <RotateCcw className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> Reactivate
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function CreateUserDialog({ form, setForm, error, onCancel, onSubmit }: {
  form: { username: string; password: string; full_name: string; role: Role };
  setForm: React.Dispatch<React.SetStateAction<{
    username: string; password: string; full_name: string; role: Role;
  }>>;
  error: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const field = 'w-full px-3.5 py-2.5 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-card-solid)] text-[13px] focus:outline-none focus:border-[var(--accent)] transition-colors';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancel}>
      <div className="cc-panel w-full max-w-[460px] rounded-[20px] p-5 animate-menu-in"
           onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add user">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[16px] font-semibold">Add user</h2>
            <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
              Every action this person takes will be recorded against their username.
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close"
                  className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--cc-tile-hover)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Full name">
            <input className={field} value={form.full_name} autoFocus
                   onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <Field label="Username">
            <input className={field} value={form.username} autoComplete="off"
                   onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          </Field>
          <Field label="Password">
            <input className={field} type="password" value={form.password} autoComplete="new-password"
                   onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </Field>
          <Field label="Role">
            <select className={field} value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}>
              {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <p className="mt-3 text-[12px] text-[#FF3B30] leading-relaxed">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" className="btn-gradient" onClick={onSubmit}>Add user</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] font-medium mb-1.5">
        {label}
        {hint && <span className="text-[var(--text-secondary)] font-normal"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}
