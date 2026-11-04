import React, { useState } from 'react';
import { DomainSslDualProbe, CertificateDriftStatus, SslHealthStatus } from '../../lib/types';
import {
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Clock,
  Server,
} from 'lucide-react';
import { formatLocalDate } from '../../lib/formatters';

interface SslDualProbeTableProps {
  items: DomainSslDualProbe[];
  isLoading?: boolean;
  onDeployTarget?: (deviceKey: string) => void;
  onRenewCert?: (deviceKey: string, force?: boolean) => void;
}

export const SslDualProbeTable: React.FC<SslDualProbeTableProps> = ({
  items,
  isLoading = false,
  onDeployTarget,
  onRenewCert,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const renderHealthBadge = (status: SslHealthStatus, daysRemaining: number) => {
    if (status === 'MISSING') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
          MISSING
        </span>
      );
    }
    if (status === 'ERROR') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30">
          PARSE ERROR
        </span>
      );
    }
    if (status === 'EXPIRED') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-500/20 text-red-700 dark:text-red-400 border border-red-500/40">
          EXPIRED
        </span>
      );
    }
    if (status === 'CRITICAL') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30">
          {daysRemaining}d CRITICAL
        </span>
      );
    }
    if (status === 'EXPIRING_SOON') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
          {daysRemaining}d EXPIRING
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
        {daysRemaining}d HEALTHY
      </span>
    );
  };

  const renderDriftBadge = (status: CertificateDriftStatus) => {
    switch (status) {
      case 'IN_SYNC':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
            <ShieldCheck className="w-3.5 h-3.5" />
            IN SYNC
          </span>
        );
      case 'DRIFT_DETECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40 animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5" />
            DRIFT DETECTED
          </span>
        );
      case 'LOCAL_ONLY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            LOCAL ONLY
          </span>
        );
      case 'LIVE_ONLY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30">
            LIVE ONLY
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
            <HelpCircle className="w-3.5 h-3.5" />
            UNKNOWN
          </span>
        );
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs font-mono">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-sans uppercase tracking-wider text-[11px]">
            <th className="pb-3 pl-1">Appliance & Domain</th>
            <th className="pb-3">Local Staging (.crt)</th>
            <th className="pb-3">Live Port :443 Probe</th>
            <th className="pb-3">Drift Alignment</th>
            <th className="pb-3 pr-1 text-right">Target Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {isLoading && items.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 text-center text-slate-400 font-sans">
                <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-emerald-400" />
                Executing dual-probe TLS handshakes across 5 domains...
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 text-center text-slate-400 font-sans">
                No appliance domains discovered in config.json.
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const localCopyId = `local-${item.device_key}`;
              const liveCopyId = `live-${item.device_key}`;

              return (
                <tr
                  key={item.device_key}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  {/* Appliance & Domain */}
                  <td className="py-3.5 pl-1">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        <Server className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 font-sans text-xs">
                          {item.display_name}
                        </div>
                        <a
                          href={`https://${item.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 inline-flex items-center gap-1 font-mono text-[11px] mt-0.5"
                        >
                          {item.domain}
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                        <div className="text-[10px] text-slate-500 mt-0.5 font-sans">
                          {item.deploy_target_type}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Local Staging */}
                  <td className="py-3.5">
                    {item.local_cert.exists ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-800 dark:text-slate-300 font-semibold">
                            {formatLocalDate(item.local_cert.not_after)}
                          </span>
                          {renderHealthBadge(
                            item.local_cert.status,
                            item.local_cert.days_remaining
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                          <span className="text-slate-400 dark:text-slate-500 font-sans">SHA256:</span>
                          <span className="font-mono">
                            {item.local_cert.thumbprint.slice(0, 8)}...
                            {item.local_cert.thumbprint.slice(-6)}
                          </span>
                          <button
                            onClick={() =>
                              handleCopy(item.local_cert.thumbprint, localCopyId)
                            }
                            className="p-0.5 hover:text-emerald-500 dark:hover:text-emerald-400 text-slate-400 dark:text-slate-500 transition-colors"
                            title="Copy full local thumbprint"
                          >
                            {copiedKey === localCopyId ? (
                              <Check className="w-2.5 h-2.5 text-emerald-500 dark:text-emerald-400" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-500 text-[11px] italic font-sans">
                        {item.local_cert.error || 'No staging file on disk'}
                      </span>
                    )}
                  </td>

                  {/* Live Port 443 Probe */}
                  <td className="py-3.5">
                    {item.live_cert.reachable ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-800 dark:text-slate-300 font-semibold">
                            {formatLocalDate(item.live_cert.not_after)}
                          </span>
                          {renderHealthBadge(
                            item.live_cert.status,
                            item.live_cert.days_remaining
                          )}
                          <span className="text-[10px] text-slate-500 inline-flex items-center gap-0.5 font-sans">
                            <Clock className="w-2.5 h-2.5" />
                            {item.live_cert.latency_ms}ms
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                          <span className="text-slate-400 dark:text-slate-500 font-sans">SHA256:</span>
                          <span className="font-mono">
                            {item.live_cert.thumbprint.slice(0, 8)}...
                            {item.live_cert.thumbprint.slice(-6)}
                          </span>
                          <button
                            onClick={() =>
                              handleCopy(item.live_cert.thumbprint, liveCopyId)
                            }
                            className="p-0.5 hover:text-emerald-500 dark:hover:text-emerald-400 text-slate-400 dark:text-slate-500 transition-colors"
                            title="Copy full live peer thumbprint"
                          >
                            {copiedKey === liveCopyId ? (
                              <Check className="w-2.5 h-2.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-rose-400 text-[11px] font-sans">
                        Unreachable ({item.live_cert.latency_ms}ms)
                      </span>
                    )}
                  </td>

                  {/* Drift Alignment */}
                  <td className="py-3.5">
                    {renderDriftBadge(item.drift_status)}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 pr-1 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-nowrap">
                      {onRenewCert && (
                        <button
                          onClick={() => onRenewCert(item.device_key, true)}
                          className="px-2.5 py-1 rounded text-xs font-sans font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors whitespace-nowrap flex-shrink-0 cursor-pointer"
                          title={`Request fresh Let's Encrypt certificate and deploy to ${item.display_name}`}
                        >
                          Renew Cert
                        </button>
                      )}
                      {onDeployTarget && item.deploy_target_type !== 'LOCAL_VERIFY' && (
                        <button
                          onClick={() => onDeployTarget(item.device_key)}
                          className="px-2.5 py-1 rounded text-xs font-sans font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 transition-colors whitespace-nowrap flex-shrink-0 cursor-pointer"
                          title={`Push current certificate to ${item.display_name} without re-requesting from Let's Encrypt`}
                        >
                          Deploy
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
