'use client';

/**
 * Startup and connection gate.
 *
 * This is the first screen anyone sees, so it speaks in the product's terms,
 * not the implementation's. It previously read "Connecting to Omnia Pathology
 * AI backend… Starting server at http://localhost:8000" — a host and port
 * mean nothing to a pathologist, and a URL on the launch screen of clinical
 * software reads as a developer build. The address still matters when
 * something is wrong, so it lives behind a technical-details disclosure that
 * support can ask for, rather than in front of every user on every launch.
 */

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { API_BASE } from '@/lib/constants';
import { Card, Button, IconBadge } from '@/components/ui';

const POLL_INTERVAL = 3000;
const HEARTBEAT_INTERVAL = 15000;
/** A single failed probe is not proof the backend died. Slide analysis is
 * CPU-bound and can briefly delay any request, so requiring consecutive
 * failures stops a momentary blip from throwing a pathologist out to a
 * dead-end error screen mid-review. */
const FAILURES_BEFORE_DISCONNECT = 3;
/** Generous on purpose: the probe competes with analysis for CPU, and a
 * slow answer still means "alive". */
const HEALTH_TIMEOUT_MS = 12000;

/**
 * What the start-up screen says as time passes.
 *
 * Driven by real elapsed seconds, not a fabricated progress bar. First launch
 * after an update genuinely takes ~50s because the analysis engine unpacks
 * itself, and a spinner that says nothing for fifty seconds reads as a hang.
 * Each line is true at the moment it appears.
 */
const STARTUP_STAGES: { after: number; text: string }[] = [
  { after: 0, text: 'Starting Omnia Pathology AI…' },
  { after: 6, text: 'Preparing the analysis engine…' },
  { after: 18, text: 'Loading the grading model…' },
  { after: 35, text: 'Almost ready — first start after an update takes longer.' },
  { after: 70, text: 'Still working. This is taking longer than usual.' },
];

type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

export function BackendConnection({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [elapsed, setElapsed] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const mountedRef = useRef(true);
  // Status is mirrored into a ref so the polling loop can read the current
  // value without being in the effect's dependency list. Keying the effect
  // on `status` tore down and rebuilt the timers on every transition.
  const statusRef = useRef<ConnectionStatus>('checking');
  const failuresRef = useRef(0);

  const apply = (next: ConnectionStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Count only while waiting, and reset on each new attempt, so the staged
  // text always reflects this attempt rather than total page lifetime.
  useEffect(() => {
    if (status !== 'checking') return;
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(() => {
      if (mountedRef.current) setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;

    const check = async (): Promise<boolean> => {
      const controller = new AbortController();
      // Cleared in `finally`, not after the await. On the throw path — which
      // is the path taken the whole time the backend is down, and so the one
      // this polls hardest — the timer was being left pending to fire
      // abort() at a controller that had already settled.
      const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/health`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    };

    // Runs while we are not yet connected: keeps retrying indefinitely with
    // backoff, and recovers on its own once the backend answers.
    const poll = async () => {
      const ok = await check();
      if (!mountedRef.current) return;
      if (ok) {
        failuresRef.current = 0;
        apply('connected');
        return;
      }
      failuresRef.current += 1;
      if (failuresRef.current >= FAILURES_BEFORE_DISCONNECT) apply('disconnected');
      timerId = setTimeout(poll, POLL_INTERVAL);
    };

    poll();

    // Once connected, a slower heartbeat notices the engine going away.
    const heartbeat = setInterval(async () => {
      if (statusRef.current !== 'connected') return;
      const ok = await check();
      if (!mountedRef.current) return;
      if (ok) {
        failuresRef.current = 0;
        return;
      }
      failuresRef.current += 1;
      if (failuresRef.current >= FAILURES_BEFORE_DISCONNECT) {
        apply('disconnected');
        timerId = setTimeout(poll, POLL_INTERVAL);
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      clearTimeout(timerId);
      clearInterval(heartbeat);
    };
  }, []);

  if (status === 'checking') {
    const stage = [...STARTUP_STAGES].reverse().find(s => elapsed >= s.after) ?? STARTUP_STAGES[0];
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-primary)] theme-transition">
        <div className="flex flex-col items-center gap-6 max-w-sm text-center px-6">
          <div className="w-[48px] h-[48px] rounded-full border-[3px] border-[#007AFF]/20 border-t-[#007AFF] animate-spin" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold">{stage.text}</span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              Everything runs on this computer. No patient data is sent anywhere.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-primary)] theme-transition px-6">
        <Card size="lg" className="max-w-md w-full p-8">
          <IconBadge icon={AlertTriangle} accent="red" size={64} className="rounded-full mx-auto mb-5" />
          <p className="text-[15px] font-bold mb-1.5 text-center">Omnia could not start</p>
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-5 text-center">
            The analysis engine is not responding. Your trials, patients and signed reports are
            stored on this computer and are not affected.
          </p>

          {/* Ordered by what a non-technical user can actually do, cheapest
              first. A bare "contact support" would waste the two attempts
              that resolve nearly all of these. */}
          <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 mb-5">
            <p className="text-[11.5px] font-semibold mb-1.5">What to try</p>
            <ol className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed list-decimal pl-4 space-y-1">
              <li>Wait a few more seconds — the engine can take a while on first start.</li>
              <li>Select <strong className="text-[var(--text-primary)]">Try again</strong> below.</li>
              <li>Quit Omnia completely and reopen it.</li>
            </ol>
          </div>

          <Button size="lg" className="w-full" onClick={() => { failuresRef.current = 0; apply('checking'); }}>
            Try again
          </Button>
          <span className="block text-[10px] text-[var(--text-secondary)] mt-3 text-center">
            Omnia keeps retrying on its own.
          </span>

          {/* Kept for support, out of the way for everyone else. */}
          <button
            onClick={() => setShowDetails(v => !v)}
            aria-expanded={showDetails}
            className="mt-4 w-full flex items-center justify-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Technical details
            <ChevronDown className={'w-3 h-3 transition-transform ' + (showDetails ? 'rotate-180' : '')} />
          </button>
          {showDetails && (
            <div className="mt-2 rounded-[8px] bg-[var(--skeleton-bg)] px-3 py-2">
              <p className="text-[10.5px] text-[var(--text-secondary)] leading-relaxed break-all">
                Local service address: <code>{API_BASE}</code>
              </p>
              <p className="text-[10.5px] text-[var(--text-secondary)] leading-relaxed mt-1">
                A health check to this address did not succeed after{' '}
                {FAILURES_BEFORE_DISCONNECT} attempts. Another program may already be using this
                port.
              </p>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
