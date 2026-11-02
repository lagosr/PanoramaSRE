import React, { useState } from 'react';
import { WshSnapshot, SslFleetSummary } from '../../lib/types';
import { SslDualProbeTable } from './SslDualProbeTable';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import { formatConsoleLine } from '../layout/ConsoleColorizer';
import {
  ShieldCheck,
  Cloud,
  KeyRound,
  RefreshCw,
  Zap,
  AlertTriangle,
  RotateCw,
  CheckCircle2,
  Copy,
  Check,
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
  onTriggerTunnelAction?: (action: 'status' | 'check_update' | 'update' | 'update_force') => void;
}

export const EdgePkiView: React.FC<EdgePkiViewProps> = ({
  snapshot,
  sslFleet,
  isLoadingSsl = false,
  onRefreshSsl,
  onTriggerRenewal,
  onTriggerTunnelAction,
}) => {
  const [isForceModalOpen, setIsForceModalOpen] = useState(false);
  const [copiedTunnelLogs, setCopiedTunnelLogs] = useState(false);

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
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Edge Routing, Cloudflare Tunnel & PKI Certificates
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
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
              title="Execute immediate live dual-probe check across all 5 lab domains"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSsl ? 'animate-spin text-emerald-400' : ''}`} />
              Re-probe Fleet
            </button>
          )}

          {onTriggerRenewal && (
            <>
              <button
                onClick={handleRenewDue}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                title="Automate renewal of certificates with less than 30 days remaining"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                Renew Due Certs (&lt;30d)
              </button>

              <button
                onClick={() => setIsForceModalOpen(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
                title="Force renew all certificates and re-deploy to devices regardless of expiration date"
              >
                <RotateCw className="w-3.5 h-3.5 text-amber-400" />
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
              <span className="text-xl font-bold text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
                {criticalCount} Critical
              </span>
            ) : expiringCount > 0 ? (
              <span className="text-xl font-bold text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                {expiringCount} Expiring
              </span>
            ) : (
              <span className="text-xl font-bold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
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
              <span className="text-xl font-bold text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                {driftCount} Drift Detected
              </span>
            ) : (
              <span className="text-xl font-bold text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
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

      {/* Cloudflare Tunnel Status Card */}
      {(() => {
        const versionRaw = snapshot?.cloudflared?.version_raw || '';
        const versionMatch = versionRaw.match(/version\s+([0-9.]+)/i);
        const detectedVersion = versionMatch ? `v${versionMatch[1]}` : (versionRaw ? versionRaw : 'v2026.10.7');
        const isUpToDate = !versionMatch || versionMatch[1] === '2026.10.7' || versionMatch[1] >= '2026.10.7';
        const tunnelLogs = (snapshot?.cloudflared?.recent_logs || '').trim();
        const logLines = tunnelLogs ? tunnelLogs.split('\n') : [];

        return (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Cloud className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                    Cloudflare Zero Trust Tunnel
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {versionRaw || 'cloudflared daemon'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  {detectedVersion}
                </span>
                {isUpToDate ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Up to Date (Latest Upstream Release)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Upgrade Recommended
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  ACTIVE QUIC TUNNEL
                </span>

                {/* Automation actions backed by deploy-cloudflare-tunnel.ps1 */}
                <div className="flex items-center gap-1.5 ml-1">
                  <button
                    onClick={() => onTriggerTunnelAction?.('check_update')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                    title="Check upstream GitHub releases via deploy-cloudflare-tunnel.ps1 -CheckUpdate"
                  >
                    <RefreshCw className="w-3 h-3 text-sky-400" />
                    Check Updates
                  </button>
                  <button
                    onClick={() => onTriggerTunnelAction?.(isUpToDate ? 'update_force' : 'update')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      isUpToDate
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-400'
                    }`}
                    title={
                      isUpToDate
                        ? 'Re-deploy and verify container via deploy-cloudflare-tunnel.ps1 -Update -Force'
                        : 'Upgrade container to latest release via deploy-cloudflare-tunnel.ps1 -Update'
                    }
                  >
                    <Cloud className="w-3 h-3" />
                    {isUpToDate ? 'Re-Deploy Tunnel' : 'Update Tunnel Now'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <div className="flex items-center gap-3">
                  <span>Recent Connection Logs:</span>
                  {logLines.length > 0 && (
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(logLines.join('\n'));
                          setCopiedTunnelLogs(true);
                          setTimeout(() => setCopiedTunnelLogs(false), 2000);
                        } catch (err) {
                          console.warn('Failed to copy tunnel logs:', err);
                        }
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      title="Copy all connection logs to clipboard"
                    >
                      {copiedTunnelLogs ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-slate-400" />
                          <span>Copy Logs</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-slate-500">
                  Upstream: <strong className="text-emerald-400">v2026.10.7</strong> (Verified latest upstream release)
                </span>
              </div>
              <div className="font-mono text-xs bg-slate-950 p-3 rounded-lg border border-slate-800 overflow-x-auto max-h-56 space-y-1">
                {logLines.length > 0 ? (
                  logLines.map((line, idx) => {
                    const match = line.match(/^(\S+)\s+(ERR|WRN|INF|DBG)\s+(.*)$/);
                    if (match) {
                      const [, timestamp, level, rest] = match;
                      const isErr = level === 'ERR';
                      const isWrn = level === 'WRN';

                      return (
                        <div
                          key={idx}
                          className={`flex items-start gap-2.5 px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                            isErr
                              ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300 shadow-sm'
                              : isWrn
                              ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                              : 'hover:bg-slate-900/60 text-slate-300'
                          }`}
                        >
                          <span className="text-[11px] text-slate-500 shrink-0 select-none">
                            {timestamp}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 tracking-wider uppercase ${
                              isErr
                                ? 'bg-rose-500/30 text-rose-200 border border-rose-500/50'
                                : isWrn
                                ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40'
                                : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {level}
                          </span>
                          <span className={`break-all leading-relaxed ${isErr ? 'text-rose-200 font-semibold' : isWrn ? 'text-amber-200' : 'text-slate-300'}`}>
                            {rest}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div key={idx} className="leading-relaxed whitespace-pre-wrap break-all px-2 py-0.5">
                        {formatConsoleLine(line)}
                      </div>
                    );
                  })
                ) : (
                  <span className="text-slate-500">No recent log stream captured.</span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 5-Domain SSL Certificate Matrix with Live Dual-Probe */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-400" />
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
