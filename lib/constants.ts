// ── API ──────────────────────────────────────────────────────────────────────
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ── DICOM Window/Level Presets ────────────────────────────────────────────────
export const WL_PRESETS: Record<string, { w: number; c: number; label: string }> = {
  lung: { w: 1500, c: -600, label: 'Lung' },
  mediastinal: { w: 400, c: 40, label: 'Mediastinal' },
  bone: { w: 2000, c: 500, label: 'Bone' },
  brain: { w: 80, c: 40, label: 'Brain' },
};
export type PresetKey = keyof typeof WL_PRESETS;
