import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a unique identifier using crypto.randomUUID() with a fallback.
 */
export function uid(): string {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2);
}

/** The letters to show in an avatar for a person's name.
 *
 * Naively taking the first character produced an identical "D" for every
 * clinician on the screen, because in this setting most names are entered as
 * "Dr Sarah Johnson" — three doctors in a table were three identical avatars,
 * which is worse than no avatar at all. Honorifics are dropped and the first
 * and last name-parts are used, so "Dr Sarah Johnson" reads SJ.
 */
const HONORIFICS = new Set([
  'dr', 'dr.', 'prof', 'prof.', 'professor', 'mr', 'mr.', 'mrs', 'mrs.',
  'ms', 'ms.', 'miss', 'mx', 'mx.', 'sir', 'dame',
]);

export function initials(name?: string | null, fallback = '?'): string {
  const parts = (name || '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .filter((p, i, all) => !(i === 0 && all.length > 1 && HONORIFICS.has(p.toLowerCase())));
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** "Just now", "5h ago", "2 days ago" — and an honest answer for never. */
export function relativeTime(iso?: string | null, never = 'Never'): string {
  if (!iso) return never;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return never;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
