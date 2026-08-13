'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { API_BASE } from '@/lib/constants';
import { Card, Button, IconBadge } from '@/components/ui';
const POLL_INTERVAL = 3000;

type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

export function BackendConnection({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;

    const check = async (): Promise<boolean> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API_BASE}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.ok;
      } catch {
        return false;
      }
    };

    const poll = async () => {
      const ok = await check();
      if (!mountedRef.current) return;
      if (ok) {
        setStatus('connected');
        return;
      }
      retryCountRef.current += 1;
      const backoff = Math.min(2000 + retryCountRef.current * 500, 30000);
      timerId = setTimeout(poll, Math.min(POLL_INTERVAL, backoff));
    };

    poll();

    // Re-check every 30s to detect backend drops
    const heartbeat = setInterval(async () => {
      if (!mountedRef.current) return;
      const ok = await check();
      if (!mountedRef.current) return;
      if (ok) {
        if (status === 'disconnected') {
          setStatus('connected');
        }
      } else {
        if (status === 'connected') {
          setStatus('disconnected');
          retryCountRef.current = 0;
          timerId = setTimeout(poll, POLL_INTERVAL);
        }
      }
    }, 30000);

    return () => {
      clearTimeout(timerId);
      clearInterval(heartbeat);
    };
  }, [status]);

  if (status === 'checking') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-primary)] theme-transition">
        <div className="flex flex-col items-center gap-6 max-w-sm text-center px-6">
          <div className="w-[48px] h-[48px] rounded-full border-[3px] border-[#007AFF]/20 border-t-[#007AFF] animate-spin" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold">Connecting to Omnia Pathology AI backend…</span>
            <span className="text-[11px] text-[var(--text-secondary)]">Starting server at {API_BASE}</span>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-primary)] theme-transition px-6">
        <Card size="lg" className="max-w-sm w-full p-8 text-center">
          <IconBadge icon={AlertTriangle} accent="red" size={64} className="rounded-full mx-auto mb-5" />
          <p className="text-[15px] font-bold mb-1.5">Backend not reachable</p>
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-6">
            The Omnia Pathology AI server at{' '}
            <code className="bg-[var(--skeleton-bg)] px-1.5 py-0.5 rounded text-[11px]">{API_BASE}</code>{' '}
            is not responding.
          </p>
          <Button size="lg" className="w-full" onClick={() => { setStatus('checking'); retryCountRef.current = 0; }}>
            Retry Connection
          </Button>
          <span className="block text-[10px] text-[var(--text-secondary)] mt-4">
            Make sure the backend server is running, then click Retry.
          </span>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
