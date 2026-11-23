import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Play,
  RefreshCw,
  Save,
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
  const [siemAllowedIpsInput, setSiemAllowedIpsInput] = useState<string>('');
  const [isSavingSiemEnv, setIsSavingSiemEnv] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const loadSiemConfig = useCallback(async () => {
    try {
      const cfg = await invoke<UnifiSiemEnvConfigDto>('get_unifi_siem_env_config');
      setSiemEnv(cfg);
      setSiemAllowedIpsInput(cfg.allowedIps || '');
    } catch (err) {
      setFeedback({ text: `Failed loading .env.siem: ${String(err)}`, tone: 'err' });
    }
  }, []);

  useEffect(() => {
    void loadSiemConfig();
  }, [loadSiemConfig]);

  const siemContainer = containers.find((c) =>
    (c.Names || c.ID || '').toLowerCase().includes('unifi-siem')
  );

  const handleSaveSiemEnv = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSiemEnv(true);
    setFeedback(null);
    try {
      const updated = await invoke<UnifiSiemEnvConfigDto>('save_unifi_siem_env_config', {
        allowedIps: siemAllowedIpsInput,
      });
      setSiemEnv(updated);
      setSiemAllowedIpsInput(updated.allowedIps);
      setFeedback({
        text: `Saved .env.siem UNIFI_SIEM_ALLOWED_IPS=${updated.allowedIps}`,
        tone: 'ok',
      });
      setTimeout(() => setFeedback(null), 4500);
    } catch (err) {
      setFeedback({ text: `Save .env.siem failed: ${String(err)}`, tone: 'err' });
    } finally {
      setIsSavingSiemEnv(false);
    }
  };

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
              Optional UniFi SIEM Collector (unifi-siem on WSH)
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
              label={siemEnv?.exists ? '.env.siem: Ready' : '.env.siem: Not Configured'}
              variant={siemEnv?.exists ? 'success' : 'warning'}
            />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Receives UniFi CyberSecure IPS/IDS and firewall drop CEF syslog packets on WSH{' '}
            <code className="font-mono">172.25.25.5:5514/udp</code> into{' '}
            <code className="font-mono">/var/data/unifi-siem/unifi-siem.log</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadSiemConfig()}
          className="btn-ghost text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
          title="Reload .env.siem state"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reload</span>
        </button>
      </div>

      <form
        onSubmit={(e) => void handleSaveSiemEnv(e)}
        className="flex flex-col sm:flex-row sm:items-end gap-2.5"
      >
        <div className="flex-1 space-y-1">
          <label className="block text-[11px] font-mono text-slate-600 dark:text-slate-400">
            UNIFI_SIEM_ALLOWED_IPS (Comma-separated IPv4 allowlist enforced in WSH DOCKER-USER &amp; collector)
          </label>
          <input
            type="text"
            value={siemAllowedIpsInput}
            onChange={(e) => setSiemAllowedIpsInput(e.target.value)}
            placeholder={siemEnv?.suggestedIps || '172.25.25.1,10.10.1.1'}
            className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
          />
        </div>
        <button
          type="submit"
          disabled={isSavingSiemEnv || !siemAllowedIpsInput.trim()}
          className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{isSavingSiemEnv ? 'Saving...' : 'Save .env.siem'}</span>
        </button>
      </form>

      {feedback && (
        <div
          className={`text-xs font-mono px-3 py-2 rounded-xl border ${
            feedback.tone === 'ok'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
        {onTriggerUnifiSiemAction && (
          <>
            <button
              type="button"
              onClick={() => onTriggerUnifiSiemAction('verify_local')}
              className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              title="Run local TypeScript, Vitest, compose hardening, and ARM64 Docker BuildKit check (zero SSH)"
            >
              <Terminal className="w-3.5 h-3.5 text-[var(--color-accent-text)]" />
              <span>Verify Local (-VerifyLocal)</span>
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
                  : 'Save UNIFI_SIEM_ALLOWED_IPS into .env.siem first'
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
        <div>UniFi prerequisites after Deploy + Re-Apply WSH Firewall:</div>
        <div>
          1. Policy Engine → Zones: Allow Gateway/CloudKey →{' '}
          <span className="text-slate-800 dark:text-slate-200">172.25.25.5 UDP 5514</span> (
          <span className="text-slate-800 dark:text-slate-200">Auto Allow Return Traffic: OFF</span>)
        </div>
        <div>
          2. CyberSecure → Traffic Logging → Activity Logging (Syslog): Select{' '}
          <span className="text-slate-800 dark:text-slate-200">SIEM Server</span> →{' '}
          <span className="text-slate-800 dark:text-slate-200">172.25.25.5:5514</span>
        </div>
      </div>
    </div>
  );
};
