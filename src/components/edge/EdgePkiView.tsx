import React, { useState } from 'react';
import { WshSnapshot, SslFleetSummary } from '../../lib/types';
import { SslDualProbeTable } from './SslDualProbeTable';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import {
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Zap,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

interface EdgePkiViewProps {
  snapshot: WshSnapshot | null;
  sslFleet: SslFleetSummary | null;
  isLoading?: boolean;
  isLoadingSsl?: boolean;
  onRefreshSsl?: () => void;
  onTriggerRenewal?: (options: {
    unattended?: boolean;
    forceRenewal?: boolean;
    deployTargets?: string[];
    targetDevice?: string;
  }) => void;
}

export const EdgePkiView: React.FC<EdgePkiViewProps> = ({
  sslFleet,
  isLoadingSsl = false,
  onRefreshSsl,
  onTriggerRenewal,
}) => {
  const [isForceModalOpen, setIsForceModalOpen] = useState(false);

  const totalDomains = sslFleet?.total_domains ?? 5;
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
      onTriggerRenewal({ unattended: true, deployTargets: [deviceKey] });
    }
  };

  const handleRenewSingleCert = (deviceKey: string, force: boolean = false) => {
    if (onTriggerRenewal) {
      onTriggerRenewal({
        unattended: true,
        forceRenewal: force,
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
            5-Domain X.509 dual-probe TLS validation, drift detection & automated Let's Encrypt lifecycle
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
          onDeployTarget={handleDeploySingleTarget}
          onRenewCert={handleRenewSingleCert}
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
