import React from 'react';
import {
  RotateCw,
  AlertTriangle,
  Server,
  Settings,
  ShieldAlert,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { NavRoute, ServerHealth } from '../types';

interface HeaderProps {
  currentRoute: NavRoute;
  serverHealth: ServerHealth | null;
  serverUrl: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onNavigateToHealth: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRoute,
  serverHealth,
  serverUrl,
  isRefreshing,
  onRefresh,
  onOpenSettings,
  onNavigateToHealth,
}) => {
  const routeTitles: Record<NavRoute, { title: string; subtitle: string }> = {
    overview: {
      title: 'Federation Overview',
      subtitle: 'Real-time telemetry, model releases, and clinical site contribution rates',
    },
    pending: {
      title: 'Pending Head Weight Contributions',
      subtitle: 'Review incoming model weights from clinical nodes and trigger global aggregations',
    },
    releases: {
      title: 'Global Release History',
      subtitle: 'Cryptographically signed global model artifacts published to participating clinical sites',
    },
    sites: {
      title: 'Enrolled Clinical Sites',
      subtitle: 'Manage authorized hospital nodes, monitor contribution activity, and issue credentials',
    },
    health: {
      title: 'Coordinator Health & Diagnostics',
      subtitle: 'Server availability, API endpoint diagnostics, and cryptographic signing posture',
    },
  };

  const currentMeta = routeTitles[currentRoute] || {
    title: 'Console',
    subtitle: 'Federated Learning Coordinator',
  };

  const isServerUp = serverHealth?.status === 'ok' || serverHealth?.status === 'healthy';
  const isInsecure = serverHealth?.insecure_signing === true;

  return (
    <header className="border-b border-zinc-800 bg-[#0d1017]/90 backdrop-blur sticky top-0 z-10">
      {/* LOUD IMPOSSIBLE-TO-MISS INSECURE SIGNING WARNING BANNER */}
      {isInsecure && (
        <div
          id="insecure-signing-loud-banner"
          className="bg-rose-950/90 border-b-2 border-rose-600 px-4 py-3 text-rose-100 flex items-center justify-between shadow-lg shadow-rose-950/50"
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-rose-600 rounded text-white animate-pulse">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider bg-rose-600/30 text-rose-300 px-1.5 py-0.5 rounded border border-rose-500/40">
                  CRITICAL SECURITY NOTICE
                </span>
                <span className="font-semibold text-sm text-white">
                  Server is running with an Insecure / Default Signing Secret!
                </span>
              </div>
              <p className="text-xs text-rose-200/90 mt-0.5 font-mono">
                Model release signatures and head weight uploads may be vulnerable to forgery. Configure a high-entropy secret in your coordinator environment immediately.
              </p>
            </div>
          </div>
          <button
            id="banner-view-security-details"
            onClick={onNavigateToHealth}
            className="shrink-0 ml-4 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-semibold rounded transition-colors flex items-center gap-1.5 shadow"
          >
            <span>View Remediation</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main App Bar */}
      <div className="px-6 py-3.5 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            {currentMeta.title}
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">{currentMeta.subtitle}</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Server status pill */}
          <div
            id="header-server-pill"
            onClick={onNavigateToHealth}
            className="cursor-pointer bg-zinc-900 border border-zinc-800 hover:border-zinc-700 px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-mono transition-colors"
            title="Click to view full health diagnostics"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isServerUp
                  ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                  : 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]'
              }`}
            />
            <span className="text-zinc-300">
              {isServerUp ? 'API Connected' : 'Disconnected'}
            </span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-500 max-w-[120px] truncate">
              {serverUrl.replace(/^https?:\/\//, '')}
            </span>
          </div>

          {/* Quick Refresh */}
          <button
            id="header-refresh-btn"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh active view"
            aria-label="Refresh data"
          >
            <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          {/* Endpoint Settings */}
          <button
            id="header-settings-btn"
            onClick={onOpenSettings}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md text-zinc-300 hover:text-white transition-colors"
            title="API Endpoint Configuration"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
