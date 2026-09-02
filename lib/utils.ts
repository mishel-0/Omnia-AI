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
