import React, { useState, useEffect, useCallback } from 'react';
import { Sliders, Shield, Terminal, Database, Check, RefreshCw, Info, Trash2, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { CustomSelect } from '../ui/CustomSelect';
import { APP_VERSION_INFO } from '../../lib/version';

interface SystemLogEntry {
  id: number;
  category: string;
  level: string;
  message: string;
  metadata: string | null;
  created_at: string;
}

type SettingsTab = 'general' | 'ssh' | 'logs' | 'database';

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [toastAlerts, setToastAlerts] = useState(true);
  const [pollInterval, setPollInterval] = useState('15');
  const [isSaved, setIsSaved] = useState(false);

  // Application Logs state
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoRefreshLogs, setAutoRefreshLogs] = useState<boolean>(true);

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoadingLogs(true);
      const res = await invoke<SystemLogEntry[]>('get_system_logs', {
        limit: 300,
        category: selectedCategory === 'ALL' ? null : selectedCategory,
      });
      setLogs(res);
    } catch (err) {
      console.warn('Failed to load system logs:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs();
    }
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (activeTab !== 'logs' || !autoRefreshLogs) return;
    const interval = setInterval(() => {
      fetchLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab, autoRefreshLogs, fetchLogs]);

  const handleClearLogs = async () => {
    try {
      await invoke('clear_system_logs');
      setLogs([]);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.message.toLowerCase().includes(q) ||
      log.category.toLowerCase().includes(q) ||
      (log.metadata && log.metadata.toLowerCase().includes(q))
    );
  });

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
          <div className="flex flex-col space-y-3 h-full">
            {/* Log Controls Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                <input
                  type="text"
                  placeholder="Filter logs or parameters..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-0 text-xs text-slate-200 placeholder-slate-500 focus:outline-none w-full"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="w-36">
                  <CustomSelect
                    value={selectedCategory}
                    onChange={setSelectedCategory}
                    options={[
                      { value: 'ALL', label: 'All Categories' },
                      { value: 'SYSTEM', label: 'SYSTEM' },
                      { value: 'DEV_SUPERVISOR', label: 'DEV_SUPERVISOR' },
                      { value: 'RUNNER', label: 'RUNNER' },
                      { value: 'STREAM', label: 'STREAM' },
                      { value: 'DEPLOY', label: 'DEPLOY' },
                      { value: 'BACKUP', label: 'BACKUP' },
                      { value: 'MONITOR', label: 'MONITOR' },
                    ]}
                  />
                </div>

                <button
                  onClick={() => setAutoRefreshLogs(!autoRefreshLogs)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors border ${
                    autoRefreshLogs
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                  title="Toggle 3s live polling"
                >
                  {autoRefreshLogs ? 'Live: ON' : 'Live: PAUSED'}
                </button>

                <button
                  onClick={fetchLogs}
                  disabled={isLoadingLogs}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                  title="Manual Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                </button>

                <button
                  onClick={handleClearLogs}
                  className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 transition-colors"
                  title="Clear All Logs"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Terminal Log Console */}
            <div className="flex-1 bg-[#050b14] border border-slate-800 rounded-xl p-4 font-mono text-xs overflow-y-auto min-h-[420px] max-h-[600px] space-y-1">
              {filteredLogs.length === 0 ? (
                <div className="text-slate-600 italic py-8 text-center">
                  No log entries found. Perform actions or run commands to stream logs.
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isWarn = log.level === 'WARN';
                  const isError = log.level === 'ERROR';
                  return (
                    <div key={log.id} className="leading-relaxed hover:bg-slate-900/40 px-1 rounded flex items-start gap-2">
                      <span className="text-slate-500 shrink-0 text-[11px] select-none">
                        [{log.created_at.slice(11, 19)}]
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-bold shrink-0 ${
                          isError
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : isWarn
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {log.category}
                      </span>
                      <span
                        className={`break-all ${
                          isError
                            ? 'text-rose-400 font-medium'
                            : isWarn
                            ? 'text-amber-300'
                            : 'text-emerald-300 selection:bg-emerald-500/30 selection:text-emerald-200'
                        }`}
                      >
                        {log.message}
                        {log.metadata && (
                          <span className="text-slate-500 text-[11px] ml-2 font-mono">
                            ({log.metadata})
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
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
