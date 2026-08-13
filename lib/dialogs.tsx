'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, Button } from '@/components/ui';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
}

interface DialogContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve }));
  }, []);

  const prompt = useCallback((opts: PromptOptions) => {
    setPromptValue(opts.defaultValue || '');
    return new Promise<string | null>((resolve) => setPromptState({ ...opts, resolve }));
  }, []);

  const closeConfirm = (value: boolean) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  const closePrompt = (value: string | null) => {
    promptState?.resolve(value);
    setPromptState(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}

      {confirmState && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4" onClick={() => closeConfirm(false)}>
          <Card size="lg" className="w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              {confirmState.danger && (
                <div className="w-9 h-9 rounded-full bg-[#FF3B30]/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-[18px] h-[18px] text-[#FF3B30]" />
                </div>
              )}
              <div>
                <h2 className="text-[16px] font-semibold">{confirmState.title}</h2>
                <p className="text-[13px] text-[var(--text-secondary)] mt-1 leading-relaxed">{confirmState.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => closeConfirm(false)}>Cancel</Button>
              <Button variant={confirmState.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)}>
                {confirmState.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {promptState && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4" onClick={() => closePrompt(null)}>
          <Card size="lg" className="w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-semibold">{promptState.title}</h2>
            {promptState.message && <p className="text-[13px] text-[var(--text-secondary)] mt-1">{promptState.message}</p>}
            <input
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              placeholder={promptState.placeholder}
              onKeyDown={(e) => e.key === 'Enter' && closePrompt(promptValue)}
              className="w-full mt-4 px-3 py-2.5 rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]"
            />
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => closePrompt(null)}>Cancel</Button>
              <Button onClick={() => closePrompt(promptValue)} disabled={!promptValue.trim()}>
                {promptState.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialogs(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs must be used within a DialogProvider');
  return ctx;
}
