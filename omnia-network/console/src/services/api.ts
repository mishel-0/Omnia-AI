/**
 * Omnia Network Console - API Client
 *
 * Base configuration and HTTP client for federated learning coordination server.
 * Modify API_BASE_URL below to point to your live backend endpoint.
 */

import {
  PendingContribution,
  Release,
  Site,
  ServerHealth,
  IssueKeyResponse,
} from '../types';

// ============================================================================
// CONFIGURATION: Set your REST API base URL here
// ============================================================================
export const API_BASE_URL = 'http://localhost:8420';

// Storage key for custom override if changed in settings UI
const API_URL_STORAGE_KEY = 'omnia_api_base_url';
// Session-only (not localStorage): the admin token should not outlive the
// browser tab any longer than it has to. It is the actual x-admin-token
// this app authenticates every /admin/* request with — not a decorative
// passcode — so treat it with the same care as any other bearer credential.
const ADMIN_TOKEN_STORAGE_KEY = 'omnia_admin_token';

export function getActiveBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(API_URL_STORAGE_KEY);
    if (saved) return saved.replace(/\/+$/, '');
  }
  return API_BASE_URL.replace(/\/+$/, '');
}

export function setActiveBaseUrl(url: string): void {
  if (typeof window !== 'undefined') {
    if (url && url !== API_BASE_URL) {
      localStorage.setItem(API_URL_STORAGE_KEY, url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(API_URL_STORAGE_KEY);
    }
  }
}

export function getAdminToken(): string {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
  }
  return '';
}

export function setAdminToken(token: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  }
}

export function clearAdminToken(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
}

function authHeaders(): Record<string, string> {
  return { 'x-admin-token': getAdminToken() };
}

/**
 * Verifies a candidate admin token against the live server by calling a real
 * admin-gated endpoint. Returns true only if the server itself accepts it —
 * there is no client-side passcode list to satisfy instead.
 */
export async function verifyAdminToken(token: string, baseUrl = getActiveBaseUrl()): Promise<boolean> {
  const res = await fetch(`${baseUrl}/admin/sites`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'x-admin-token': token },
  });
  return res.ok;
}

// ============================================================================
// REST API METHODS — every call goes to the live server. There is no mock
// or sandbox mode: this console only ever reflects what the coordinator
// server actually has on disk.
// ============================================================================

async function handleResponse<T>(res: Response, endpoint: string): Promise<T> {
  if (!res.ok) {
    let errorDetail = '';
    try {
      const errorJson = await res.json();
      errorDetail = errorJson.message || errorJson.error || JSON.stringify(errorJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(
      `HTTP ${res.status} ${res.statusText} on ${endpoint}: ${errorDetail || 'Request failed'}`
    );
  }
  return res.json() as Promise<T>;
}

/**
 * GET /admin/pending
 * Retrieves pending contribution weights from clinical sites awaiting aggregation.
 */
export async function fetchPendingContributions(baseUrl = getActiveBaseUrl()): Promise<PendingContribution[]> {
  const res = await fetch(`${baseUrl}/admin/pending`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      ...authHeaders(),
    },
  });
  return handleResponse<PendingContribution[]>(res, '/admin/pending');
}

/**
 * POST /admin/merge
 * Merges selected contribution IDs into a new immutable global model release.
 */
export async function mergeContributions(
  contributionIds: string[],
  baseUrl = getActiveBaseUrl()
): Promise<Release> {
  const res = await fetch(`${baseUrl}/admin/merge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ contribution_ids: contributionIds }),
  });
  return handleResponse<Release>(res, '/admin/merge');
}

/**
 * GET /admin/releases
 * Retrieves all published federated global model versions and metadata.
 */
export async function fetchReleases(baseUrl = getActiveBaseUrl()): Promise<Release[]> {
  const res = await fetch(`${baseUrl}/admin/releases`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      ...authHeaders(),
    },
  });
  return handleResponse<Release[]>(res, '/admin/releases');
}

/**
 * GET /admin/sites
 * Retrieves all enrolled clinical sites, keys status, and contribution counts.
 */
export async function fetchSites(baseUrl = getActiveBaseUrl()): Promise<Site[]> {
  const res = await fetch(`${baseUrl}/admin/sites`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      ...authHeaders(),
    },
  });
  return handleResponse<Site[]>(res, '/admin/sites');
}

/**
 * POST /admin/sites
 * Issues a new authorization key for a clinical site.
 */
export async function issueSiteKey(
  siteName: string,
  baseUrl = getActiveBaseUrl()
): Promise<IssueKeyResponse> {
  const res = await fetch(`${baseUrl}/admin/sites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ site_name: siteName }),
  });
  return handleResponse<IssueKeyResponse>(res, '/admin/sites');
}

/**
 * GET /health
 * Checks central coordination server status and signing secret security.
 */
export async function fetchHealth(baseUrl = getActiveBaseUrl()): Promise<ServerHealth> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return handleResponse<ServerHealth>(res, '/health');
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
}
