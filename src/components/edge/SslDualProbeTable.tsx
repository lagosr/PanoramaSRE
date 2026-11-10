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
  FolderOpen,
  ChevronDown,
  Sparkles,
  Send,
  RotateCw,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { formatLocalDate } from '../../lib/formatters';

interface SslDualProbeTableProps {
  items: DomainSslDualProbe[];
  isLoading?: boolean;
  activeJobTitle?: string;
  onDeployTarget?: (deviceKey: string) => void;
  onRenewCert?: (deviceKey: string, force?: boolean) => void;
  onRenewAndDeploy?: (deviceKey: string, force?: boolean) => void;
}

export const SslDualProbeTable: React.FC<SslDualProbeTableProps> = ({
  items,
  isLoading = false,
  activeJobTitle,
  onDeployTarget,
  onRenewCert,
  onRenewAndDeploy,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const renderHealthBadge = (status: SslHealthStatus, daysRemaining: number) => {
    if (status === 'SELF_SIGNED') {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
          SELF-SIGNED
        </span>
      );
    }
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
      case 'SELF_SIGNED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3.5 h-3.5" />
            UNTRUSTED CERT
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
    <div className="overflow-x-auto min-h-[460px]">
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
                Executing dual-probe TLS handshakes across {items.length || 7} fleet domains...
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 text-center text-slate-400 font-sans">
                No appliance domains discovered in config.json.
              </td>
            </tr>
          ) : (
            items.map((item, index) => {
              const localCopyId = `local-${item.device_key}`;
              const liveCopyId = `live-${item.device_key}`;
              const isItemBusy = Boolean(
                activeJobTitle &&
                (activeJobTitle.toLowerCase().includes(item.device_key.toLowerCase()) ||
                 activeJobTitle.toLowerCase().includes(item.domain.toLowerCase()) ||
                 activeJobTitle.toLowerCase().includes(item.display_name.toLowerCase()) ||
                 activeJobTitle.toLowerCase().includes('all ssl'))
              );
              const isNearBottom = index >= items.length - 2;

              return (
                <tr
                  key={item.device_key}
                  className={`transition-colors ${
                    isItemBusy
                      ? 'bg-amber-500/10 dark:bg-amber-500/15 border-l-2 border-l-amber-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {/* Appliance & Domain */}
                  <td className="py-3.5 pl-1">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        <Server className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 font-sans text-xs">
                            {item.display_name}
                          </span>
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
                        {item.local_target_folder && (
                          <button
                            onClick={() => invoke('open_in_file_manager', { path: item.local_target_folder })}
                            className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors group cursor-pointer text-left truncate max-w-[200px] mt-0.5"
                            title={`Open device certificate folder: ${item.local_target_folder}`}
                          >
                            <FolderOpen className="w-3 h-3 text-emerald-500/80 shrink-0 group-hover:scale-110 transition-transform" />
                            <span className="truncate underline decoration-dotted decoration-slate-400 dark:decoration-slate-600 underline-offset-2 group-hover:decoration-emerald-500">
                              {item.local_target_folder.split('\\').pop() || item.local_target_folder}
                            </span>
                          </button>
                        )}
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
                      {isItemBusy ? (
                        <span className="px-2.5 py-1 rounded text-xs font-sans font-medium text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 flex items-center gap-1.5 whitespace-nowrap">
                          <RefreshCw className="w-3 h-3 animate-spin text-amber-500" />
                          In Progress...
                        </span>
                      ) : (
                        <div className="relative inline-flex items-stretch h-7">
                          {/* Split Button: Primary Action (Renew Cert) */}
                          {onRenewCert && (
                            <button
                              onClick={() => onRenewCert(item.device_key, true)}
                              className="h-7 px-2.5 rounded-l text-xs font-sans font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors whitespace-nowrap flex-shrink-0 cursor-pointer flex items-center gap-1.5"
                              title={`Request fresh Let's Encrypt certificate for ${item.display_name} (local disk only)`}
                            >
                              <RotateCw className="w-3 h-3 text-emerald-500" />
                              <span>Renew</span>
                            </button>
                          )}

                          {/* Split Button: Dropdown Menu Trigger */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownKey(openDropdownKey === item.device_key ? null : item.device_key);
                            }}
                            className="h-7 w-6 rounded-r text-xs font-sans font-medium text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/25 border-y border-r border-emerald-500/30 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                            title="More Certificate Actions (Deploy, Renew & Deploy)"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>

                          {/* Dropdown Menu Popup - auto flips upward for bottom rows */}
                          {openDropdownKey === item.device_key && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={() => setOpenDropdownKey(null)}
                              />
                              <div className={`absolute right-0 z-40 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl py-1 text-left animate-in fade-in zoom-in-95 duration-150 ${
                                isNearBottom ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                              }`}>
                                <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                                  {item.display_name} Actions
                                </div>

                                {/* Option 1: Renew Only */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenDropdownKey(null);
                                    if (onRenewCert) onRenewCert(item.device_key, true);
                                  }}
                                  className="w-full px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 transition-colors"
                                >
                                  <RotateCw className="w-3.5 h-3.5 text-emerald-500" />
                                  <div className="text-left">
                                    <div className="font-semibold">Renew Only</div>
                                    <div className="text-[10px] text-slate-400">Request ACME & save locally</div>
                                  </div>
                                </button>

                                {/* Option 2: Deploy Only */}
                                {item.deploy_target_type !== 'LOCAL_VERIFY' && (
                                  <button
                                    type="button"
                                    disabled={!item.local_cert.exists}
                                    onClick={() => {
                                      setOpenDropdownKey(null);
                                      if (onDeployTarget) onDeployTarget(item.device_key);
                                    }}
                                    className="w-full px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <Send className="w-3.5 h-3.5 text-sky-500" />
                                    <div className="text-left">
                                      <div className="font-semibold">Deploy Only</div>
                                      <div className="text-[10px] text-slate-400">Push staged cert to appliance</div>
                                    </div>
                                  </button>
                                )}

                                {/* Option 3: Renew & Deploy */}
                                {item.deploy_target_type !== 'LOCAL_VERIFY' && onRenewAndDeploy && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenDropdownKey(null);
                                      onRenewAndDeploy(item.device_key, true);
                                    }}
                                    className="w-full px-3 py-2 text-xs flex items-center gap-2 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 transition-colors border-t border-slate-100 dark:border-slate-800"
                                  >
                                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                                    <div className="text-left">
                                      <div className="font-semibold">Renew & Deploy</div>
                                      <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">Full automated end-to-end</div>
                                    </div>
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
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
