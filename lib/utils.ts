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
