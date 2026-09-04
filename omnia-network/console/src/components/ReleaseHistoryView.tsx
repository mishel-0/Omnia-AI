import React, {
  useState,
  useMemo,
} from 'react';
import {
  GitMerge,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  Release,
} from '../types';
import {
  
  formatNumber,
  formatDate,
  formatRelativeTime,
  truncateHash,
  formatBytes,
  formatQwk,
} from '../utils/format';

interface ReleaseHistoryViewProps {
  releases: Release[];
  isLoading: boolean;
  onRefresh: () => void;
}

export const ReleaseHistoryView: React.FC<ReleaseHistoryViewProps> = ({
  releases,
  isLoading,
  onRefresh,
}) => {
  const [expandedVersions, setExpandedVersions] = useState<string[]>(
    releases[0] ? [releases[0].version] : []
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedSignature, setCopiedSignature] = useState<string | null>(null);

  const handleToggleExpand = (version: string) => {
    setExpandedVersions((prev) =>
      prev.includes(version) ? prev.filter((v) => v !== version) : [...prev, version]
    );
  };

  const handleCopySignature = (sig: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sig);
    setCopiedSignature(sig);
    setTimeout(() => setCopiedSignature(null), 2000);
  };

  const filteredReleases = useMemo(() => {
    return releases.filter((r) => {
      const matchVersion = r.version.toLowerCase().includes(searchQuery.toLowerCase());
      const matchSig = r.signature.toLowerCase().includes(searchQuery.toLowerCase());
      const matchSites = Array.isArray(r.contributions)
        ? r.contributions.some((c) =>
            typeof c === 'string'
              ? c.toLowerCase().includes(searchQuery.toLowerCase())
              : c.site_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.contribution_id.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : false;

      return matchVersion || matchSig || matchSites;
    });
  }, [releases, searchQuery]);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Top Search & Stats Bar */}
      <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
          <input
            id="releases-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by version (v2.4.1), site name, or signature..."
            className="w-full bg-[#090b10] border border-zinc-800 rounded-md pl-9 pr-3.5 py-1.5 text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
          <span>
            Total Releases: <strong className="text-white">{releases.length}</strong>
          </span>
          <span>•</span>
          <span>
            Active Live:{' '}
            <strong className="text-cyan-400 font-bold">
              {releases[0]?.version || 'None'}
            </strong>
          </span>
        </div>
      </div>

      {/* Releases Table */}
      <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg shadow-sm overflow-hidden">
        {filteredReleases.length === 0 ? (
          <div id="releases-empty-state" className="py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500 mb-3">
              <GitMerge className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-300 font-mono">
              {searchQuery ? 'No releases match your query' : 'No Releases Found'}
            </h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1 font-mono leading-relaxed">
              {searchQuery
                ? 'Try searching by a different version string or site identifier.'
                : 'Merge pending clinical site contributions to generate the initial global release artifact.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 bg-[#0a0d13] text-zinc-400 uppercase tracking-wider text-[11px] select-none">
                  <th className="py-3 px-3 w-10 text-center"></th>
                  <th className="py-3 px-3">Version</th>
                  <th className="py-3 px-3">Contributing Sites</th>
                  <th className="py-3 px-3">Total Samples Merged</th>
                  <th className="py-3 px-3">Published Date</th>
                  <th className="py-3 px-3">Ed25519 Signature</th>
                  <th className="py-3 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredReleases.map((release, index) => {
                  const isLatest = index === 0 && !searchQuery;
                  const isExpanded = expandedVersions.includes(release.version);

                  // Extract sites list
                  const rawContribs = release.contributions || [];
                  const siteIds: string[] = [];
                  rawContribs.forEach((c) => {
                    if (typeof c === 'string') {
                      siteIds.push(c);
                    } else if (c && c.site_id) {
                      if (!siteIds.includes(c.site_id)) siteIds.push(c.site_id);
                    }
                  });

                  return (
                    <React.Fragment key={release.version}>
                      <tr
                        id={`release-row-${release.version}`}
                        onClick={() => handleToggleExpand(release.version)}
                        className={`transition-colors cursor-pointer group ${
                          isExpanded
                            ? 'bg-zinc-900/70'
                            : isLatest
                            ? 'bg-cyan-950/10 hover:bg-cyan-950/20'
                            : 'hover:bg-zinc-900/50'
                        }`}
                      >
                        {/* Expand toggle chevron */}
                        <td className="py-3 px-3 text-center text-zinc-500 group-hover:text-zinc-300">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-cyan-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>

                        {/* Version string + Live Release accent badge */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">
                              {release.version}
                            </span>
                            {isLatest && (
                              <span
                                id="current-live-release-badge"
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                              >
                                CURRENT LIVE
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Contributing Sites count + preview names */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap max-w-md">
                            <span className="font-bold text-zinc-200 tabular-nums">
                              {siteIds.length} {siteIds.length === 1 ? 'site' : 'sites'}
                            </span>
                            <span className="text-zinc-600">|</span>
                            <span className="text-zinc-400 truncate max-w-[280px]">
                              {siteIds.join(', ')}
                            </span>
                          </div>
                        </td>

                        {/* Total Samples Merged (tabular) */}
                        <td className="py-3 px-3 tabular-nums">
                          <span className="font-bold text-zinc-200">
                            {formatNumber(release.total_samples)}
                          </span>
                        </td>

                        {/* Published Date (tabular/mono) */}
                        <td className="py-3 px-3 text-zinc-400">
                          <div title={formatDate(release.published_at)}>
                            <span className="text-zinc-300">
                              {formatRelativeTime(release.published_at)}
                            </span>
                            <span className="block text-[10px] text-zinc-500">
                              {formatDate(release.published_at)}
                            </span>
                          </div>
                        </td>

                        {/* Signature hash with copy button */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5 text-zinc-400">
                            <span
                              className="font-mono text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-[11px]"
                              title={release.signature}
                            >
                              {truncateHash(release.signature, 10, 8)}
                            </span>
                            <button
                              id={`copy-sig-${release.version}`}
                              onClick={(e) => handleCopySignature(release.signature, e)}
                              className="p-1 hover:text-white rounded hover:bg-zinc-800 transition-colors"
                              title="Copy full cryptographic signature"
                              aria-label="Copy signature"
                            >
                              {copiedSignature === release.signature ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Details Toggle text */}
                        <td className="py-3 px-3 text-right">
                          <span className="text-[11px] text-cyan-400 hover:underline">
                            {isExpanded ? 'Hide Items' : 'Inspect Merge'}
                          </span>
                        </td>
                      </tr>

                      {/* Expandable row: Listing exactly which contributions went into that release */}
                      {isExpanded && (
                        <tr
                          id={`release-detail-${release.version}`}
                          className="bg-[#090b10] border-b border-zinc-800/80"
                        >
                          <td colSpan={7} className="p-4 pl-12 space-y-3">
                            <div className="bg-[#0f131a] border border-zinc-800 rounded-lg p-4 space-y-3">
                              <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800/60">
                                <div className="flex items-center gap-2">
                                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                                  <h4 className="font-bold text-xs uppercase tracking-wider text-zinc-200">
                                    Merged Head Weights in {release.version} ({rawContribs.length})
                                  </h4>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                                  <span>Aggregated via Weighted FedAvg</span>
                                </div>
                              </div>

                              {/* Contributions breakdown list */}
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs font-mono">
                                  <thead>
                                    <tr className="text-zinc-500 border-b border-zinc-800/60 text-[10px] uppercase">
                                      <th className="py-1.5 px-2">Contribution ID</th>
                                      <th className="py-1.5 px-2">Contributing Clinical Site</th>
                                      <th className="py-1.5 px-2 text-right">Local Samples</th>
                                      <th className="py-1.5 px-2 text-right">Local Val QWK</th>
                                      <th className="py-1.5 px-2 text-right">Upload Size</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-850">
                                    {rawContribs.map((contrib, cIdx) => {
                                      const isObj = typeof contrib === 'object' && contrib !== null;
                                      const cId = isObj ? contrib.contribution_id : `contrib-${cIdx + 1}`;
                                      const siteId: string = isObj ? contrib.site_id : (contrib as string);
                                      const samples = isObj ? contrib.sample_count : undefined;
                                      const qwk = isObj ? contrib.local_val_qwk : undefined;
                                      const size = isObj ? contrib.size_bytes : undefined;

                                      return (
                                        <tr key={cId || cIdx} className="hover:bg-zinc-900/40">
                                          <td className="py-2 px-2 text-zinc-400 font-semibold">
                                            {cId}
                                          </td>
                                          <td className="py-2 px-2 text-zinc-200">
                                            {siteId}
                                          </td>
                                          <td className="py-2 px-2 text-right tabular-nums text-zinc-300">
                                            {samples ? formatNumber(samples) : '—'}
                                          </td>
                                          <td className="py-2 px-2 text-right tabular-nums">
                                            {qwk ? (
                                              <span
                                                className={
                                                  qwk < 0.65 ? 'text-amber-400' : 'text-emerald-400'
                                                }
                                              >
                                                {formatQwk(qwk)}
                                              </span>
                                            ) : (
                                              '—'
                                            )}
                                          </td>
                                          <td className="py-2 px-2 text-right tabular-nums text-zinc-400">
                                            {size ? formatBytes(size) : '—'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              {/* Full Cryptographic Hash */}
                              <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500">
                                <div className="flex items-center gap-2 truncate pr-4">
                                  <span className="text-zinc-400 font-semibold">Full Signature:</span>
                                  <code className="text-zinc-300 font-mono text-[11px] truncate bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                                    {release.signature}
                                  </code>
                                </div>
                                <button
                                  onClick={(e) => handleCopySignature(release.signature, e)}
                                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 shrink-0"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Copy Hash</span>
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
