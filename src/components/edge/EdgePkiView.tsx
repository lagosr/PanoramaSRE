import React, { useState, useEffect } from 'react';
import { WshSnapshot, SslFleetSummary } from '../../lib/types';
import { SslDualProbeTable } from './SslDualProbeTable';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import { SslProgressInline } from './SslProgressInline';
import { TerminalTab } from '../layout/SreTerminalDrawer';
import {
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Zap,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface EdgePkiViewProps {
  snapshot: WshSnapshot | null;
  sslFleet: SslFleetSummary | null;
  terminalTabs?: TerminalTab[];
  isLoading?: boolean;
  isLoadingSsl?: boolean;
  onRefreshSsl?: () => void;
  onTriggerRenewal?: (options: {
    unattended?: boolean;
    forceRenewal?: boolean;
    skipDeploy?: boolean;
    skipRenew?: boolean;
    deployTargets?: string[];
    targetDevice?: string;
  }) => void;
}

export const EdgePkiView: React.FC<EdgePkiViewProps> = ({
  sslFleet,
  terminalTabs = [],
  isLoadingSsl = false,
  onRefreshSsl,
  onTriggerRenewal,
}) => {
  const [isForceModalOpen, setIsForceModalOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Detect active SSL renewal/deploy background job
  const activeSslJob = terminalTabs.find(
    (t) => t.id.startsWith('ssl-renew-') && t.isRunning
  );

  // If a job just completed, keep tracking the last job until dismissed
  const latestSslJob = activeSslJob || terminalTabs
    .filter((t) => t.id.startsWith('ssl-renew-'))
    .slice(-1)[0];

  // When a new job starts running, make sure it is not dismissed
  useEffect(() => {
    if (activeSslJob) {
      setIsDismissed(false);
    }
  }, [activeSslJob?.id]);

  const totalDomains = sslFleet?.total_domains ?? 7;
  const healthyCount = sslFleet?.healthy_count ?? 0;
  const expiringCount = sslFleet?.expiring_soon_count ?? 0;
  const criticalCount = sslFleet?.critical_count ?? 0;
  const driftCount = sslFleet?.drift_count ?? 0;
  const minDays = sslFleet?.min_days_remaining ?? 0;

  const handleRenewDue = () => {
    if (onTriggerRenewal) {
      onTriggerRenewal({ unattended: true });
    }
  };

  const handleForceRenewConfirm = () => {
    setIsForceModalOpen(false);
    if (onTriggerRenewal) {
      onTriggerRenewal({ unattended: true, forceRenewal: true });
    }
  };

  const handleDeploySingleTarget = (deviceKey: string) => {
    if (onTriggerRenewal) {
      onTriggerRenewal({
        unattended: true,
        skipRenew: true,
        targetDevice: deviceKey,
        deployTargets: [deviceKey],
      });
    }
  };

  const handleRenewSingleCert = (deviceKey: string, force: boolean = true) => {
    if (onTriggerRenewal) {
      onTriggerRenewal({
        unattended: true,
        forceRenewal: force,
        skipDeploy: true,
        targetDevice: deviceKey,
      });
    }
  };

  const handleRenewAndDeploySingle = (deviceKey: string, force: boolean = true) => {
    if (onTriggerRenewal) {
      onTriggerRenewal({
        unattended: true,
        forceRenewal: force,
        skipDeploy: false,
        skipRenew: false,
        targetDevice: deviceKey,
        deployTargets: [deviceKey],
      });
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header with Title & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            PKI & SSL/TLS Certificates
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Fleet X.509 dual-probe TLS validation, drift detection & automated Let's Encrypt lifecycle
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onRefreshSsl && (
            <button
              onClick={onRefreshSsl}
              disabled={isLoadingSsl}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
              title="Execute immediate live dual-probe check across all 5 lab domains"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSsl ? 'animate-spin text-emerald-500 dark:text-emerald-400' : ''}`} />
              Re-probe Fleet
            </button>
          )}

          {onTriggerRenewal && (
            <>
              <button
                onClick={handleRenewDue}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                title="Automate renewal of certificates with less than 30 days remaining"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                Renew Due Certs (&lt;30d)
              </button>

              <button
                onClick={() => setIsForceModalOpen(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                title="Force renew all certificates and re-deploy to devices regardless of expiration date"
              >
                <RotateCw className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                Force Renew All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Directory & Environment Banner (matches Database Backups standard) */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50 dark:bg-slate-950/60 p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 font-mono">
        <button
          onClick={async () => {
            const folderPath = sslFleet?.base_output_folder;
            if (folderPath) {
              try {
                await invoke('open_in_file_manager', { path: folderPath });
              } catch (invokeErr) {
                console.warn('Native open_in_file_manager failed:', invokeErr);
              }
            }
          }}
          disabled={!sslFleet?.base_output_folder}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors group cursor-pointer truncate max-w-2xl text-left disabled:cursor-default"
          title="Click to open certificate base directory in File Explorer"
        >
          <FolderOpen className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0 group-hover:scale-110 transition-transform" />
          <span className="text-slate-700 dark:text-slate-300 font-semibold shrink-0">Certificate Repository:</span>
          <span className="truncate underline decoration-dotted decoration-slate-400 dark:decoration-slate-600 underline-offset-4 group-hover:decoration-emerald-500 dark:group-hover:decoration-emerald-400">
            {sslFleet?.base_output_folder || 'Resolving base folder...'}
          </span>
          <ExternalLink className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0 group-hover:text-emerald-500 dark:group-hover:text-emerald-400" />
        </button>

        <div className="flex items-center gap-4 text-slate-500 dark:text-slate-400">
          <span>
            Provider: <span className="text-emerald-600 dark:text-emerald-400 font-bold">Cloudflare DNS</span>
          </span>
          <span>
            Engine: <span className="text-slate-700 dark:text-slate-200 font-bold">Posh-ACME</span>
          </span>
        </div>
      </div>

      {/* Top PKI Summary Metrics Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Total Domains */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Domains</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            {totalDomains}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">Managed via Posh-ACME</div>
        </div>

        {/* Fleet Health Status */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Fleet Expiry Health</div>
          <div className="mt-1 flex items-center gap-2">
            {criticalCount > 0 ? (
              <span className="text-xl font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                {criticalCount} Critical
              </span>
            ) : expiringCount > 0 ? (
              <span className="text-xl font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                {expiringCount} Expiring
              </span>
            ) : (
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                {healthyCount}/{totalDomains} Healthy
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
            {healthyCount === totalDomains ? 'All certs >= 30 days' : `${expiringCount + criticalCount} certs due`}
          </div>
        </div>

        {/* Drift Status */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Cryptographic Drift</div>
          <div className="mt-1">
            {driftCount > 0 ? (
              <span className="text-xl font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                {driftCount} Drift Detected
              </span>
            ) : (
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                0 Drift Detected
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
            {driftCount > 0 ? 'Local .crt != Live :443' : '100% SHA256 Match'}
          </div>
        </div>

        {/* Shortest Expiration */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Shortest Expiration</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {minDays >= 0 ? `${minDays}d` : 'Unknown'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
            Next renewal window: {Math.max(0, minDays - 30)}d
          </div>
        </div>
      </div>

      {/* Inline Live SSL Renewal & Deployment Progress Area */}
      {latestSslJob && !isDismissed && (
        <SslProgressInline
          activeJob={latestSslJob}
          onRefreshSsl={onRefreshSsl}
          onDismiss={() => setIsDismissed(true)}
        />
      )}

      {/* 5-Domain SSL Certificate Matrix with Live Dual-Probe */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Home Lab PKI Dual-Probe Matrix & Drift Inspector
          </h3>
          {sslFleet?.probed_at && (
            <span className="text-[11px] text-slate-500 font-mono">
              Last Probed: {new Date(sslFleet.probed_at).toLocaleTimeString()}
            </span>
          )}
        </div>

        <SslDualProbeTable
          items={sslFleet?.items || []}
          isLoading={isLoadingSsl}
          activeJobTitle={activeSslJob?.title}
          onDeployTarget={handleDeploySingleTarget}
          onRenewCert={handleRenewSingleCert}
          onRenewAndDeploy={handleRenewAndDeploySingle}
        />
      </div>

      {/* Confirmation Modal for Force Renew All */}
      <ConfirmDangerModal
        isOpen={isForceModalOpen}
        title="Force Renew All SSL Certificates"
        description="This operation executes 'Get-SSLCerts.ps1 -Unattended -ForceRenewal'. It will request new certificates from Let's Encrypt via Cloudflare DNS for all 5 domains, copy certificates over SSH/SMB, and restart services (Lighttpd, Genmon) regardless of remaining days. Continue?"
        confirmWord="FORCE RENEW"
        confirmLabel="Force Renew All"
        onConfirm={handleForceRenewConfirm}
        onCancel={() => setIsForceModalOpen(false)}
      />
    </div>
  );
};
