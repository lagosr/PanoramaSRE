import React, { useState } from 'react';
import {
  Cloud,
  ArrowRight,
  CheckCircle2,
  Lock,
  Radio,
  RefreshCw,
  AlertTriangle,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import { SynthesizedTopology } from '../../lib/topology-synthesizer';
import { WshSnapshot } from '../../lib/types';
import { stripAnsiCodes, formatConsoleLine } from '../layout/ConsoleColorizer';

interface CloudflareTunnelTopologyCardProps {
  topology: SynthesizedTopology;
  snapshot?: WshSnapshot | null;
  onTriggerTunnelAction?: (action: 'status' | 'check_update' | 'update' | 'update_force') => void;
}

export const CloudflareTunnelTopologyCard: React.FC<CloudflareTunnelTopologyCardProps> = ({
  topology,
  snapshot,
  onTriggerTunnelAction,
}) => {
  const [copiedTunnelLogs, setCopiedTunnelLogs] = useState(false);

  const { cloudflared } = topology;
  const versionRaw = snapshot?.cloudflared?.version_raw || cloudflared.version || '';
  const versionMatch = versionRaw.match(/version\s+([0-9.]+)/i);
  const detectedVersion = versionMatch ? `v${versionMatch[1]}` : versionRaw ? versionRaw : 'v2026.10.7';
  const isUpToDate = !versionMatch || versionMatch[1] === '2026.10.7' || versionMatch[1] >= '2026.10.7';

  const tunnelLogs = (snapshot?.cloudflared?.recent_logs || '').trim();
  const logLines = tunnelLogs
    ? tunnelLogs.split('\n')
    : cloudflared.recentLogs && cloudflared.recentLogs.length > 0
    ? cloudflared.recentLogs
    : [];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-6 space-y-6">
      {/* Top Header & Lifecycle Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
              Cloudflare Zero Trust Tunnel & Host Boundary
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                {detectedVersion}
              </span>
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              Outbound Multiplexed QUIC Tunnel · Container Network Mode:{' '}
              <code className="text-purple-600 dark:text-purple-400 font-bold">{cloudflared.networkMode || 'cf-egress-net (100.64.250.0/24)'}</code>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isUpToDate ? (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Up to Date
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Upgrade Recommended
            </span>
          )}

          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 animate-pulse text-purple-500" />
            ACTIVE QUIC TUNNEL
          </span>

          {/* Action Buttons backed by deploy-cloudflare-tunnel.ps1 */}
          {onTriggerTunnelAction && (
            <div className="flex items-center gap-1.5 ml-1">
              <button
                onClick={() => onTriggerTunnelAction('status')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors"
                title="Query live container status and logs via deploy-cloudflare-tunnel.ps1 -Status"
              >
                <Terminal className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Status
              </button>

              <button
                onClick={() => onTriggerTunnelAction('check_update')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors"
                title="Check upstream GitHub releases via deploy-cloudflare-tunnel.ps1 -CheckUpdate"
              >
                <RefreshCw className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                Check Updates
              </button>

              <button
                onClick={() => onTriggerTunnelAction(isUpToDate ? 'update_force' : 'update')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
                  isUpToDate
                    ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
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
          )}
        </div>
      </div>

      {/* Cloudflare Tunnel Ingress Flow Diagram */}
      <div className="p-4 rounded-xl border border-purple-100 dark:border-purple-900/30 bg-purple-50/30 dark:bg-purple-950/20 space-y-4">
        <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
          <Lock className="w-4 h-4 text-purple-500" />
          Ingress Path from Cloudflare Edge to Host Loopback
        </h4>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <span className="text-[10px] text-slate-400 block">Cloudflare Edge</span>
            <span className="text-purple-600 dark:text-purple-400 font-bold">wsh.panoramadr.com</span>
          </div>

          <ArrowRight className="w-4 h-4 text-purple-500" />

          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <span className="text-[10px] text-slate-400 block">Outbound QUIC Tunnel</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">UDP 7844 / TCP 443</span>
          </div>

          <ArrowRight className="w-4 h-4 text-purple-500" />

          <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-700 dark:text-purple-400">
            <span className="text-[10px] text-purple-500 block">cloudflared Daemon</span>
            <span className="font-bold">network_mode: "host"</span>
          </div>

          <ArrowRight className="w-4 h-4 text-purple-500" />

          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">Host Reverse Proxy</span>
            <span className="font-bold">https://127.0.0.1:443 (Lighttpd)</span>
          </div>
        </div>
      </div>

      {/* Cloudflare Tunnel Ingress Rules Table */}
      <div className="space-y-3 font-mono text-xs">
        <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
          Ingress Mapping Configuration (Zero WAN Exposure)
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-1">
            <div className="text-[10px] text-slate-400">Ingress Target Service</div>
            <div className="text-emerald-600 dark:text-emerald-400 font-bold">{cloudflared.ingressTarget}</div>
            <div className="text-[10px] text-slate-500">noTLSVerify: true (Trusts host-origin cert)</div>
          </div>

          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-1">
            <div className="text-[10px] text-slate-400">Tunnel Daemon Version</div>
            <div className="text-slate-800 dark:text-slate-200 font-bold truncate">{versionRaw || 'cloudflared daemon'}</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Upstream Synchronized
            </div>
          </div>
        </div>
      </div>

      {/* Live Recent Connection Logs Console Stream */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-mono text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-purple-500" />
              Recent Tunnel Connection Logs ({logLines.length}):
            </span>
            {logLines.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(stripAnsiCodes(logLines.join('\n')));
                    setCopiedTunnelLogs(true);
                    setTimeout(() => setCopiedTunnelLogs(false), 2000);
                  } catch (err) {
                    console.warn('Failed to copy tunnel logs:', err);
                  }
                }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer whitespace-nowrap flex-shrink-0"
                title="Copy ANSI-stripped connection logs to clipboard"
              >
                {copiedTunnelLogs ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                    <span>Copy Logs</span>
                  </>
                )}
              </button>
            )}
          </div>
          <span className="text-[11px] text-slate-500">
            Upstream Target: <strong className="text-emerald-700 dark:text-emerald-400">wsh.panoramadr.com</strong>
          </span>
        </div>

        <div className="font-mono text-xs bg-slate-50 dark:bg-[#050b14] p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto max-h-60 space-y-1 selection:bg-purple-500/20 dark:selection:bg-purple-500/30 shadow-inner">
          {logLines.length > 0 ? (
            logLines.map((line, idx) => {
              const cleanLine = stripAnsiCodes(line);
              const match = cleanLine.match(/^(\S+)\s+(ERR|WRN|INF|DBG)\s+(.*)$/);
              if (match) {
                const [, timestamp, level, rest] = match;
                const isErr = level === 'ERR';
                const isWrn = level === 'WRN';

                return (
                  <div
                    key={idx}
                    className={`flex items-start gap-2.5 px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                      isErr
                        ? 'bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300'
                        : isWrn
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300'
                        : 'hover:bg-slate-200/50 dark:hover:bg-slate-900/60 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <span className="text-[11px] text-slate-500 shrink-0 select-none">
                      {timestamp}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 tracking-wider uppercase ${
                        isErr
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/35'
                          : isWrn
                          ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {level}
                    </span>
                    <span className="break-all leading-relaxed">
                      {formatConsoleLine(rest)}
                    </span>
                  </div>
                );
              }

              return (
                <div key={idx} className="text-xs py-0.5 px-2">
                  {formatConsoleLine(line)}
                </div>
              );
            })
          ) : (
            <div className="text-center py-6 text-slate-500 font-sans text-xs">
              No recent tunnel logs discovered in host snapshot. Click &quot;Status&quot; above to query live logs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
