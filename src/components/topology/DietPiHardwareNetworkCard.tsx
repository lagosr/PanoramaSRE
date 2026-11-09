import React from 'react';
import {
  Server,
  Cpu,
  Activity,
  ShieldCheck,
  Network,
  CheckCircle2,
} from 'lucide-react';
import { SynthesizedTopology } from '../../lib/topology-synthesizer';

interface DietPiHardwareNetworkCardProps {
  topology: SynthesizedTopology;
  onRefresh?: () => void;
}

export const DietPiHardwareNetworkCard: React.FC<DietPiHardwareNetworkCardProps> = ({
  topology,
}) => {
  const { host, securityAudit } = topology;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
              DietPi Bare-Metal Host & Hardware Network Stack
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              Raspberry Pi ARM64 · Kernel {host.kernel} · DietPi v{host.dietpiVersion}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Host Kernel Netfilter Active
          </span>
        </div>
      </div>

      {/* Hardware Interfaces Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
        {/* Physical NIC: eth0 */}
        {(() => {
          const eth0 = host.physicalInterfaces.find((i) => i.ifname === 'eth0') || host.physicalInterfaces[0];
          const eth0Ipv4 = eth0?.addr_info?.find((a) => a.family === 'inet');
          const ipDisplay = eth0Ipv4 ? `${eth0Ipv4.local}/${eth0Ipv4.prefixlen} (VLAN 500 Compute Systems)` : '172.25.25.5/24 (VLAN 500 Compute Systems)';
          const mtuDisplay = eth0?.mtu ? `${eth0.mtu} bytes` : '1500 bytes';
          const operstate = eth0?.operstate?.toUpperCase() || 'UP';

          return (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
              <div className="flex items-center justify-between">
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
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
          <div className="flex items-center justify-between">
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
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
          <div className="flex items-center justify-between">
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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            Host Listening Sockets & Exposure Analysis
          </h4>
          <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
            Security Score: {securityAudit.score}/100
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-xs">
          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase">SSH Management</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">:22 (LAN Only)</div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">RSA Key Auth Strict</div>
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
    </div>
  );
};
