import React, { useState } from 'react';
import { Sliders, Shield, Terminal, Database, Check, RefreshCw, Info } from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';
import { APP_VERSION_INFO } from '../../lib/version';

type SettingsTab = 'general' | 'ssh' | 'logs' | 'database';

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [toastAlerts, setToastAlerts] = useState(true);
  const [pollInterval, setPollInterval] = useState('15');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#050b14] overflow-hidden">
      {/* View Header */}
      <div className="h-14 border-b border-slate-800 px-6 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">Settings & SRE Governance</h2>
        <button
          onClick={handleSave}
          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium"
        >
          {isSaved ? <Check className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>{isSaved ? 'Saved!' : 'Save Changes'}</span>
        </button>
      </div>

      {/* 4-Tab Bar */}
      <div className="border-b border-slate-800 px-6 flex space-x-6">
        <button
          onClick={() => setActiveTab('general')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'general' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>General & System Tray</span>
        </button>
        <button
          onClick={() => setActiveTab('ssh')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'ssh' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>SSH & Secrets</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'logs' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Application Logs</span>
        </button>
        <button
          onClick={() => setActiveTab('database')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'database' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Database & Cache</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeTab === 'general' && (
          <div className="max-w-2xl space-y-6">
            {/* Version & Build Provenance Card */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-200">PanoramaSRE Build Provenance</h3>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  {APP_VERSION_INFO.fullVersionString}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80 font-mono text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Semantic Version:</span>
                  <span className="text-slate-300 font-semibold">{APP_VERSION_INFO.version}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Git Commit SHA:</span>
                  <span className="text-emerald-400 font-semibold">{APP_VERSION_INFO.buildHash}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Build Timestamp:</span>
                  <span className="text-slate-300">{APP_VERSION_INFO.buildDate || 'Local Dev'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Build Identifier:</span>
                  <span className="text-slate-300">{APP_VERSION_INFO.buildNumber}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">System Tray & Window Lifecycle</h3>
              
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm text-slate-300">Minimize to System Tray on Close (X)</div>
                  <div className="text-xs text-slate-500">Keeps background telemetry scheduler and local dev servers active.</div>
                </div>
                <input
                  type="checkbox"
                  checked={minimizeToTray}
                  onChange={(e) => setMinimizeToTray(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded bg-slate-800 border-slate-700"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm text-slate-300">Windows 11 Toast Notifications</div>
                  <div className="text-xs text-slate-500">Edge-triggered alerts on app outage, 75°C thermals, or SSL expiry.</div>
                </div>
                <input
                  type="checkbox"
                  checked={toastAlerts}
                  onChange={(e) => setToastAlerts(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded bg-slate-800 border-slate-700"
                />
              </label>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Telemetry & Polling Intervals</h3>
              
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">Tier 1 Polling Interval</label>
                <CustomSelect
                  value={pollInterval}
                  onChange={setPollInterval}
                  options={[
                    { value: '5', label: '5 seconds (High Frequency / Debug)' },
                    { value: '15', label: '15 seconds (Recommended Default)' },
                    { value: '30', label: '30 seconds (Low Power)' },
                    { value: '60', label: '60 seconds' },
                  ]}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ssh' && (
          <div className="max-w-2xl space-y-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3 font-mono text-xs">
              <div className="text-slate-400 font-semibold mb-2">TARGET HOST CONNECTION</div>
              <div className="text-slate-300"><span className="text-slate-500">Host:</span> wsh.panoramadr.com</div>
              <div className="text-slate-300"><span className="text-slate-500">User:</span> root</div>
              <div className="text-slate-300"><span className="text-slate-500">Key:</span> D:\Google\My Drive\RSA\rsa-key-deployment.ppk</div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="bg-[#050b14] border border-slate-800 rounded-xl p-4 font-mono text-xs text-emerald-400 h-96 overflow-y-auto">
            <div>[2026-11-01 12:59:00] [PANORAMA_SRE] Control Plane Initialized.</div>
            <div>[2026-11-01 12:59:01] [DISCOVERY] Ingested 6 suite application manifests.</div>
            <div>[2026-11-01 12:59:01] [DISCOVERY] Ingested 5 SRE tool manifests.</div>
            <div>[2026-11-01 12:59:02] [MONITOR] Network Split-DNS: LAN_DIRECT (172.20.20.9).</div>
          </div>
        )}

        {activeTab === 'database' && (
          <div className="max-w-2xl bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">Local SQLite Telemetry Storage</h3>
            <p className="text-xs text-slate-400">Stores audit logs, system telemetry, and command run history locally in WAL mode.</p>
            <div className="text-xs font-mono text-slate-500">Database file: data/sre.sqlite (WAL enabled)</div>
          </div>
        )}
      </div>
    </div>
  );
};
