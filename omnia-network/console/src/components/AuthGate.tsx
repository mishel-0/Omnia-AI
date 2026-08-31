import React, {
  useState,
} from 'react';
import {
  ShieldCheck,
  ArrowRight,
  Activity,
  KeyRound,
} from 'lucide-react';
import {
   getActiveBaseUrl, setAdminToken, verifyAdminToken ,
} from '../services/api';

interface AuthGateProps {
  onAuthenticated: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // The entered value IS the x-admin-token sent on every /admin/* request —
  // this checks it against the live server (OMNIA_NETWORK_ADMIN_TOKEN),
  // not a hardcoded list. Wrong token, wrong server, or server unreachable
  // all fail the same way: no session starts.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const ok = await verifyAdminToken(password, getActiveBaseUrl());
      if (ok) {
        setAdminToken(password);
        onAuthenticated();
      } else {
        setError('Invalid admin token, or the server rejected it.');
      }
    } catch (err) {
      setError(
        `Could not reach the coordinator server at ${getActiveBaseUrl()}. ` +
          `Confirm it is running and the base URL is correct.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="auth-gate-container"
      className="min-h-screen bg-[#07090e] text-zinc-200 flex flex-col items-center justify-center p-6 relative overflow-hidden"
    >
      {/* Background subtle grid pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293d0a_1px,transparent_1px),linear-gradient(to_bottom,#1f293d0a_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

      {/* Center Console Modal */}
      <div className="w-full max-w-md bg-[#0f131a] border border-zinc-800/80 rounded-xl shadow-2xl p-8 relative z-10">
        <div className="flex items-center gap-3 pb-6 border-b border-zinc-800/60">
          <div className="w-10 h-10 rounded-lg bg-zinc-800/70 border border-zinc-700/60 flex items-center justify-center text-cyan-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-cyan-400">
                Federated Core Node
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                v2.4.1
              </span>
            </div>
            <h1 className="text-lg font-bold tracking-tight text-white mt-0.5">
              Omnia Network Console
            </h1>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div className="p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-lg flex items-start gap-3 text-xs text-zinc-400 leading-relaxed font-mono">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-zinc-300">Central Aggregation Control</p>
              <p className="mt-0.5 text-zinc-500">
                Authenticated session required to inspect pending clinical weights and publish immutable global model releases.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="admin-password-input"
                  className="text-xs font-medium text-zinc-300 flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
                  Admin Token
                </label>
                <span className="text-[11px] text-zinc-500 font-mono">OMNIA_NETWORK_ADMIN_TOKEN</span>
              </div>
              <div className="relative">
                <input
                  id="admin-password-input"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Enter OMNIA_NETWORK_ADMIN_TOKEN..."
                  className="w-full bg-[#090b10] border border-zinc-700/80 rounded-lg px-3.5 py-2.5 text-sm font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-colors"
                  autoFocus
                />
              </div>
              {error && (
                <p id="auth-error-msg" className="mt-1.5 text-xs text-rose-400 font-mono">
                  {error}
                </p>
              )}
            </div>

            <button
              id="admin-login-submit"
              type="submit"
              disabled={isLoading || !password}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/40 transition-colors"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Unlock Ops Console</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Node Status: Online</span>
          </div>
          <span>Confidential Medical AI Ops</span>
        </div>
      </div>
    </div>
  );
};
