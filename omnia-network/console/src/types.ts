export interface PendingContribution {
  contribution_id: string;
  site_id: string;
  sample_count: number;
  local_val_qwk: number;
  size_bytes: number;
  received_at: string;
}

export interface ContributionInRelease {
  contribution_id: string;
  site_id: string;
  sample_count?: number;
  local_val_qwk?: number;
  size_bytes?: number;
}

export interface Release {
  version: string;
  contributions: Array<string | ContributionInRelease>;
  total_samples: number;
  published_at: string;
  signature: string;
}

export interface Site {
  site_id: string;
  site_name?: string;
  issued_at: string;
  last_contribution_at: string | null;
  contribution_count: number;
}

export interface IssueKeyResponse {
  site_id: string;
  key: string;
}

export interface ServerHealth {
  status: string;
  insecure_signing: boolean;
  timestamp?: string;
  version?: string;
}

export type NavRoute = 'overview' | 'pending' | 'releases' | 'sites' | 'health';

export interface QualityThresholds {
  minSamples: number;
  minQwk: number;
}
