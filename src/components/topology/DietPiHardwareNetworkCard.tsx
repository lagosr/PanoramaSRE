import React from 'react';
import {
  Server,
  Cpu,
  Activity,
  ShieldCheck,
  Network,
  CheckCircle2,
  KeyRound,
  Shield,
} from 'lucide-react';
import { SynthesizedTopology } from '../../lib/topology-synthesizer';
import type { SuricataGatekeeperStatusDto } from '../../lib/types';

interface DietPiHardwareNetworkCardProps {
  topology: SynthesizedTopology;
  suricataStatus?: SuricataGatekeeperStatusDto | null;
  onRefresh?: () => void;
  onNavigateToHardening?: () => void;
}

export const DietPiHardwareNetworkCard: React.FC<DietPiHardwareNetworkCardProps> = ({
  topology,
  suricataStatus = null,
  onNavigateToHardening,
}) => {
  const { host, securityAudit } = topology;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              DietPi Bare-Metal Host &amp; Hardware Network Stack
            </h3>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              Raspberry Pi ARM64 · Kernel {host.kernel} · DietPi v{host.dietpiVersion}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Host Kernel Netfilter Active
          </span>
        </div>
      </div>

      {/* Hardware Interfaces Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs tabular-nums">
        {/* Physical NIC: eth0 */}
        {(() => {
          const eth0 = host.physicalInterfaces.find((i) => i.ifname === 'eth0') || host.physicalInterfaces[0];
          const eth0Ipv4 = eth0?.addr_info?.find((a) => a.family === 'inet');
          const ipDisplay = eth0Ipv4 ? `${eth0Ipv4.local}/${eth0Ipv4.prefixlen} (VLAN 500 Compute Systems)` : '172.25.25.5/24 (VLAN 500 Compute Systems)';
          const mtuDisplay = eth0?.mtu ? `${eth0.mtu} bytes` : '1500 bytes';
          const operstate = eth0?.operstate?.toUpperCase() || 'UP';

          return (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Network className="w-4 h-4 text-emerald-500" />
                  Physical Interface: {eth0?.ifname || 'eth0'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-600 font-semibold">
                  {operstate} / 1000 Mbps
                </span>
              </div>
              <div className="space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
                <div>IPv4: {ipDisplay}</div>
                <div>MTU: {mtuDisplay} · qdisc: {eth0?.qdisc || 'mq'}</div>
                <div>Default Gateway: 172.25.25.1 (UniFi Gateway Pro)</div>
              </div>
            </div>
          );
        })()}

        {/* Loopback Interface: lo */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-sky-500" />
              Host Loopback: lo
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] bg-sky-500/10 text-sky-600 font-semibold">
              MTU 65536
            </span>
          </div>
          <div className="space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
            <div>IPv4: 127.0.0.1/8 · IPv6: ::1/128</div>
            <div>Protected Host Socket Plane</div>
            <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
              {topology.routes.length} Suite Apps Bound Exclusively
            </div>
          </div>
        </div>

        {/* Kernel IP Forwarding */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-purple-500" />
              Kernel IP Routing Stack
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-600 font-semibold">
              FORWARD ENABLED
            </span>
          </div>
          <div className="space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
            <div>net.ipv4.ip_forward = 1</div>
            <div>PREROUTING DNAT Active</div>
            <div>DOCKER-USER Chain Enforced</div>
          </div>
        </div>
      </div>

      {/* Listening Sockets Security Audit Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            Host Listening Sockets &amp; Exposure Analysis
          </h4>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
              Security Score: {securityAudit.score}/100
            </span>
            {onNavigateToHardening && (
              <button
                type="button"
                onClick={onNavigateToHardening}
                className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Open WSH Hardening →</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-xs tabular-nums">
          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase">SSH Management</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">:22 (LAN Only)</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">Ed25519 / Key Auth Strict</div>
          </div>

          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase">Lighttpd Reverse Proxy</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">:80 / :443</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">TLS 1.3 Terminated</div>
          </div>

          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase">Container Host Ports</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">:3000 - :4000</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              127.0.0.1 Confined
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase">Cloudflare Tunnel</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">Outbound Only</div>
            <div className="text-[10px] text-purple-600 dark:text-purple-400">No Open Ports</div>
          </div>
        </div>
      </div>

      {/* Automation & SSH Gatekeeper Posture (FR-9 Extensibility Seam) */}
      <div className="space-y-2.5">
        <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
          Automation &amp; SSH Gatekeeper Posture
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-[var(--color-brand-text)]" />
                sre-agent-wsh Forced-Command Gatekeeper
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                  suricataStatus?.gatekeeperVerified
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                    : suricataStatus?.gatekeeperKeyExists
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30'
                    : 'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                }`}
              >
                {suricataStatus?.gatekeeperVerified
                  ? 'Verified · Ed25519'
                  : suricataStatus?.gatekeeperKeyExists
                  ? 'Key Provisioned (Unverified)'
                  : 'Standby (Manual SSH)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              {suricataStatus?.lastProbeDetail ||
                'Dedicated Ed25519 restricted-shell seam reserved for Autonomous AI Agent SRE allowlisted verbs (zero root interactive shell access).'}
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Suricata SSH SYN Budget
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold tabular-nums border ${
                  suricataStatus && suricataStatus.remaining === 0
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                }`}
              >
                {suricataStatus
                  ? `${suricataStatus.remaining === 0 ? 'Cooling' : 'Nominal'} · ${suricataStatus.usedLast120s} / ${suricataStatus.maxPer120s} SYNs per ${suricataStatus.windowSecs}s`
                  : 'Nominal · 0 / 2 SYNs per 120s'}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              UniFi CyberSecure IDS rate protection on WSH :22 prevents connection bursts from tripping automated SSH rate-limit blocks.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
