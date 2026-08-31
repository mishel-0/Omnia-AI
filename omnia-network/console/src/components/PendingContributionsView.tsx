import React, { useState, useMemo } from 'react';
import {
  Layers,
  GitMerge,
  AlertTriangle,
  CheckSquare,
  Square,
  Search,
  Filter,
  ArrowUpDown,
  Copy,
  Check,
  Info,
  Clock,
  ShieldAlert,
  AlertCircle,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { PendingContribution, Release } from '../types';
import {
  formatNumber,
  formatBytes,
  formatQwk,
  formatDate,
  formatRelativeTime,
  getQwkQualityBadge,
} from '../utils/format';

interface PendingContributionsViewProps {
  pending: PendingContribution[];
  isLoading: boolean;
  onMerge: (contributionIds: string[]) => Promise<Release | void>;
  onRefresh: () => void;
}

export const PendingContributionsView: React.FC<PendingContributionsViewProps> = ({
  pending,
  isLoading,
  onMerge,
  onRefresh,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'flagged' | 'optimal'>('all');
  const [sortBy, setSortBy] = useState<'received_at' | 'sample_count' | 'local_val_qwk' | 'size_bytes'>('received_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Merge Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Quality thresholds
  const LOW_SAMPLE_THRESHOLD = 500;
  const LOW_QWK_THRESHOLD = 0.65;

  const isRowFlagged = (item: PendingContribution) => {
    return item.local_val_qwk < LOW_QWK_THRESHOLD || item.sample_count < LOW_SAMPLE_THRESHOLD;
  };

  // Filter & Sort
  const filteredItems = useMemo(() => {
    return pending.filter((item) => {
      const matchesSearch =
        item.site_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.contribution_id.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      const flagged = isRowFlagged(item);
      if (filterMode === 'flagged') return flagged;
      if (filterMode === 'optimal') return !flagged;
      return true;
    });
  }, [pending, searchQuery, filterMode]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'received_at') {
        comparison = new Date(a.received_at).getTime() - new Date(b.received_at).getTime();
      } else if (sortBy === 'sample_count') {
        comparison = a.sample_count - b.sample_count;
      } else if (sortBy === 'local_val_qwk') {
        comparison = a.local_val_qwk - b.local_val_qwk;
      } else if (sortBy === 'size_bytes') {
        comparison = a.size_bytes - b.size_bytes;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }, [filteredItems, sortBy, sortOrder]);

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    if (selectedIds.length === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map((item) => item.contribution_id));
    }
  };

  const handleSelectSafeOnly = () => {
    const safeIds = pending
      .filter((item) => !isRowFlagged(item))
      .map((item) => item.contribution_id);
    setSelectedIds(safeIds);
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Selected items summary for merge modal
  const selectedContributions = useMemo(() => {
    return pending.filter((item) => selectedIds.includes(item.contribution_id));
  }, [pending, selectedIds]);

  const totalSelectedSamples = useMemo(() => {
    return selectedContributions.reduce((sum, item) => sum + item.sample_count, 0);
  }, [selectedContributions]);

  const avgSelectedQwk = useMemo(() => {
    if (selectedContributions.length === 0) return 0;
    const sum = selectedContributions.reduce((s, item) => s + item.local_val_qwk, 0);
    return sum / selectedContributions.length;
  }, [selectedContributions]);

  const selectedFlaggedCount = useMemo(() => {
    return selectedContributions.filter(isRowFlagged).length;
  }, [selectedContributions]);

  const handleExecuteMerge = async () => {
    if (selectedIds.length === 0) return;
    setIsMerging(true);
    setMergeError(null);
    try {
      await onMerge(selectedIds);
      setShowConfirmModal(false);
      setSelectedIds([]);
    } catch (err: any) {
      setMergeError(err.message || 'Failed to execute global merge');
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Top Controls: Search, Filters, Selection summary, Merge Action */}
      <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
            <input
              id="pending-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by Site ID or Contribution ID..."
              className="w-full bg-[#090b10] border border-zinc-800 rounded-md pl-9 pr-3.5 py-1.5 text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-zinc-500 flex items-center gap-1">
              <Filter className="w-3 h-3" /> View:
            </span>
            <div className="bg-zinc-900 border border-zinc-800 p-0.5 rounded-md flex">
              <button
                id="filter-all"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  filterMode === 'all'
                    ? 'bg-zinc-800 text-white font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All ({pending.length})
              </button>
              <button
                id="filter-flagged"
                onClick={() => setFilterMode('flagged')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  filterMode === 'flagged'
                    ? 'bg-amber-500/20 text-amber-300 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Flagged ({pending.filter(isRowFlagged).length})
              </button>
              <button
                id="filter-optimal"
                onClick={() => setFilterMode('optimal')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  filterMode === 'optimal'
                    ? 'bg-emerald-500/20 text-emerald-300 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Optimal ({pending.filter((p) => !isRowFlagged(p)).length})
              </button>
            </div>
          </div>
        </div>

        {/* Action Bar: Selection stats + Merge Selected button */}
        <div className="pt-3 border-t border-zinc-800/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs font-mono">
            <button
              id="select-all-filtered-btn"
              onClick={handleSelectAllFiltered}
              className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
            >
              {selectedIds.length === filteredItems.length && filteredItems.length > 0 ? (
                <CheckSquare className="w-4 h-4 text-cyan-400" />
              ) : (
                <Square className="w-4 h-4 text-zinc-500" />
              )}
              <span>
                {selectedIds.length === filteredItems.length && filteredItems.length > 0
                  ? 'Deselect All'
                  : 'Select All Visible'}
              </span>
            </button>

            <button
              id="select-safe-only-btn"
              onClick={handleSelectSafeOnly}
              className="text-emerald-400/90 hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Select High-Quality Only</span>
            </button>

            {selectedIds.length > 0 && (
              <span className="text-zinc-400 border-l border-zinc-800 pl-3">
                <strong className="text-cyan-400">{selectedIds.length}</strong> selected (
                {formatNumber(totalSelectedSamples)} samples)
              </span>
            )}
          </div>

          <button
            id="merge-selected-btn"
            disabled={selectedIds.length === 0}
            onClick={() => setShowConfirmModal(true)}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono text-xs font-semibold px-4 py-2 rounded-md transition-colors flex items-center gap-2 shadow-lg shadow-cyan-950/40"
          >
            <GitMerge className="w-4 h-4" />
            <span>Merge Selected Contributions ({selectedIds.length})</span>
          </button>
        </div>
      </div>

      {/* Pending Table */}
      <div className="bg-[#0f131a] border border-zinc-800/80 rounded-lg shadow-sm overflow-hidden">
        {sortedItems.length === 0 ? (
          /* Empty state */
          <div id="pending-empty-state" className="py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500 mb-3">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-300 font-mono">
              {searchQuery || filterMode !== 'all'
                ? 'No contributions match the current filter'
                : 'Pending Contribution Queue is Empty'}
            </h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1 font-mono leading-relaxed">
              {searchQuery || filterMode !== 'all'
                ? 'Try resetting the search query or quality filter mode.'
                : 'Central coordinator is waiting for clinical sites to complete local epochs and push trained head weight gradients.'}
            </p>
            {(searchQuery || filterMode !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterMode('all');
                }}
                className="mt-4 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono rounded"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 bg-[#0a0d13] text-zinc-400 uppercase tracking-wider text-[11px] select-none">
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.length === filteredItems.length &&
                        filteredItems.length > 0
                      }
                      onChange={handleSelectAllFiltered}
                      className="rounded bg-zinc-900 border-zinc-700 text-cyan-500 focus:ring-0 cursor-pointer"
                      aria-label="Select all rows"
                    />
                  </th>
                  <th className="py-3 px-3">Site ID / Name</th>
                  <th className="py-3 px-3">Contribution ID</th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('sample_count')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Sample Count</span>
                      <ArrowUpDown className="w-3 h-3 text-zinc-500" />
                    </div>
                  </th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('local_val_qwk')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Local Val QWK</span>
                      <ArrowUpDown className="w-3 h-3 text-zinc-500" />
                    </div>
                  </th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('size_bytes')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Upload Size</span>
                      <ArrowUpDown className="w-3 h-3 text-zinc-500" />
                    </div>
                  </th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-white transition-colors"
                    onClick={() => handleSort('received_at')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Received</span>
                      <ArrowUpDown className="w-3 h-3 text-zinc-500" />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right">Quality Assessment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {sortedItems.map((item) => {
                  const isSelected = selectedIds.includes(item.contribution_id);
                  const isFlagged = isRowFlagged(item);
                  const isLowQwk = item.local_val_qwk < LOW_QWK_THRESHOLD;
                  const isLowSample = item.sample_count < LOW_SAMPLE_THRESHOLD;
                  const qwkBadge = getQwkQualityBadge(item.local_val_qwk);

                  return (
                    <tr
                      key={item.contribution_id}
                      id={`pending-row-${item.contribution_id}`}
                      className={`transition-colors relative group ${
                        isSelected
                          ? 'bg-cyan-950/20'
                          : isFlagged
                          ? 'bg-amber-950/10 hover:bg-amber-950/20'
                          : 'hover:bg-zinc-900/50'
                      }`}
                    >
                      {/* Flagged Amber Left Border */}
                      {isFlagged && (
                        <td className="p-0 absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                      )}

                      {/* Checkbox */}
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.contribution_id)}
                          className="rounded bg-zinc-900 border-zinc-700 text-cyan-500 focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Site ID */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-zinc-200">
                          {item.site_id}
                        </div>
                      </td>

                      {/* Contribution ID + copy */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 text-zinc-400">
                          <span>{item.contribution_id}</span>
                          <button
                            onClick={() => handleCopyId(item.contribution_id)}
                            className="p-1 hover:text-zinc-200 rounded transition-colors"
                            title="Copy Contribution ID"
                          >
                            {copiedId === item.contribution_id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3 text-zinc-600 hover:text-zinc-400" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Sample count (tabular) */}
                      <td className="py-3 px-3 tabular-nums">
                        <span
                          className={`font-semibold ${
                            isLowSample ? 'text-amber-400' : 'text-zinc-200'
                          }`}
                        >
                          {formatNumber(item.sample_count)}
                        </span>
                        {isLowSample && (
                          <span className="text-[10px] text-amber-500 ml-1.5">
                            (&lt; {LOW_SAMPLE_THRESHOLD})
                          </span>
                        )}
                      </td>

                      {/* Local Val QWK (tabular) */}
                      <td className="py-3 px-3 tabular-nums">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold ${
                              isLowQwk
                                ? 'text-amber-400'
                                : item.local_val_qwk >= 0.8
                                ? 'text-emerald-400'
                                : 'text-zinc-200'
                            }`}
                          >
                            {formatQwk(item.local_val_qwk)}
                          </span>
                        </div>
                      </td>

                      {/* Size (tabular) */}
                      <td className="py-3 px-3 tabular-nums text-zinc-400">
                        {formatBytes(item.size_bytes)}
                      </td>

                      {/* Received timestamp */}
                      <td className="py-3 px-3 text-zinc-400">
                        <div title={formatDate(item.received_at)}>
                          {formatRelativeTime(item.received_at)}
                        </div>
                      </td>

                      {/* Quality Flag Badges */}
                      <td className="py-3 px-3 text-right">
                        {isFlagged ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            {isLowQwk && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>Low QWK ({formatQwk(item.local_val_qwk)})</span>
                              </span>
                            )}
                            {isLowSample && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>Low Sample Size</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className={`px-2 py-0.5 rounded text-[10px] ${qwkBadge.badgeClass}`}>
                            {qwkBadge.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MERGE CONFIRMATION MODAL - Mandatory per requirements */}
      {showConfirmModal && (
        <div
          id="merge-confirm-modal-overlay"
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div
            id="merge-confirm-modal"
            className="bg-[#0f131a] border border-zinc-700/80 rounded-xl shadow-2xl max-w-xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-start gap-3 pb-4 border-b border-zinc-800">
              <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-mono uppercase tracking-wide">
                  Confirm Global Model Merge
                </h3>
                <p className="text-xs text-rose-300 font-semibold mt-1">
                  CRITICAL: This action cannot be undone once the release is live and clinical sites pull weights.
                </p>
              </div>
            </div>

            {/* Merge Stats Breakdown */}
            <div className="grid grid-cols-3 gap-3 bg-zinc-900/80 border border-zinc-800 p-3 rounded-lg font-mono text-xs">
              <div>
                <span className="text-zinc-500 block">Contributions:</span>
                <span className="text-lg font-bold text-white tabular-nums">
                  {selectedContributions.length}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Total Samples:</span>
                <span className="text-lg font-bold text-cyan-400 tabular-nums">
                  {formatNumber(totalSelectedSamples)}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Mean QWK:</span>
                <span
                  className={`text-lg font-bold tabular-nums ${
                    avgSelectedQwk < 0.65 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {formatQwk(avgSelectedQwk)}
                </span>
              </div>
            </div>

            {/* Flagged warnings if any selected */}
            {selectedFlaggedCount > 0 && (
              <div className="p-3 bg-amber-950/30 border border-amber-500/40 rounded-lg text-xs font-mono text-amber-300 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span>Warning: {selectedFlaggedCount} low-quality contribution(s) selected!</span>
                </div>
                <p className="text-[11px] text-amber-400/80 leading-relaxed">
                  Merging contributions with low QWK or small sample sizes may degrade the global model release performance across all enrolled clinical nodes.
                </p>
              </div>
            )}

            {/* List of included sites */}
            <div className="space-y-1.5">
              <span className="text-xs font-mono text-zinc-400 block">
                Targeted Contributions ({selectedContributions.length}):
              </span>
              <div className="max-h-36 overflow-y-auto bg-zinc-950 border border-zinc-800/80 rounded p-2 divide-y divide-zinc-900 font-mono text-[11px]">
                {selectedContributions.map((c) => (
                  <div key={c.contribution_id} className="py-1 flex items-center justify-between text-zinc-300">
                    <span className="text-zinc-400">{c.site_id}</span>
                    <span className="text-zinc-500">{c.contribution_id}</span>
                    <span className="tabular-nums text-zinc-300">{formatNumber(c.sample_count)} smp</span>
                  </div>
                ))}
              </div>
            </div>

            {mergeError && (
              <p className="text-xs text-rose-400 font-mono bg-rose-950/50 p-2.5 rounded border border-rose-800">
                {mergeError}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                id="cancel-merge-modal-btn"
                type="button"
                disabled={isMerging}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                id="confirm-execute-merge-btn"
                type="button"
                disabled={isMerging}
                onClick={handleExecuteMerge}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-mono text-xs font-bold rounded-md transition-colors flex items-center gap-2 shadow-lg shadow-cyan-950/50"
              >
                {isMerging ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Aggregating Weights & Signing...</span>
                  </>
                ) : (
                  <>
                    <GitMerge className="w-4 h-4" />
                    <span>Confirm & Publish Release</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
