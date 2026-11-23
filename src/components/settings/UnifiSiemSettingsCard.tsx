import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import { StatusBadge } from '@lagosr/panorama-ui-kit';
import type { UnifiSiemAction } from '../../lib/script-adapters';
import type {
  UnifiSiemEnvConfigDto,
  WshSnapshot,
} from '../../lib/types';

interface UnifiSiemSettingsCardProps {
  containers?: WshSnapshot['containers'];
  onTriggerUnifiSiemAction?: (action: UnifiSiemAction) => void;
  onReapplyHardening?: () => void;
}

export const UnifiSiemSettingsCard: React.FC<UnifiSiemSettingsCardProps> = ({
  containers = [],
  onTriggerUnifiSiemAction,
  onReapplyHardening,
}) => {
  const [siemEnv, setSiemEnv] = useState<UnifiSiemEnvConfigDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSiemConfig = useCallback(async () => {
    setLoadError(null);
    try {
      const cfg = await invoke<UnifiSiemEnvConfigDto>('get_unifi_siem_env_config');
      setSiemEnv(cfg);
    } catch (err) {
      setLoadError(String(err));
    }
  }, []);

  useEffect(() => {
    void loadSiemConfig();
  }, [loadSiemConfig]);

  const siemContainer = containers.find((c) =>
    (c.Names || c.ID || '').toLowerCase().includes('unifi-siem')
  );

  const allowedSourcesDisplay =
    siemEnv?.allowedIps?.trim() ||
    siemEnv?.suggestedIps ||
    '172.25.25.1,10.10.1.1,10.10.1.2';

  return (
    <div
      id="unifi-siem-settings-card"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Server className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              UniFi SIEM Collector (unifi-siem on WSH)
            </h3>
            <StatusBadge
              label={
                siemContainer
                  ? siemContainer.State?.toLowerCase() === 'running'
                    ? 'Container: Running'
                    : `Container: ${siemContainer.State || 'Stopped'}`
                  : 'Container: Not Deployed'
              }
              variant={
                siemContainer?.State?.toLowerCase() === 'running'
                  ? 'success'
                  : siemContainer
                  ? 'warning'
                  : 'neutral'
              }
            />
            <StatusBadge
              label={siemEnv?.exists ? 'Config: Preconfigured' : 'Config: Pending File'}
              variant={siemEnv?.exists ? 'success' : 'warning'}
            />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Ingests UniFi CyberSecure IPS/IDS and firewall CEF syslog via file-configured source allowlist (read-only).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadSiemConfig()}
          className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
          title="Reload file-based SIEM configuration status"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reload</span>
        </button>
      </div>

      {/* Read-Only Preconfigured Specification Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-0.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Bind Target</div>
          <div className="text-slate-800 dark:text-slate-200 font-semibold">
            172.25.25.5:5514/udp
          </div>
          <div className="text-[11px] text-slate-500">unifi-siem-net (100.64.251.0/24)</div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-0.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Allowed Sources (.env.siem / config.json)
          </div>
          <div className="text-slate-800 dark:text-slate-200 font-semibold break-all">
            {allowedSourcesDisplay}
          </div>
          <div className="text-[11px] text-slate-500">Locked in DOCKER-USER &amp; collector</div>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-0.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Host Output Log</div>
          <div className="text-slate-800 dark:text-slate-200 font-semibold truncate">
            /var/data/unifi-siem/unifi-siem.log
          </div>
          <div className="text-[11px] text-slate-500">10 MB × 5 rotating NDJSON</div>
        </div>
      </div>

      {loadError && (
        <div className="text-xs font-mono px-3 py-2 rounded-xl border bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30">
          Failed reading SIEM file config: {loadError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
        {onTriggerUnifiSiemAction && (
          <>
            <button
              type="button"
              onClick={() => onTriggerUnifiSiemAction('verify_local')}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Run local TypeScript, Vitest, compose hardening, and ARM64 Docker BuildKit check (zero SSH)"
            >
              <Terminal className="w-3.5 h-3.5 text-[var(--color-accent-text)]" />
              <span>Verify Local</span>
            </button>
            <button
              type="button"
              onClick={() => onTriggerUnifiSiemAction('test')}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Run SSH dry-run preflight against WSH"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Dry-Run (-Test)</span>
            </button>
            <button
              type="button"
              onClick={() => onTriggerUnifiSiemAction('status')}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Query unifi-siem container and recent log lines on WSH"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Status</span>
            </button>
          </>
        )}

        {onReapplyHardening && (
          <button
            type="button"
            onClick={onReapplyHardening}
            className="btn-tonal text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
            title="Run deploy-server-setup.ps1 to synchronize panorama-firewall.sh UDP 5514 source lock"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Re-Apply WSH Firewall</span>
          </button>
        )}

        {onTriggerUnifiSiemAction && (
          <>
            <button
              type="button"
              onClick={() => onTriggerUnifiSiemAction('deploy')}
              disabled={!siemEnv?.exists}
              className="btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50"
              title={
                siemEnv?.exists
                  ? 'Build ARM64 image and deploy hardened unifi-siem container to WSH'
                  : 'Ensure .env.siem or config.json defaultAllowedIps is configured'
              }
            >
              <Play className="w-3.5 h-3.5" />
              <span>Deploy Collector</span>
            </button>

            {siemContainer && (
              <button
                type="button"
                onClick={() => onTriggerUnifiSiemAction('stop')}
                className="btn-danger text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop Collector</span>
              </button>
            )}
          </>
        )}
      </div>

      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-1">
        <div>
          UniFi prerequisites:{' '}
          <span className="text-slate-800 dark:text-slate-200">
            Policy Engine → Zones: Allow CloudKey (10.10.1.2) → 172.25.25.5 UDP 5514 (Auto Allow Return Traffic: OFF)
          </span>{' '}
          •{' '}
          <span className="text-slate-800 dark:text-slate-200">
            CyberSecure → Traffic Logging → SIEM Server: 172.25.25.5:5514
          </span>
        </div>
      </div>
    </div>
  );
};
