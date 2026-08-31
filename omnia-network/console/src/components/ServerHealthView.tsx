import React, { useState } from 'react';
import {
  Activity,
  Server,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RotateCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Settings,
  Terminal,
  Key,
  Globe,
  Radio,
  Lock,
  Zap,
} from 'lucide-react';
import { ServerHealth } from '../types';
import {
  API_BASE_URL,
  getActiveBaseUrl,
  setActiveBaseUrl,
} from '../services/api';

interface ServerHealthViewProps {
  health: ServerHealth | null;
  serverUrl: string;
  isLoading: boolean;
  onRefresh: () => void;
  onUpdateBaseUrl: (newUrl: string) => void;
}

export const ServerHealthView: React.FC<ServerHealthViewProps> = ({
  health,
  serverUrl,
  isLoading,
  onRefresh,
  onUpdateBaseUrl,
}) => {
  const [customUrlInput, setCustomUrlInput] = useState(serverUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    pingMs: number | null;
    status: 'success' | 'error' | null;
    message: string;
  }>({ pingMs: null, status: null, message: '' });

  const isServerUp = health?.status === 'ok' || health?.status === 'healthy';
  const isInsecure = health?.insecure_signing === true;

  const handleSaveBaseUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customUrlInput.trim();
    if (clean) {
      onUpdateBaseUrl(clean);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${customUrlInput.trim().replace(/\/+$/, '')}/health`, {
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
          message: `Connected successfully! Response: status=${json.status}, insecure_signing=${json.insecure_signing}`,
        });
      } else {
        setTestResult({
          pingMs: ping,
          status: 'error',
          message: `Server returned HTTP ${res.status}: ${res.statusText}`,
        });
      }
    } catch (err: any) {
      setTestResult({
        pingMs: null,
        status: 'error',
        message: err.message || 'Connection failed / CORS or host unreachable',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* LOUD, IMPOSSIBLE-TO-MISS WARNING BANNER IF INSECURE SIGNING SECRET REPORTED */}
      {isInsecure && (
        <div
          id="loud-insecure-signing-alert"
          className="bg-[#1a080c] border-2 border-rose-600 rounded-xl p-6 shadow-2xl shadow-rose-950/60 relative overflow-hidden"
        >
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-600 rounded-xl text-white animate-bounce shrink-0 shadow-lg shadow-rose-600/40">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-rose-600 text-white font-mono text-xs font-bold uppercase tracking-wider">
                    CRITICAL VULNERABILITY
                  </span>
                  <span className="text-white font-bold text-base font-mono">
                    Default / Insecure Model Signing Secret Detected
                  </span>
                </div>
                <p className="text-xs text-rose-200/90 font-mono leading-relaxed max-w-3xl">
                  The central federated coordinator reported{' '}
                  <code className="bg-rose-950 px-1.5 py-0.5 rounded border border-rose-800 font-bold text-rose-300">
                    insecure_signing: true
                  </code>
                  . The server is currently signing global model releases and head weight envelopes with a default, low-entropy HMAC/Ed25519 secret. This allows rogue nodes to forge contribution weights without detection.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-rose-800/60 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="p-3 bg-rose-950/70 border border-rose-800/80 rounded-lg text-rose-200 space-y-1">
              <span className="font-bold text-rose-300 block">Immediate Remediation:</span>
              <p className="text-[11px] text-rose-300/80">
                1. Generate a 256-bit cryptographically secure Ed25519 private key.
                <br />
                2. Set <code className="text-white">OMNIA_SIGNING_SECRET</code> in the backend environment.
                <br />
                3. Restart the coordinator service to apply new root of trust.
              </p>
            </div>
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-400 space-y-1">
              <span className="font-bold text-zinc-300 block">Backend Env Configuration:</span>
              <pre className="text-[11px] text-zinc-400 overflow-x-auto">
                # Set in coordinator server .env{'\n'}
                OMNIA_SIGNING_SECRET="ed25519_sk_live_..."{'\n'}
                OMNIA_STRICT_VERIFY=true
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Primary Server Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Node State */}
        <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
              Coordinator Status
            </span>
            <div className="p-2 rounded bg-zinc-850 text-cyan-400">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span
                className={`w-3.5 h-3.5 rounded-full block ${
                  isServerUp
                    ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]'
                    : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]'
                }`}
              />
            </div>
            <span className="text-xl font-bold font-mono text-white">
              {isServerUp ? 'ONLINE / HEALTHY' : 'UNREACHABLE'}
            </span>
          </div>
          <p className="text-xs text-zinc-500 font-mono">
            {isServerUp
              ? 'Accepting incoming clinical head weights from enrolled sites.'
              : 'Cannot connect to coordinator at configured base URL.'}
          </p>
        </div>

        {/* Card 2: Cryptographic Posture */}
        <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
              Signing Verification
            </span>
            <div className="p-2 rounded bg-zinc-850 text-zinc-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xl font-bold font-mono ${
                isInsecure ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {isInsecure ? 'INSECURE SECRET' : 'SECURE SECRET'}
            </span>
          </div>
          <p className="text-xs text-zinc-500 font-mono">
            {isInsecure
              ? 'Flagged: default signing secret must be rotated.'
              : 'Production Ed25519 high-entropy signature key loaded.'}
          </p>
        </div>

        {/* Card 3: Target Server URL */}
        <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
              Target Base URL
            </span>
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1.5 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              title="Ping server"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>
          <div className="font-mono text-sm font-bold text-cyan-400 truncate select-all">
            {serverUrl}
          </div>
          <p className="text-xs text-zinc-500 font-mono">Direct live REST API endpoint</p>
        </div>
      </div>

      {/* Endpoint Diagnostics & Base URL Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Base URL Configuration */}
        <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                API Endpoint Configuration
              </h3>
            </div>
            <span className="text-xs font-mono text-zinc-500">Live Network Settings</span>
          </div>

          <form onSubmit={handleSaveBaseUrl} className="space-y-4 font-mono text-xs">
            <div>
              <label htmlFor="custom-url-input" className="block text-zinc-300 font-semibold mb-1.5">
                REST API Base URL:
              </label>
              <div className="flex gap-2">
                <input
                  id="custom-url-input"
                  type="text"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="e.g. http://localhost:8000 or https://api.omnia-fl.internal"
                  className="flex-1 bg-[#090b10] border border-zinc-700 rounded-md px-3 py-2 text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-md transition-colors flex items-center gap-1.5"
                >
                  {isTesting ? (
                    <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span>Ping</span>
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1.5 leading-relaxed">
                Default constant: <code className="text-zinc-400">{API_BASE_URL}</code> (defined at top of <code className="text-zinc-400">src/services/api.ts</code>)
              </p>
            </div>

            {testResult.status && (
              <div
                className={`p-3 rounded-lg border text-xs font-mono ${
                  testResult.status === 'success'
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  {testResult.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span>
                    {testResult.status === 'success' ? 'Health Check Passed' : 'Health Check Failed'}
                  </span>
                  {testResult.pingMs !== null && (
                    <span className="text-zinc-400 font-normal">({testResult.pingMs}ms)</span>
                  )}
                </div>
                <p className="text-[11px] mt-1 break-words opacity-90">{testResult.message}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-zinc-800/60">
              <button
                type="button"
                onClick={() => {
                  setCustomUrlInput(API_BASE_URL);
                  setActiveBaseUrl(API_BASE_URL);
                  onUpdateBaseUrl(API_BASE_URL);
                }}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                Reset to Default
              </button>
              <button
                id="save-base-url-btn"
                type="submit"
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-md transition-colors"
              >
                Apply & Connect
              </button>
            </div>
          </form>
        </div>

        {/* Right: Contract Endpoints & Sandbox Mode Simulator */}
        <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                API Endpoint Specifications
              </h3>
            </div>
            <span className="text-xs font-mono text-zinc-500">Contract v1.0</span>
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="p-2 bg-zinc-900/60 border border-zinc-800/70 rounded flex items-center justify-between">
              <div>
                <span className="text-cyan-400 font-bold mr-2">GET</span>
                <span className="text-zinc-300">/admin/pending</span>
              </div>
              <span className="text-[11px] text-zinc-500">Weight queues</span>
            </div>
            <div className="p-2 bg-zinc-900/60 border border-zinc-800/70 rounded flex items-center justify-between">
              <div>
                <span className="text-emerald-400 font-bold mr-2">POST</span>
                <span className="text-zinc-300">/admin/merge</span>
              </div>
              <span className="text-[11px] text-zinc-500">Publish release</span>
            </div>
            <div className="p-2 bg-zinc-900/60 border border-zinc-800/70 rounded flex items-center justify-between">
              <div>
                <span className="text-cyan-400 font-bold mr-2">GET</span>
                <span className="text-zinc-300">/admin/releases</span>
              </div>
              <span className="text-[11px] text-zinc-500">Signed artifacts</span>
            </div>
            <div className="p-2 bg-zinc-900/60 border border-zinc-800/70 rounded flex items-center justify-between">
              <div>
                <span className="text-cyan-400 font-bold mr-2">GET</span>
                <span className="text-zinc-300">/admin/sites</span>
              </div>
              <span className="text-[11px] text-zinc-500">Hospital nodes</span>
            </div>
            <div className="p-2 bg-zinc-900/60 border border-zinc-800/70 rounded flex items-center justify-between">
              <div>
                <span className="text-emerald-400 font-bold mr-2">POST</span>
                <span className="text-zinc-300">/admin/sites</span>
              </div>
              <span className="text-[11px] text-zinc-500">Issue API key</span>
            </div>
            <div className="p-2 bg-zinc-900/60 border border-zinc-800/70 rounded flex items-center justify-between">
              <div>
                <span className="text-cyan-400 font-bold mr-2">GET</span>
                <span className="text-zinc-300">/health</span>
              </div>
              <span className="text-[11px] text-zinc-500">Status & security</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
