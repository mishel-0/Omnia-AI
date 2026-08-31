import React, { useState } from 'react';
import { Settings, X, Globe, Radio, CheckCircle2, XCircle } from 'lucide-react';
import { API_BASE_URL } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverUrl: string;
  onUpdateBaseUrl: (newUrl: string) => void;
  onRefresh: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  serverUrl,
  onUpdateBaseUrl,
  onRefresh,
}) => {
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    pingMs: number | null;
    status: 'success' | 'error' | null;
    message: string;
  }>({ pingMs: null, status: null, message: '' });

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = urlInput.trim();
    if (clean) {
      onUpdateBaseUrl(clean);
    }
    onRefresh();
    onClose();
  };

  const handleTest = async () => {
    setIsTesting(true);
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${urlInput.trim().replace(/\/+$/, '')}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const end = performance.now();
      const ping = Math.round(end - start);

      if (res.ok) {
        const json = await res.json();
        setTestResult({
          pingMs: ping,
          status: 'success',
          message: `Connected! Server responded with status: "${json.status}"`,
        });
      } else {
        setTestResult({
          pingMs: ping,
          status: 'error',
          message: `HTTP ${res.status}: ${res.statusText}`,
        });
      }
    } catch (err: any) {
      setTestResult({
        pingMs: null,
        status: 'error',
        message: err.message || 'Connection failed or CORS issue',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div
      id="settings-modal-overlay"
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div
        id="settings-modal"
        className="bg-[#0f131a] border border-zinc-700 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-white font-mono text-sm font-bold uppercase">
            <Settings className="w-4 h-4 text-cyan-400" />
            <span>Coordinator API Settings</span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 font-mono text-xs">
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">
              Backend Base URL:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="http://localhost:8000"
                className="flex-1 bg-[#090b10] border border-zinc-700 rounded px-3 py-2 text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded flex items-center gap-1 shrink-0"
              >
                {isTesting ? (
                  <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-white rounded-full animate-spin" />
                ) : (
                  <Radio className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>Test</span>
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Default: <code className="text-zinc-400">{API_BASE_URL}</code>
            </p>
          </div>

          {testResult.status && (
            <div
              className={`p-2.5 rounded border text-xs ${
                testResult.status === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                {testResult.status === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                )}
                <span>{testResult.status === 'success' ? 'Connected' : 'Ping Failed'}</span>
                {testResult.pingMs !== null && <span>({testResult.pingMs}ms)</span>}
              </div>
              <p className="text-[11px] mt-0.5 opacity-90">{testResult.message}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded"
            >
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
