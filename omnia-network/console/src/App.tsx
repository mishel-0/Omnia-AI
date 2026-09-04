import React, { useState, useEffect, useCallback } from 'react';
import {
  PendingContribution,
  Release,
  Site,
  ServerHealth,
  NavRoute,
  IssueKeyResponse,
} from './types';
import {
  getActiveBaseUrl,
  setActiveBaseUrl,
  clearAdminToken,
  fetchPendingContributions,
  fetchReleases,
  fetchSites,
  fetchHealth,
  mergeContributions,
  issueSiteKey,
} from './services/api';
import { AuthGate } from './components/AuthGate';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { OverviewView } from './components/OverviewView';
import { PendingContributionsView } from './components/PendingContributionsView';
import { ReleaseHistoryView } from './components/ReleaseHistoryView';
import { SitesView } from './components/SitesView';
import { ServerHealthView } from './components/ServerHealthView';
import { SettingsModal } from './components/SettingsModal';
import { ToastContainer, ToastMessage } from './components/Toast';
import { AlertCircle, RotateCw } from 'lucide-react';

export default function App() {
  // Auth state (session-stored single-admin password gate)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('omnia_admin_auth') === 'true';
    }
    return false;
  });

  // Active route
  const [currentRoute, setCurrentRoute] = useState<NavRoute>('overview');

  // Server URL
  const [serverUrl, setServerUrl] = useState<string>(() => getActiveBaseUrl());

  // Data states
  const [pending, setPending] = useState<PendingContribution[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [health, setHealth] = useState<ServerHealth | null>(null);

  // Loading and error states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isHealthLoading, setIsHealthLoading] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Settings modal
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Toast system
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    const duration = toast.durationMs || 5000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleAuthenticated = () => {
    setIsAuthenticated(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('omnia_admin_auth', 'true');
    }
    addToast({
      type: 'success',
      title: 'Console Session Unlocked',
      message: 'Authenticated as central federated learning coordinator admin.',
    });
  };

  const handleLockSession = () => {
    setIsAuthenticated(false);
    clearAdminToken();
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('omnia_admin_auth');
    }
    addToast({
      type: 'info',
      title: 'Session Locked',
      message: 'Ops console locked. Re-enter credentials to continue.',
    });
  };

  // Fetch all coordinator telemetry
  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    setIsHealthLoading(true);

    try {
      // Parallel requests against REST API contract
      const [pendingRes, releasesRes, sitesRes, healthRes] = await Promise.allSettled([
        fetchPendingContributions(),
        fetchReleases(),
        fetchSites(),
        fetchHealth(),
      ]);

      let hasAnySuccess = false;
      let errorMsgs: string[] = [];

      if (pendingRes.status === 'fulfilled') {
        setPending(pendingRes.value);
        hasAnySuccess = true;
      } else {
        errorMsgs.push(`GET /admin/pending: ${pendingRes.reason?.message || 'Failed'}`);
      }

      if (releasesRes.status === 'fulfilled') {
        setReleases(releasesRes.value);
        hasAnySuccess = true;
      } else {
        errorMsgs.push(`GET /admin/releases: ${releasesRes.reason?.message || 'Failed'}`);
      }

      if (sitesRes.status === 'fulfilled') {
        setSites(sitesRes.value);
        hasAnySuccess = true;
      } else {
        errorMsgs.push(`GET /admin/sites: ${sitesRes.reason?.message || 'Failed'}`);
      }

      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value);
        hasAnySuccess = true;
      } else {
        setHealth({ status: 'unreachable', insecure_signing: false });
        errorMsgs.push(`GET /health: ${healthRes.reason?.message || 'Failed'}`);
      }

      if (!hasAnySuccess && errorMsgs.length > 0) {
        setFetchError(
          `Unable to reach coordinator REST API at ${serverUrl}. Ensure the server is active or click the settings icon to adjust configuration.`
        );
      }
    } catch (err: any) {
      setFetchError(err.message || 'Failed to communicate with coordinator API');
    } finally {
      setIsLoading(false);
      setIsHealthLoading(false);
    }
  }, [serverUrl]);

  // Initial load
  useEffect(() => {
    if (isAuthenticated) {
      loadAllData();
    }
  }, [isAuthenticated, loadAllData]);

  // Merge Handler (POST /admin/merge)
  const handleMerge = async (contributionIds: string[]): Promise<Release | void> => {
    try {
      const newRelease = await mergeContributions(contributionIds);
      addToast({
        type: 'success',
        title: `Release ${newRelease.version} Published Live`,
        message: `Successfully aggregated ${contributionIds.length} clinical head weights into immutable release ${newRelease.version}.`,
        durationMs: 7000,
      });

      // Refresh data
      await loadAllData();
      return newRelease;
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Merge Failed',
        message: err.message || 'Encountered error during global model aggregation.',
      });
      throw err;
    }
  };

  // Issue Site Key Handler (POST /admin/sites)
  const handleIssueKey = async (siteName: string): Promise<IssueKeyResponse> => {
    try {
      const res = await issueSiteKey(siteName);
      addToast({
        type: 'success',
        title: `Site Key Generated: ${res.site_id}`,
        message: `Key issued for "${siteName}". Ensure you copy and distribute the key now.`,
      });

      // Refresh sites list in background
      const updatedSites = await fetchSites();
      setSites(updatedSites);

      return res;
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Key Generation Error',
        message: err.message || 'Failed to issue site key.',
      });
      throw err;
    }
  };

  // Handle URL change
  const handleUpdateBaseUrl = (newUrl: string) => {
    setActiveBaseUrl(newUrl);
    setServerUrl(newUrl);
    addToast({
      type: 'info',
      title: 'Target Endpoint Updated',
      message: `Coordinator base URL changed to ${newUrl}`,
    });
  };

  if (!isAuthenticated) {
    return <AuthGate onAuthenticated={handleAuthenticated} />;
  }

  const flaggedPendingCount = pending.filter(
    (p) => p.local_val_qwk < 0.65 || p.sample_count < 500
  ).length;

  return (
    <div id="omnia-app-root" className="min-h-screen bg-[#090b10] text-[#e2e8f0] flex">
      {/* Left Sidebar Nav */}
      <Sidebar
        currentRoute={currentRoute}
        onRouteChange={setCurrentRoute}
        pendingCount={pending.length}
        flaggedPendingCount={flaggedPendingCount}
        serverHealth={health}
        serverUrl={serverUrl}
        isHealthLoading={isHealthLoading}
        onLockSession={handleLockSession}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto">
        <Header
          currentRoute={currentRoute}
          serverHealth={health}
          serverUrl={serverUrl}
          isRefreshing={isLoading}
          onRefresh={loadAllData}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onNavigateToHealth={() => setCurrentRoute('health')}
        />

        {/* Global Network Fetch Error Alert */}
        {fetchError && (
          <div className="mx-6 mt-6 p-4 bg-rose-950/40 border border-rose-600/50 rounded-lg flex items-start justify-between gap-3 text-xs font-mono text-rose-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block">Connection Alert</strong>
                <p className="mt-0.5 text-rose-300/90">{fetchError}</p>
                <p className="mt-2 text-[11px] text-zinc-400">
                  Tip: Confirm the Omnia Network server is running, then check the base URL in the settings gear in the top right.
                </p>
              </div>
            </div>
            <button
              onClick={loadAllData}
              className="px-3 py-1.5 bg-rose-900/60 hover:bg-rose-800 text-white rounded transition-colors flex items-center gap-1 shrink-0"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Route Views */}
        <main className="flex-1 pb-16">
          {currentRoute === 'overview' && (
            <OverviewView
              pending={pending}
              releases={releases}
              sites={sites}
              isLoading={isLoading}
              onNavigate={(route) => setCurrentRoute(route)}
              onRefresh={loadAllData}
            />
          )}

          {currentRoute === 'pending' && (
            <PendingContributionsView
              pending={pending}
              isLoading={isLoading}
              onMerge={handleMerge}
              onRefresh={loadAllData}
            />
          )}

          {currentRoute === 'releases' && (
            <ReleaseHistoryView
              releases={releases}
              isLoading={isLoading}
              onRefresh={loadAllData}
            />
          )}

          {currentRoute === 'sites' && (
            <SitesView
              sites={sites}
              isLoading={isLoading}
              onIssueKey={handleIssueKey}
              onRefresh={loadAllData}
            />
          )}

          {currentRoute === 'health' && (
            <ServerHealthView
              health={health}
              serverUrl={serverUrl}
              isLoading={isLoading}
              onRefresh={loadAllData}
              onUpdateBaseUrl={handleUpdateBaseUrl}
            />
          )}
        </main>
      </div>

      {/* Global Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        serverUrl={serverUrl}
        onUpdateBaseUrl={handleUpdateBaseUrl}
        onRefresh={loadAllData}
      />

      {/* Toast Notification Container */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
