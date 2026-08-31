import React from 'react';
import {
  LayoutDashboard,
  Layers,
  GitMerge,
  Hospital,
  Activity,
  AlertTriangle,
  Server,
  Lock,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { NavRoute, ServerHealth } from '../types';

interface SidebarProps {
  currentRoute: NavRoute;
  onRouteChange: (route: NavRoute) => void;
  pendingCount: number;
  flaggedPendingCount: number;
  serverHealth: ServerHealth | null;
  serverUrl: string;
  isHealthLoading: boolean;
  onLockSession: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRoute,
  onRouteChange,
  pendingCount,
  flaggedPendingCount,
  serverHealth,
  serverUrl,
  isHealthLoading,
  onLockSession,
}) => {
  const navItems: Array<{
    id: NavRoute;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeVariant?: 'accent' | 'warning';
  }> = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'pending',
      label: 'Pending Contributions',
      icon: <Layers className="w-4 h-4 shrink-0" />,
      badge: pendingCount > 0 ? pendingCount : undefined,
      badgeVariant: flaggedPendingCount > 0 ? 'warning' : 'accent',
    },
    {
      id: 'releases',
      label: 'Release History',
      icon: <GitMerge className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'sites',
      label: 'Sites',
      icon: <Hospital className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'health',
      label: 'Server Health',
      icon: <Activity className="w-4 h-4 shrink-0" />,
      badge: serverHealth?.insecure_signing ? 1 : undefined,
      badgeVariant: 'warning',
    },
  ];

  const isServerUp = serverHealth?.status === 'ok' || serverHealth?.status === 'healthy';
  const isInsecure = serverHealth?.insecure_signing === true;

  return (
    <aside
      id="main-sidebar"
      className="w-64 bg-[#0d1017] border-r border-zinc-800/80 flex flex-col justify-between shrink-0 h-screen sticky top-0 select-none z-20"
    >
      {/* Brand Header */}
      <div>
        <div className="p-4 border-b border-zinc-800/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-cyan-400 font-mono font-bold text-xs">
              Ω
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tracking-tight text-white font-sans">
                  Omnia Console
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono block leading-tight">
                Federated FL Coordinator
              </span>
            </div>
          </div>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-900 text-zinc-400 border border-zinc-800">
            OPS
          </span>
        </div>

        {/* Insecure Signing Warning Banner if detected */}
        {isInsecure && (
          <div
            id="sidebar-security-alert"
            onClick={() => onRouteChange('health')}
            className="mx-3 mt-3 p-2.5 bg-rose-950/40 border border-rose-600/60 rounded-md cursor-pointer hover:bg-rose-950/60 transition-colors group"
          >
            <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 animate-pulse" />
              <span>Insecure Secret Active</span>
            </div>
            <p className="text-[11px] text-rose-300/80 mt-1 font-mono leading-tight">
              Default signing secret reported by central API.
            </p>
          </div>
        )}

        {/* Navigation Routes */}
        <nav className="p-3 space-y-1 mt-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
            Navigation
          </div>
          {navItems.map((item) => {
            const isActive = currentRoute === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => onRouteChange(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all group ${
                  isActive
                    ? 'bg-zinc-800/90 text-white font-semibold shadow-sm border border-zinc-700/60'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={isActive ? 'text-cyan-400' : 'text-zinc-500 group-hover:text-zinc-300'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && (
                  <span
                    className={`font-mono text-[11px] px-1.5 py-0.2 rounded-full font-bold tabular-nums ${
                      item.badgeVariant === 'warning'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer: Server Health & Admin Action */}
      <div className="p-3 border-t border-zinc-800/70 space-y-2 bg-[#090b10]/60">
        {/* Server Health Status Tile */}
        <button
          id="sidebar-server-status-btn"
          onClick={() => onRouteChange('health')}
          className="w-full p-2.5 bg-zinc-900/80 hover:bg-zinc-900 border border-zinc-800 rounded-md text-left transition-colors flex items-center justify-between group"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative">
              <span
                className={`w-2.5 h-2.5 rounded-full block ${
                  isHealthLoading
                    ? 'bg-zinc-500 animate-ping'
                    : isServerUp
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                    : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                }`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-zinc-300 group-hover:text-white">
                  Server {isServerUp ? 'Healthy' : isHealthLoading ? 'Pinging...' : 'Offline'}
                </span>
                {isInsecure && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Security Warning" />
                )}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono truncate block max-w-[130px]">
                {serverUrl.replace(/^https?:\/\//, '')}
              </span>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
        </button>

        {/* Lock Console Button */}
        <button
          id="sidebar-lock-btn"
          onClick={onLockSession}
          className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded text-[11px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors border border-transparent hover:border-zinc-700/50"
        >
          <Lock className="w-3 h-3 text-zinc-500" />
          <span>Lock Admin Session</span>
        </button>
      </div>
    </aside>
  );
};
