'use client';

/**
 * System health strip.
 *
 * Omnia repairs a number of things on its own in the background. That work is
 * only trustworthy if it is visible: a component that fails quietly while the
 * app looks fine is exactly the situation this reports.
 *
 * It renders nothing while everything is healthy. A permanent green banner
 * trains people to ignore the space it occupies, so the row appears only when
 * it has something to say.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react';
import { apiSend } from '@/lib/auth';
import { useToast } from '@/lib/toast';

interface WorkerRow {
  name: string;
  description: string;
  state: string;
  healthy: boolean;
  last_error: string | null;
  last_ok: string | null;
  last_action: string | null;
  consecutive_failures: number;
}
interface WorkersStatus {
  healthy: boolean;
  unhealthy: string[];
  workers: WorkerRow[];
}

/** Slow on purpose: this is a safety net, not a live monitor, and it must not
 *  compete with slide analysis for CPU. */
const POLL_MS = 60000;

export default function SystemHealth() {
  const [status, setStatus] = useState<WorkersStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setStatus(await apiSend('/api/system/workers'));
    } catch {
      // The health strip must never itself become an error state; if it
      // cannot be read, the connection gate is already reporting that.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const runNow = async (name: string) => {
    setBusy(true);
    try {
      const res = await apiSend(`/api/system/workers/${name}/run`, { method: 'POST' });
      toast.show(res.ok ? res.action : `Still failing: ${res.error}`, res.ok ? 'info' : 'error');
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not run the check', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!status || status.healthy) return null;

  const failing = status.workers.filter(w => !w.healthy);

  return (
    <div className="max-w-6xl mx-auto px-6 pt-4">
      <div className="rounded-[12px] border border-[#FF9500]/30 bg-[#FF9500]/[0.07] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-[#FF9500] shrink-0 mt-[1px]" />
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-semibold">
              {failing.length === 1
                ? 'A background task needs attention'
                : `${failing.length} background tasks need attention`}
            </p>
            <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
              Omnia keeps itself in order automatically. Something it looks after has repeatedly
              failed. Your trials, patients and signed reports are unaffected — you can keep
              working, but this is worth telling your administrator about.
            </p>

            <button
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-[#007AFF] hover:underline"
            >
              {expanded ? 'Hide details' : 'Show details'}
              <ChevronDown className={'w-3 h-3 transition-transform ' + (expanded ? 'rotate-180' : '')} />
            </button>

            {expanded && (
              <div className="mt-2.5 space-y-2">
                {failing.map(w => (
                  <div key={w.name} className="rounded-[8px] bg-[var(--bg-card-solid)] border border-[var(--border-subtle)] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium">{w.description || w.name}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          Failed {w.consecutive_failures} time{w.consecutive_failures === 1 ? '' : 's'} in a row
                          {w.last_ok ? ` · last succeeded ${new Date(w.last_ok).toLocaleString()}` : ' · has not yet succeeded'}
                        </p>
                        {w.last_error && (
                          <p className="text-[10.5px] text-[var(--text-secondary)] mt-1 font-mono break-all">
                            {w.last_error}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => runNow(w.name)}
                        disabled={busy}
                        className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#007AFF] hover:underline disabled:opacity-50"
                      >
                        <RefreshCw className={'w-3 h-3 ' + (busy ? 'animate-spin' : '')} /> Run now
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
