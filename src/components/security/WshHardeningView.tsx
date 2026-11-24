import React, { useMemo } from 'react';
import { Shield, ShieldCheck, ShieldAlert, Network, Lock } from 'lucide-react';
import { DiscoveredApp, WshSnapshot } from '../../lib/types';
import { synthesizeTopology } from '../../lib/topology-synthesizer';
import { DockerNetworkRulesAdvisor } from '../topology/DockerNetworkRulesAdvisor';

interface WshHardeningViewProps {
  snapshot: WshSnapshot | null;
  apps?: DiscoveredApp[];
  onRunAuditCommand?: (label: string, cmd: string, args: string[]) => void;
  onRunPenetrationAudit?: () => void;
  onReapplyHardening?: () => void;
  onNavigateToTopology?: () => void;
  onNavigateToSecurity?: () => void;
  onNavigateToUnifi?: () => void;
}

export const WshHardeningView: React.FC<WshHardeningViewProps> = ({
  snapshot,
  apps = [],
  onRunAuditCommand,
  onRunPenetrationAudit,
  onReapplyHardening,
  onNavigateToTopology,
  onNavigateToSecurity,
  onNavigateToUnifi,
}) => {
  const topology = useMemo(
    () => synthesizeTopology(apps, snapshot, null),
    [apps, snapshot]
  );

  const totalCount = topology.securityAudit.invariants.length;
  const violationCount = topology.securityAudit.securityViolationCount;
  const passingCount = Math.max(0, totalCount - violationCount);
  const hasSnapshot = snapshot !== null;

  return (
    <div className="p-6 max-w-[1920px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Shield className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              WSH Hardening &amp; Container Rules
            </h1>
            {hasSnapshot && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border tabular-nums ${
                  violationCount > 0
                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/35'
                }`}
              >
                {violationCount > 0 ? (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{violationCount} VIOLATIONS</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {passingCount}/{totalCount} INVARIANTS PASS
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Authoritative Depth-2 home for SEC-01..SEC-09 containment invariants, WSH iptables firewall enforcement, Docker bridge/ICC rules, and daemon policy.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onNavigateToTopology && (
            <button
              type="button"
              onClick={onNavigateToTopology}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <Network className="w-3.5 h-3.5" />
              <span>Topology &amp; Ingress →</span>
            </button>
          )}
          {onNavigateToUnifi && (
            <button
              type="button"
              onClick={onNavigateToUnifi}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>UniFi Network &amp; ZBF →</span>
            </button>
          )}
          {onNavigateToSecurity && (
            <button
              type="button"
              onClick={onNavigateToSecurity}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Threat SOC →</span>
            </button>
          )}
        </div>
      </div>

      <DockerNetworkRulesAdvisor
        topology={topology}
        onRunAuditCommand={onRunAuditCommand}
        onRunPenetrationAudit={onRunPenetrationAudit}
        onReapplyHardening={onReapplyHardening}
      />
    </div>
  );
};
