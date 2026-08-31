/**
 * Formatting utilities for dense ops consoles (tabular numbers, byte sizes, QWK scores, hashes).
 */

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatQwk(score: number | undefined | null): string {
  if (score === undefined || score === null || isNaN(score)) return '0.000';
  return score.toFixed(3);
}

export function getQwkQualityBadge(score: number): {
  label: string;
  badgeClass: string;
  isLow: boolean;
} {
  if (score < 0.65) {
    return {
      label: 'Low QWK',
      badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
      isLow: true,
    };
  }
  if (score < 0.80) {
    return {
      label: 'Acceptable',
      badgeClass: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      isLow: false,
    };
  }
  return {
    label: 'Optimal',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    isLow: false,
  };
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'Never';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return dateString || 'Unknown';
  }
}

export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return 'Never';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 45) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 30) return `${diffDays} days ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return '1 month ago';
    return `${diffMonths} months ago`;
  } catch {
    return 'Unknown';
  }
}

export function getDaysSince(dateString: string | null | undefined): number | null {
  if (!dateString) return null;
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - d.getTime());
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export function truncateHash(hash: string | undefined | null, startChars = 8, endChars = 6): string {
  if (!hash) return '—';
  if (hash.length <= startChars + endChars + 3) return hash;
  return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
}
