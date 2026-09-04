// ── API ──────────────────────────────────────────────────────────────────────
//
// NEXT_PUBLIC_API_URL is inlined when the frontend is built, so it always says
// 8000. The desktop app picks a free port at launch — 8000 is only a preference
// — and hands the real one to the page through the preload bridge. Resolve it
// per call rather than once at module load: this module is evaluated during
// server rendering too, where `window` does not exist and the compiled default
// is the only answer available.
export function apiBase(): string {
  if (typeof window !== 'undefined') {
    const injected = (window as unknown as { omnia?: { apiBase?: string | null } }).omnia?.apiBase;
    if (injected) return injected;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
}

// The compiled default is deliberately not exported. Anything importing it
// would be correct only while the backend sits on its preferred port, which is
// exactly the assumption this change exists to remove.

// ── DICOM Window/Level Presets ────────────────────────────────────────────────
export const WL_PRESETS: Record<string, { w: number; c: number; label: string }> = {
  lung: { w: 1500, c: -600, label: 'Lung' },
  mediastinal: { w: 400, c: 40, label: 'Mediastinal' },
  bone: { w: 2000, c: 500, label: 'Bone' },
  brain: { w: 80, c: 40, label: 'Brain' },
};
export type PresetKey = keyof typeof WL_PRESETS;
