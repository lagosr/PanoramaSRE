import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Waypoints, Network, Shield, ShieldAlert, RefreshCw } from 'lucide-react';
import {
  LanClientBaselineRow,
  UnifiTopologySnapshotDto,
} from '../../lib/types';
import { buildUnifiConsoleUrl } from '../../lib/threat-utils';
import { UnifiVlanZbfPanel } from '../security/UnifiVlanZbfPanel';

interface UnifiNetworkZbfViewProps {
  unifiBaseUrl?: string;
  onNavigateToTopology?: () => void;
  onNavigateToHardening?: () => void;
  onNavigateToSecurity?: () => void;
}

export const UnifiNetworkZbfView: React.FC<UnifiNetworkZbfViewProps> = ({
  unifiBaseUrl = 'https://ui.panoramadr.com',
  onNavigateToTopology,
  onNavigateToHardening,
  onNavigateToSecurity,
}) => {
  const [topology, setTopology] = useState<UnifiTopologySnapshotDto | null>(null);
  const [lanClients, setLanClients] = useState<LanClientBaselineRow[]>([]);
  const [selectedVlanFilter, setSelectedVlanFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const loadUnifiData = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const [snap, lan] = await Promise.all([
        invoke<UnifiTopologySnapshotDto | null>('get_unifi_network_topology', {
          forceRefresh,
        }),
        invoke<LanClientBaselineRow[]>('get_lan_clients_baseline').catch(() => []),
      ]);
      setTopology(snap ?? null);
      if (Array.isArray(lan)) {
        setLanClients(lan);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUnifiData(false);
  }, [loadUnifiData]);

  const handleToggleLanTrust = async (client: LanClientBaselineRow, trusted: boolean) => {
    try {
      await invoke('set_lan_client_trusted', {
        macAddress: client.macAddress,
        trusted,
        label: client.label || client.hostname || null,
      });
      const updatedLan = await invoke<LanClientBaselineRow[]>('get_lan_clients_baseline').catch(
        () => null
      );
      if (Array.isArray(updatedLan)) {
        setLanClients(updatedLan);
      }
      setFeedback({
        text: `${trusted ? 'Trusted' : 'Unverified'} ${client.label || client.hostname || client.macAddress}.`,
        tone: 'ok',
      });
      setTimeout(() => setFeedback(null), 3500);
    } catch (err) {
      setFeedback({
        text: `Failed updating device trust: ${String(err)}`,
        tone: 'err',
      });
    }
  };

  const handleOpenExternal = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="p-6 max-w-[1920px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Waypoints className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              UniFi Network &amp; Zone-Based Firewall (ZBF)
            </h1>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Interactive UniFi Zone Flow Explorer, ZBF segmentation matrix, VLAN directory, custom firewall policies, and owner-verified LAN device baseline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadUnifiData(true)}
            disabled={isLoading}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Sync UniFi Topology</span>
          </button>
          {onNavigateToTopology && (
            <button
              type="button"
              onClick={onNavigateToTopology}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <Network className="w-3.5 h-3.5" />
              <span>WSH Boundary Map →</span>
            </button>
          )}
          {onNavigateToHardening && (
            <button
              type="button"
              onClick={onNavigateToHardening}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>WSH Hardening →</span>
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

      {feedback && (
        <div
          className={`px-3.5 py-2 rounded-xl border text-xs font-mono ${
            feedback.tone === 'ok'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <UnifiVlanZbfPanel
        topology={topology}
        isLoading={isLoading}
        error={error}
        selectedVlanFilter={selectedVlanFilter}
        onSelectVlanFilter={setSelectedVlanFilter}
        onRefresh={() => void loadUnifiData(true)}
        onOpenUnifiFirewall={() =>
          void handleOpenExternal(buildUnifiConsoleUrl(unifiBaseUrl, 'policies'))
        }
        lanClients={lanClients}
        onToggleLanTrust={(cli, trusted) => void handleToggleLanTrust(cli, trusted)}
      />
    </div>
  );
};
