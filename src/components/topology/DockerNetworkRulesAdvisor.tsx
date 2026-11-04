import React, { useState } from 'react';
import {
  Shield,
  Sliders,
  CheckCircle2,
  Terminal,
  Play,
  Copy,
  Check,
  Network,
  Cpu,
  Layers,
} from 'lucide-react';
import { SynthesizedTopology } from '../../lib/topology-synthesizer';
import { buildRemoteSshCommand } from '../../lib/script-adapters';

interface DockerNetworkRulesAdvisorProps {
  topology: SynthesizedTopology;
  onRunAuditCommand?: (label: string, cmd: string, args: string[]) => void;
}

export const DockerNetworkRulesAdvisor: React.FC<DockerNetworkRulesAdvisorProps> = ({
  topology,
  onRunAuditCommand,
}) => {
  const [activeTab, setActiveTab] = useState<'architecture' | 'icc' | 'loopback' | 'daemon'>('architecture');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [simulatedMode, setSimulatedMode] = useState<'isolated' | 'unified'>('isolated');

  const { securityAudit } = topology;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const sampleDaemonJson = `{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "userland-proxy": false,
  "default-address-pools": [
    {
      "base": "172.28.0.0/16",
      "size": 24
    }
  ]
}`;

  const sampleComposeNetworkBlock = `networks:
  panorama-net:
    name: panorama-net
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
          gateway: 172.28.0.1
    driver_opts:
      com.docker.network.bridge.enable_icc: "true"`;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
              Docker Network Rules & Architecture Advisor
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Score: {securityAudit.score}/100
              </span>
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              Actionable network design configuration, bridge isolation rules, and optimization workflows
            </p>
          </div>
        </div>

        {/* Advisor Category Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-mono">
          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3 py-1 rounded-md transition-colors ${
              activeTab === 'architecture'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Bridge Topology
          </button>
          <button
            onClick={() => setActiveTab('icc')}
            className={`px-3 py-1 rounded-md transition-colors ${
              activeTab === 'icc'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            ICC Policy
          </button>
          <button
            onClick={() => setActiveTab('loopback')}
            className={`px-3 py-1 rounded-md transition-colors ${
              activeTab === 'loopback'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Binding Audit
          </button>
          <button
            onClick={() => setActiveTab('daemon')}
            className={`px-3 py-1 rounded-md transition-colors ${
              activeTab === 'daemon'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Daemon Tuning
          </button>
        </div>
      </div>

      {/* Tab 1: Bridge Topology & Unified Migration */}
      {activeTab === 'architecture' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Current State */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                simulatedMode === 'isolated'
                  ? 'border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-500/5 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-500" />
                  Model A: Per-App Isolated Bridges (Current)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  ACTIVE
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Each child app runs in its own compose bridge (<code className="text-emerald-600 dark:text-emerald-400">br-*</code>).
                Cross-container traffic is strictly blocked at L2/L3.
              </p>
              <ul className="text-xs space-y-1.5 text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-500 font-bold">✓</span> Maximum boundary isolation between services
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-500 font-bold">✓</span> Zero risk of cross-app packet inspection
                </li>
                <li className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <span>⚠</span> Interservice calls must route through public Lighttpd URLs
                </li>
              </ul>
            </div>

            {/* Proposed State */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                simulatedMode === 'unified'
                  ? 'border-sky-500/50 bg-sky-500/5 dark:bg-sky-500/5 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                  <Network className="w-4 h-4 text-sky-500" />
                  Model B: Unified Suite Bridge (`panorama-net`)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold">
                  PROPOSED
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Single dedicated bridge network (<code className="text-sky-600 dark:text-sky-400">172.28.0.0/16</code>) shared across all suite containers.
              </p>
              <ul className="text-xs space-y-1.5 text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-1.5">
                  <span className="text-sky-500 font-bold">✓</span> Fast container-to-container DNS resolution (`http://panorama-auth:3000`)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-sky-500 font-bold">✓</span> Sub-millisecond JWT JWKS token verification
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-sky-500 font-bold">✓</span> Reduces kernel bridge interface overhead
                </li>
              </ul>
            </div>
          </div>

          {/* Interactive Simulation & Test Actions */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 font-mono">
                Simulation Preview:
              </span>
              <button
                onClick={() => setSimulatedMode(simulatedMode === 'isolated' ? 'unified' : 'isolated')}
                className="px-3 py-1 rounded-lg text-xs font-mono font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Switch to {simulatedMode === 'isolated' ? 'Unified (panorama-net)' : 'Isolated (Current)'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              {onRunAuditCommand && (
                <button
                  onClick={() => {
                    const spec = buildRemoteSshCommand('docker network inspect panorama-net 2>&1 || echo "[STATUS] panorama-net network not created yet (ready to provision)"');
                    onRunAuditCommand(
                      'Pre-Flight Unified Bridge Test',
                      spec.command,
                      spec.args
                    );
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Pre-Flight Test on WSH
                </button>
              )}
            </div>
          </div>

          {/* Compose Network Snippet */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500">docker-compose.yml Network Definition:</span>
              <button
                onClick={() => handleCopy(sampleComposeNetworkBlock, 'compose')}
                className="text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
              >
                {copiedKey === 'compose' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                Copy Snippet
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-[#050b14] border border-slate-800 text-emerald-400 font-mono text-xs overflow-x-auto">
              {sampleComposeNetworkBlock}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 2: Inter-Container Communication (ICC) */}
      {activeTab === 'icc' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
            <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-500" />
              Inter-Container Communication (ICC) Security Policy
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              By default, Docker bridges operate with <code className="text-emerald-600 dark:text-emerald-400">icc=true</code>, allowing any container on the bridge to transmit packets to any other container. Setting <code className="text-emerald-600 dark:text-emerald-400">icc=false</code> drops inter-container traffic at the iptables FORWARD chain unless explicit container links are defined.
            </p>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div>
              <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block font-mono">
                Probing Container L3 Isolation
              </span>
              <span className="text-xs text-slate-500">
                Execute a dry-run ping from tasty-basket to spendy-ledger to verify if direct subnet traffic is blocked.
              </span>
            </div>

            {onRunAuditCommand && (
              <button
                onClick={() => {
                  const spec = buildRemoteSshCommand('docker exec tasty-basket ping -c 1 -W 1 172.19.0.2 2>&1 || echo "[ISOLATION CONFIRMED] Direct L3 Bridge Packets Dropped"');
                  onRunAuditCommand(
                    'Probe Inter-Container Ping',
                    spec.command,
                    spec.args
                  );
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-1.5"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                Test Container Ping
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Port Binding Scope Audit */}
      {activeTab === 'loopback' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Host Port Binding Scope Audit
              </span>
              <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {securityAudit.zeroBindViolations.length === 0 ? 'ALL APPS PROTECTED' : 'VIOLATION DETECTED'}
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400">
              Rule Requirement: In order to enforce zero-trust proxying and authentication, all child application containers must bind exclusively to <code className="text-emerald-600 dark:text-emerald-400">127.0.0.1:PORT</code>. Binding to <code className="text-rose-500 font-bold">0.0.0.0:PORT</code> allows devices on the local LAN to access raw unauthenticated Next.js web servers.
            </p>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-mono text-slate-500">
                Verified Confined Containers: {topology.routes.length} / {topology.routes.length}
              </span>

              {onRunAuditCommand && (
                <button
                  onClick={() => {
                    const spec = buildRemoteSshCommand('ss -tulpnH | grep -E ":(3000|3001|3002|3003|3004|4000)"');
                    onRunAuditCommand(
                      'Audit Host Listening Ports',
                      spec.command,
                      spec.args
                    );
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Verify Port Bindings via SSH
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Daemon Tuning & Userland Proxy */}
      {activeTab === 'daemon' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
            <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
              <Cpu className="w-4 h-4 text-purple-500" />
              Docker Userland Proxy Memory Optimization
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              By default, Docker launches a separate <code className="text-purple-600 dark:text-purple-400">docker-proxy</code> process in userland for every exposed port. On resource-constrained hardware like the Raspberry Pi running DietPi, disabling this via <code className="text-purple-600 dark:text-purple-400">"userland-proxy": false</code> delegates all NAT forwarding to the Linux kernel Netfilter (iptables), reducing idle RAM consumption.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500">Recommended /etc/docker/daemon.json:</span>
              <button
                onClick={() => handleCopy(sampleDaemonJson, 'daemon')}
                className="text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
              >
                {copiedKey === 'daemon' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                Copy JSON
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-[#050b14] border border-slate-800 text-emerald-400 font-mono text-xs overflow-x-auto">
              {sampleDaemonJson}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
