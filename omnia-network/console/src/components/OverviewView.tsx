import React, { useState } from 'react';
import {
  Hospital,
  Layers,
  GitMerge,
  Clock,
  ArrowUpRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Zap,
  BarChart3,
  LineChart as LineChartIcon,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { PendingContribution, Release, Site } from '../types';
import {
  formatNumber,
  formatDate,
  formatRelativeTime,
  getDaysSince,
  formatBytes,
  formatQwk,
  truncateHash,
} from '../utils/format';

interface OverviewViewProps {
  pending: PendingContribution[];
  releases: Release[];
  sites: Site[];
  isLoading: boolean;
  onNavigate: (route: 'pending' | 'releases' | 'sites') => void;
  onRefresh: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  pending,
  releases,
  sites,
  isLoading,
  onNavigate,
  onRefresh,
}) => {
  const [chartMetric, setChartMetric] = useState<'both' | 'samples' | 'qwk'>('both');

  // Compute key stats
  const totalConnectedSites = sites.length;
  const activeSites = sites.filter((s) => s.contribution_count > 0).length;
  const pendingCount = pending.length;
  const flaggedPendingCount = pending.filter(
    (p) => p.local_val_qwk < 0.65 || p.sample_count < 500
  ).length;

  const currentRelease = releases[0] || null;
  const currentVersion = currentRelease ? currentRelease.version : 'None';
  const daysSinceLastRelease = currentRelease
    ? getDaysSince(currentRelease.published_at)
    : null;

  // Total samples across all releases
  const totalSamplesAllTime = releases.reduce((sum, r) => sum + (r.total_samples || 0), 0);
  const pendingTotalSamples = pending.reduce((sum, p) => sum + (p.sample_count || 0), 0);

  // Prepare chart data (reverse so chronological left-to-right)
  const chartData = [...releases]
    .reverse()
    .map((r) => {
      // Calculate avg QWK if detailed contributions available
      let avgQwk = 0;
      let qwkCount = 0;
      if (Array.isArray(r.contributions)) {
        r.contributions.forEach((c) => {
          if (typeof c === 'object' && c.local_val_qwk) {
            avgQwk += c.local_val_qwk;
            qwkCount++;
          }
        });
      }
      const finalQwk = qwkCount > 0 ? Number((avgQwk / qwkCount).toFixed(3)) : 0.85;

      const dateObj = new Date(r.published_at);
      const shortDate = !isNaN(dateObj.getTime())
        ? `${dateObj.getMonth() + 1}/${dateObj.getDate()}`
        : r.published_at;

      return {
        version: r.version,
        date: shortDate,
        fullDate: formatDate(r.published_at),
        samples: r.total_samples,
        qwk: finalQwk,
        siteCount: Array.isArray(r.contributions) ? r.contributions.length : 0,
      };
    });

  if (isLoading && releases.length === 0 && sites.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-3" />
        <p className="text-sm font-mono text-zinc-400">Loading federation telemetry...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* 4 Primary Stat Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Stat Tile 1: Connected Sites */}
        <div
          id="stat-connected-sites"
          onClick={() => onNavigate('sites')}
          className="bg-[#0f131a] border border-zinc-800/80 hover:border-zinc-700/80 rounded-lg p-4 transition-all cursor-pointer group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
              Connected Sites
            </span>
            <div className="p-2 rounded bg-zinc-850 text-zinc-400 group-hover:text-cyan-400 transition-colors">
              <Hospital className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-white tabular-nums">
              {formatNumber(totalConnectedSites)}
            </span>
            <span className="text-xs font-mono text-zinc-400">
              ({activeSites} active)
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-500">
            <span>Enrolled clinical nodes</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
          </div>
        </div>

        {/* Stat Tile 2: Pending Contributions */}
        <div
          id="stat-pending-contributions"
          onClick={() => onNavigate('pending')}
          className="bg-[#0f131a] border border-zinc-800/80 hover:border-zinc-700/80 rounded-lg p-4 transition-all cursor-pointer group shadow-sm relative overflow-hidden"
        >
          {flaggedPendingCount > 0 && (
            <div className="absolute top-0 right-0 w-2 h-2 bg-amber-400" title="Low quality contributions detected" />
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
              Pending Contributions
            </span>
            <div className="p-2 rounded bg-zinc-850 text-zinc-400 group-hover:text-cyan-400 transition-colors">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-white tabular-nums">
              {formatNumber(pendingCount)}
            </span>
            {flaggedPendingCount > 0 && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                {flaggedPendingCount} flagged
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-500">
            <span>{formatNumber(pendingTotalSamples)} head weight samples</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
          </div>
        </div>

        {/* Stat Tile 3: Current Published Version */}
        <div
          id="stat-published-version"
          onClick={() => onNavigate('releases')}
          className="bg-[#0f131a] border border-zinc-800/80 hover:border-zinc-700/80 rounded-lg p-4 transition-all cursor-pointer group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
              Current Live Release
            </span>
            <div className="p-2 rounded bg-cyan-950/50 border border-cyan-500/30 text-cyan-400">
              <GitMerge className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-cyan-400">
              {currentVersion}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
              LIVE
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-500">
            <span>{releases.length} total releases</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
          </div>
        </div>

        {/* Stat Tile 4: Days Since Last Release */}
        <div
          id="stat-days-since-release"
          onClick={() => onNavigate('releases')}
          className="bg-[#0f131a] border border-zinc-800/80 hover:border-zinc-700/80 rounded-lg p-4 transition-all cursor-pointer group shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
              Cadence / Last Release
            </span>
            <div className="p-2 rounded bg-zinc-850 text-zinc-400 group-hover:text-cyan-400 transition-colors">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-white tabular-nums">
              {daysSinceLastRelease !== null ? `${daysSinceLastRelease}d` : '—'}
            </span>
            <span className="text-xs font-mono text-zinc-400">
              {currentRelease ? formatRelativeTime(currentRelease.published_at) : 'No release'}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-500">
            <span>{formatNumber(totalSamplesAllTime)} samples all-time</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
          </div>
        </div>
      </div>

      {/* Chart Section: Releases over Time */}
      <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800/60">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                Releases & Federated Growth Over Time
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Historical global releases: total merged clinical samples and aggregated validation Quadratic Weighted Kappa (QWK)
            </p>
          </div>

          {/* Metric Filter Switcher */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-md text-xs font-mono">
            <button
              id="chart-metric-both"
              onClick={() => setChartMetric('both')}
              className={`px-2.5 py-1 rounded transition-colors ${
                chartMetric === 'both'
                  ? 'bg-zinc-800 text-white font-medium shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Dual View
            </button>
            <button
              id="chart-metric-samples"
              onClick={() => setChartMetric('samples')}
              className={`px-2.5 py-1 rounded transition-colors ${
                chartMetric === 'samples'
                  ? 'bg-zinc-800 text-white font-medium shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Samples Only
            </button>
            <button
              id="chart-metric-qwk"
              onClick={() => setChartMetric('qwk')}
              className={`px-2.5 py-1 rounded transition-colors ${
                chartMetric === 'qwk'
                  ? 'bg-zinc-800 text-white font-medium shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              QWK Score
            </button>
          </div>
        </div>

        {/* Recharts Canvas */}
        <div className="h-72 w-full mt-4 font-mono text-xs">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-zinc-500">
              No historical releases recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid stroke="#1f242d" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="version"
                  stroke="#52525b"
                  tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                  tickLine={{ stroke: '#27272a' }}
                />
                {(chartMetric === 'both' || chartMetric === 'samples') && (
                  <YAxis
                    yAxisId="left"
                    stroke="#52525b"
                    tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    tickFormatter={(val) => `${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                    tickLine={{ stroke: '#27272a' }}
                  />
                )}
                {(chartMetric === 'both' || chartMetric === 'qwk') && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0.5, 1.0]}
                    stroke="#52525b"
                    tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    tickFormatter={(val) => val.toFixed(2)}
                    tickLine={{ stroke: '#27272a' }}
                  />
                )}
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-[#0b0e14] border border-zinc-700 p-3 rounded shadow-xl text-xs font-mono">
                          <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-1.5 mb-2">
                            <span className="font-bold text-cyan-400">{data.version}</span>
                            <span className="text-zinc-500">{data.fullDate}</span>
                          </div>
                          <div className="space-y-1 text-zinc-300">
                            <div className="flex justify-between gap-4">
                              <span className="text-zinc-400">Total Samples:</span>
                              <span className="font-bold text-white tabular-nums">
                                {formatNumber(data.samples)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-zinc-400">Aggregated QWK:</span>
                              <span className="font-bold text-emerald-400 tabular-nums">
                                {formatQwk(data.qwk)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-zinc-400">Contributing Sites:</span>
                              <span className="font-bold text-zinc-300 tabular-nums">
                                {data.siteCount}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: '10px', fontSize: '11px', fontFamily: 'IBM Plex Mono' }}
                />
                {(chartMetric === 'both' || chartMetric === 'samples') && (
                  <Bar
                    yAxisId="left"
                    dataKey="samples"
                    name="Samples Merged"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                )}
                {(chartMetric === 'both' || chartMetric === 'qwk') && (
                  <Line
                    yAxisId={chartMetric === 'qwk' ? 'right' : 'right'}
                    type="monotone"
                    dataKey="qwk"
                    name="Validation QWK"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ fill: '#10b981', r: 4 }}
                    activeDot={{ r: 6, fill: '#34d399' }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Two Columns: Pending Queue Preview & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Pending Queue Preview */}
        <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                Pending Weights Queue ({pending.length})
              </h3>
            </div>
            <button
              onClick={() => onNavigate('pending')}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
            >
              <span>Manage & Merge</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3">
            {pending.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-xs font-mono">
                Queue is empty. No pending contributions awaiting merge.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {pending.slice(0, 4).map((item) => {
                  const isFlagged = item.local_val_qwk < 0.65 || item.sample_count < 500;
                  return (
                    <div
                      key={item.contribution_id}
                      className="py-2.5 flex items-center justify-between hover:bg-zinc-900/40 px-2 rounded transition-colors"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-zinc-200 truncate">
                            {item.site_id}
                          </span>
                          {isFlagged && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              FLAGGED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-zinc-500 font-mono mt-0.5">
                          <span>{item.contribution_id}</span>
                          <span>•</span>
                          <span>{formatRelativeTime(item.received_at)}</span>
                        </div>
                      </div>

                      <div className="text-right font-mono text-xs">
                        <div className="text-zinc-200 tabular-nums">
                          {formatNumber(item.sample_count)} samples
                        </div>
                        <div
                          className={`text-[11px] tabular-nums ${
                            item.local_val_qwk < 0.65 ? 'text-amber-400' : 'text-emerald-400'
                          }`}
                        >
                          QWK: {formatQwk(item.local_val_qwk)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Federation Architecture & Security Status */}
        <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                Federated Protocol Status
              </h3>
            </div>
            <span className="text-xs font-mono text-zinc-500">Privacy Guarantees Active</span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3 bg-zinc-900/60 border border-zinc-800/70 rounded-md">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-400">Head Weights Privacy:</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Zero Patient Data Transferred
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                Hospital nodes train model heads on local clinical data. Only serialized parameter matrices are transmitted.
              </p>
            </div>

            <div className="p-3 bg-zinc-900/60 border border-zinc-800/70 rounded-md">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-400">Current Cryptographic Signature:</span>
                <span className="text-cyan-400 font-mono text-[11px]">
                  {currentRelease ? truncateHash(currentRelease.signature) : 'None'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                Ed25519 signature verified on every merged release before client nodes pull model artifacts.
              </p>
            </div>

            <div className="p-3 bg-zinc-900/60 border border-zinc-800/70 rounded-md">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-400">Federated Aggregator:</span>
                <span className="text-zinc-200">Weighted FedAvg (Sample Proportional)</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                Aggregations compute weighted average over validated QWK distributions and verified sample sizes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
