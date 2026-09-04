import React, {
  useState,
  useMemo,
} from 'react';
import {
  Hospital,
  Key,
  KeyRound,
  Plus,
  Search,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
   Site, IssueKeyResponse ,
} from '../types';
import {
  
  formatNumber,
  formatDate,
  formatRelativeTime,
} from '../utils/format';

interface SitesViewProps {
  sites: Site[];
  isLoading: boolean;
  onIssueKey: (siteName: string) => Promise<IssueKeyResponse>;
  onRefresh: () => void;
}

export const SitesView: React.FC<SitesViewProps> = ({
  sites,
  isLoading,
  onIssueKey,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'key_unused' | 'no_key'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [siteNameInput, setSiteNameInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  
  // Generated key shown ONCE
  const [generatedResult, setGeneratedResult] = useState<IssueKeyResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Status classifier
  const getSiteStatus = (site: Site): 'active' | 'key_unused' | 'no_key' => {
    if (!site.issued_at) return 'no_key';
    if (site.contribution_count > 0 || site.last_contribution_at) return 'active';
    return 'key_unused';
  };

  const getStatusBadge = (status: 'active' | 'key_unused' | 'no_key') => {
    switch (status) {
      case 'active':
        return {
          label: 'ACTIVE',
          className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
        };
      case 'key_unused':
        return {
          label: 'KEY UNUSED',
          className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
        };
      case 'no_key':
        return {
          label: 'NO KEY',
          className: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
        };
    }
  };

  const filteredSites = useMemo(() => {
    return sites.filter((s) => {
      const name = (s.site_name || s.site_id).toLowerCase();
      const id = s.site_id.toLowerCase();
      const query = searchQuery.toLowerCase();
      const matchesSearch = name.includes(query) || id.includes(query);

      if (!matchesSearch) return false;

      const status = getSiteStatus(s);
      if (statusFilter !== 'all' && status !== statusFilter) return false;

      return true;
    });
  }, [sites, searchQuery, statusFilter]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleOpenModal = () => {
    setSiteNameInput('');
    setIssueError(null);
    setGeneratedResult(null);
    setCopiedKey(false);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setGeneratedResult(null);
    setSiteNameInput('');
    setIssueError(null);
  };

  const handleSubmitIssueKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteNameInput.trim()) return;

    setIsSubmitting(true);
    setIssueError(null);
    try {
      const res = await onIssueKey(siteNameInput.trim());
      setGeneratedResult(res);
    } catch (err: any) {
      setIssueError(err.message || 'Failed to issue new site key');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Top Search, Status Filter & Issue Key CTA */}
      <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
            <input
              id="sites-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search site name or site ID..."
              className="w-full bg-[#090b10] border border-zinc-800 rounded-md pl-9 pr-3.5 py-1.5 text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Status filters */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-md text-xs font-mono">
            <button
              id="sites-filter-all"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded transition-colors ${
                statusFilter === 'all'
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({sites.length})
            </button>
            <button
              id="sites-filter-active"
              onClick={() => setStatusFilter('active')}
              className={`px-2.5 py-1 rounded transition-colors ${
                statusFilter === 'active'
                  ? 'bg-emerald-500/20 text-emerald-300 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Active
            </button>
            <button
              id="sites-filter-unused"
              onClick={() => setStatusFilter('key_unused')}
              className={`px-2.5 py-1 rounded transition-colors ${
                statusFilter === 'key_unused'
                  ? 'bg-amber-500/20 text-amber-300 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Key Unused
            </button>
          </div>
        </div>

        {/* Issue Key CTA */}
        <button
          id="issue-new-site-key-btn"
          onClick={handleOpenModal}
          className="bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold px-4 py-2 rounded-md transition-colors flex items-center gap-2 shadow-lg shadow-cyan-950/40 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Issue New Site Key</span>
        </button>
      </div>

      {/* Sites Table */}
      <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg shadow-sm overflow-hidden">
        {filteredSites.length === 0 ? (
          <div id="sites-empty-state" className="py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500 mb-3">
              <Hospital className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-300 font-mono">
              {searchQuery ? 'No sites match your query' : 'No Enrolled Clinical Sites'}
            </h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1 font-mono leading-relaxed">
              {searchQuery
                ? 'Try resetting the search query or status filter.'
                : 'Click "Issue New Site Key" to authorize a new hospital or radiology department.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 bg-[#0a0d13] text-zinc-400 uppercase tracking-wider text-[11px] select-none">
                  <th className="py-3 px-3">Site ID / Identifier</th>
                  <th className="py-3 px-3">Clinical Organization</th>
                  <th className="py-3 px-3">Key Issued Date</th>
                  <th className="py-3 px-3">Last Contribution</th>
                  <th className="py-3 px-3 text-right">Total Contributions</th>
                  <th className="py-3 px-3 text-right">Node Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredSites.map((site) => {
                  const status = getSiteStatus(site);
                  const badge = getStatusBadge(status);

                  return (
                    <tr
                      key={site.site_id}
                      id={`site-row-${site.site_id}`}
                      className="hover:bg-zinc-900/50 transition-colors group"
                    >
                      {/* Site ID + copy */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                          <span>{site.site_id}</span>
                          <button
                            onClick={() => handleCopy(site.site_id, site.site_id)}
                            className="p-1 text-zinc-600 hover:text-zinc-300 rounded transition-colors"
                            title="Copy Site ID"
                          >
                            {copiedId === site.site_id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Site Name / Organization */}
                      <td className="py-3 px-3">
                        <span className="text-zinc-300">
                          {site.site_name || site.site_id}
                        </span>
                      </td>

                      {/* Key Issued Date */}
                      <td className="py-3 px-3 text-zinc-400">
                        <div title={formatDate(site.issued_at)}>
                          <span>{formatRelativeTime(site.issued_at)}</span>
                          <span className="block text-[10px] text-zinc-500">
                            {formatDate(site.issued_at)}
                          </span>
                        </div>
                      </td>

                      {/* Last Contribution Date */}
                      <td className="py-3 px-3 text-zinc-400">
                        {site.last_contribution_at ? (
                          <div title={formatDate(site.last_contribution_at)}>
                            <span className="text-zinc-200">
                              {formatRelativeTime(site.last_contribution_at)}
                            </span>
                            <span className="block text-[10px] text-zinc-500">
                              {formatDate(site.last_contribution_at)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-500 italic">Never</span>
                        )}
                      </td>

                      {/* Total contributions all-time (tabular) */}
                      <td className="py-3 px-3 text-right tabular-nums">
                        <span
                          className={`font-bold ${
                            site.contribution_count > 0 ? 'text-zinc-200' : 'text-zinc-500'
                          }`}
                        >
                          {formatNumber(site.contribution_count)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ISSUE NEW SITE KEY MODAL */}
      {isModalOpen && (
        <div
          id="issue-key-modal-overlay"
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div
            id="issue-key-modal"
            className="bg-[#0f131a] border border-zinc-700 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150"
          >
            {!generatedResult ? (
              /* Step 1: Enter Site Name */
              <form onSubmit={handleSubmitIssueKey} className="space-y-4">
                <div className="flex items-start gap-3 pb-3 border-b border-zinc-800">
                  <div className="p-2.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 shrink-0">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                      Issue New Clinical Site Authorization Key
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 font-mono">
                      Authorize a hospital node to securely transmit trained local head weights to this coordinator.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="new-site-name-input"
                    className="block text-xs font-mono font-medium text-zinc-300"
                  >
                    Clinical Site / Department Name:
                  </label>
                  <input
                    id="new-site-name-input"
                    type="text"
                    required
                    value={siteNameInput}
                    onChange={(e) => setSiteNameInput(e.target.value)}
                    placeholder="e.g. Johns Hopkins - Radiology AI Lab"
                    className="w-full bg-[#090b10] border border-zinc-700 rounded-md px-3.5 py-2 text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                    autoFocus
                  />
                  <p className="text-[11px] text-zinc-500 font-mono">
                    A unique site identifier will be automatically derived from this name.
                  </p>
                </div>

                {issueError && (
                  <div className="p-2.5 bg-rose-950/40 border border-rose-800 rounded text-xs text-rose-300 font-mono">
                    {issueError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleCloseModal}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    id="submit-issue-key-btn"
                    type="submit"
                    disabled={isSubmitting || !siteNameInput.trim()}
                    className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-mono text-xs font-bold rounded-md transition-colors flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Generating Keypair...</span>
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4" />
                        <span>Generate & Issue Key</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* Step 2: Show Generated Key ONCE with loud warning */
              <div className="space-y-4">
                <div className="flex items-start gap-3 pb-3 border-b border-zinc-800">
                  <div className="p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                      Site Key Created Successfully
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 font-mono">
                      Site ID: <strong className="text-cyan-400">{generatedResult.site_id}</strong>
                    </p>
                  </div>
                </div>

                {/* CRITICAL WARNING: SHOW ONCE ONLY */}
                <div
                  id="key-shown-once-warning"
                  className="p-3 bg-amber-950/40 border border-amber-500/50 rounded-lg text-xs font-mono text-amber-200 space-y-1.5"
                >
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>SECURITY WARNING: Copy this key now!</span>
                  </div>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    This secret key will <strong>NEVER be shown again</strong> and cannot be retrieved from the central database. If lost, you must revoke the node and issue a new key.
                  </p>
                </div>

                {/* Secret Key Display Box with Copy Button */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono uppercase text-zinc-400 block font-semibold">
                    Client Node API Secret Key:
                  </label>
                  <div className="bg-[#090b10] border border-zinc-700 p-3 rounded-lg flex items-center justify-between gap-3">
                    <code
                      id="generated-secret-key-display"
                      className="font-mono text-xs text-emerald-400 select-all break-all leading-relaxed"
                    >
                      {generatedResult.key}
                    </code>
                    <button
                      id="copy-generated-key-btn"
                      type="button"
                      onClick={() => handleCopyKey(generatedResult.key)}
                      className={`px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
                        copiedKey
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-cyan-400'
                      }`}
                    >
                      {copiedKey ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Key</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono text-zinc-400 space-y-1">
                  <div className="text-zinc-300 font-medium">Installation in Clinical Node:</div>
                  <pre className="text-[11px] text-zinc-500 overflow-x-auto p-1.5 bg-black/40 rounded">
                    export OMNIA_SITE_KEY="{generatedResult.key}"{'\n'}
                    export OMNIA_SITE_ID="{generatedResult.site_id}"
                  </pre>
                </div>

                <div className="flex justify-end pt-3 border-t border-zinc-800">
                  <button
                    id="dismiss-key-modal-btn"
                    type="button"
                    onClick={handleCloseModal}
                    className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-mono text-xs font-semibold rounded-md transition-colors"
                  >
                    I Have Saved the Key / Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
