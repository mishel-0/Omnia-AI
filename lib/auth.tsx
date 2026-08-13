'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { API_BASE } from '@/lib/constants';

export type Role = 'admin' | 'pathologist' | 'monitor' | 'sponsor';

export interface AuthUser {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  pathologist: 'Pathologist',
  monitor: 'Monitor / CRA',
  sponsor: 'Sponsor (Read-Only)',
};

/** Roles allowed to create/edit/delete trials, patients, and sign off slides. */
export function canWrite(role?: Role | null): boolean {
  return role === 'admin' || role === 'pathologist';
}

/** Roles allowed to view the audit trail. */
export function canViewAudit(role?: Role | null): boolean {
  return role === 'admin' || role === 'monitor';
}

const TOKEN_KEY = 'omnia_auth_token';

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setStoredToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* noop */ }
}
function clearStoredToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

/** Fetch wrapper that attaches the session token automatically.
 * Sessions expire after 12h; without this, an expired session produced silent
 * failures on every action instead of sending the user back to sign in. */
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(opts.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Only set JSON content-type for string bodies — FormData must keep its own
  // multipart boundary, which the browser sets automatically.
  if (opts.body && typeof opts.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (res.status === 401 && token && typeof window !== 'undefined') {
    clearStoredToken();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
  return res;
}

/** Like apiFetch, but throws on a non-2xx response carrying the server's message.
 * `fetch` resolves normally for 4xx/5xx, so callers that only used try/catch were
 * reporting success on failed writes. */
export async function apiSend(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await apiFetch(path, opts);
  let payload: any = null;
  try { payload = await res.json(); } catch { /* empty body is fine */ }
  if (!res.ok) {
    const message = payload?.detail || payload?.error || `Request failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }
  return payload;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  bootstrap: (username: string, password: string, fullName: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch('/api/users/me');
      if (res.ok) {
        setUser(await res.json());
      } else {
        clearStoredToken();
        setUser(null);
      }
    } catch {
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, message: data.detail || 'Invalid username or password.' };
      setStoredToken(data.token);
      setUser(data.user);
      return { ok: true };
    } catch {
      return { ok: false, message: 'Could not connect to backend.' };
    }
  }, []);

  const bootstrap = useCallback(async (username: string, password: string, fullName: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, full_name: fullName }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, message: data.detail || 'Setup failed.' };
      setStoredToken(data.token);
      setUser(data.user);
      return { ok: true };
    } catch {
      return { ok: false, message: 'Could not connect to backend.' };
    }
  }, []);

  const logout = useCallback(async () => {
    try { await apiFetch('/api/users/logout', { method: 'POST' }); } catch { /* noop */ }
    clearStoredToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, bootstrap, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
