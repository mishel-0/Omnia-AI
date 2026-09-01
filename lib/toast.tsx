'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, typeof CheckCircle2> = { success: CheckCircle2, error: XCircle, info: Info };
const COLORS: Record<ToastType, string> = { success: '#34C759', error: '#FF3B30', info: 'var(--accent)' };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => dismiss(id), 3200);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className="health-card flex items-center gap-2.5 pl-3.5 pr-3 py-3 rounded-[12px] shadow-xl min-w-[240px] max-w-[380px] pointer-events-auto animate-[toast-in_0.2s_ease-out]"
            >
              <Icon className="w-[16px] h-[16px] shrink-0" style={{ color: COLORS[t.type] }} />
              <span className="text-[13px] flex-1">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="p-0.5 rounded-[6px] hover:bg-[var(--skeleton-bg)] shrink-0"
              >
                <X className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
