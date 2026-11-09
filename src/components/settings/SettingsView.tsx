import React, { useState, useEffect, useCallback } from 'react';
import { Sliders, Shield, Terminal, Database, Check, RefreshCw, Info, Trash2, Search, Sun, Moon, Laptop, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { CustomSelect } from '../ui/CustomSelect';
import { APP_VERSION_INFO } from '../../lib/version';
import { useTheme } from '../../context/ThemeContext';

interface SettingsViewProps {
  onWorkspaceChanged?: () => void;
  securityAuditInterval?: string;
  onSecurityAuditIntervalChanged?: (interval: string) => void;
}

interface SystemLogEntry {
  id: number;
  category: string;
  level: string;
  message: string;
  metadata: string | null;
  created_at: string;
}

type SettingsTab = 'general' | 'ssh' | 'logs' | 'database';

export const SettingsView: React.FC<SettingsViewProps> = ({
  onWorkspaceChanged,
  securityAuditInterval: propSecurityAuditInterval,
  onSecurityAuditIntervalChanged,
}) => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [toastAlerts, setToastAlerts] = useState(true);
  const [pollInterval, setPollInterval] = useState('15');
  const [securityAuditInterval, setSecurityAuditInterval] = useState<string>(() => {
    return propSecurityAuditInterval || localStorage.getItem('panoramasre_security_audit_interval') || '5';
  });
  const [isSaved, setIsSaved] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);

  // Load configured workspace directory on mount
  useEffect(() => {
    (async () => {
      try {
        const root = await invoke<string>('get_workspace_setting');
        if (root) {
          setWorkspaceRoot(root);
        }
      } catch (err) {
        console.warn('Failed to load workspace setting:', err);
      }
    })();
  }, []);

  const handleSelectWorkspaceFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select Panorama Suite Repositories Directory (e.g. AG Projects)',
        defaultPath: workspaceRoot || undefined,
      });

      if (selected && typeof selected === 'string') {
        setWorkspaceRoot(selected);
        const resolved = await invoke<string>('save_workspace_setting', {
          workspaceRoot: selected,
        });
        setWorkspaceRoot(resolved);
        setWorkspaceFeedback('Workspace directory updated');
        setTimeout(() => setWorkspaceFeedback(null), 3000);
        if (onWorkspaceChanged) {
          onWorkspaceChanged();
        }
      }
    } catch (err) {
      console.error('Failed to select workspace folder:', err);
    }
  };

  const handleSaveWorkspaceRoot = async () => {
    try {
      const resolved = await invoke<string>('save_workspace_setting', {
        workspaceRoot: workspaceRoot,
      });
      setWorkspaceRoot(resolved);
      setWorkspaceFeedback('Workspace directory saved');
      setTimeout(() => setWorkspaceFeedback(null), 3000);
      if (onWorkspaceChanged) {
        onWorkspaceChanged();
      }
    } catch (err) {
      setWorkspaceFeedback(`Error: ${String(err)}`);
      setTimeout(() => setWorkspaceFeedback(null), 4000);
    }
  };

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
    localStorage.setItem('panoramasre_security_audit_interval', securityAuditInterval);
    if (onSecurityAuditIntervalChanged) {
      onSecurityAuditIntervalChanged(securityAuditInterval);
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-[#050b14] overflow-hidden">
      {/* View Header */}
      <div className="h-14 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between bg-white dark:bg-transparent">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Settings & SRE Governance</h2>
        <button
          onClick={handleSave}
          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium"
        >
          {isSaved ? <Check className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>{isSaved ? 'Saved!' : 'Save Changes'}</span>
        </button>
      </div>

      {/* 4-Tab Bar */}
      <div className="border-b border-slate-200 dark:border-slate-800 px-6 flex space-x-6 bg-white dark:bg-transparent">
        <button
          onClick={() => setActiveTab('general')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'general' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>General & System Tray</span>
        </button>
        <button
          onClick={() => setActiveTab('ssh')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'ssh' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>SSH & Secrets</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'logs' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Application Logs</span>
        </button>
        <button
          onClick={() => setActiveTab('database')}
          className={`py-3 text-sm font-medium border-b-2 flex items-center space-x-2 transition-colors ${
            activeTab === 'database' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
            {/* Appearance & Color Scheme Preference */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Appearance & Theme Preference</h3>
                  <p className="text-xs text-slate-500">Select your preferred user theme. Synchronized across PanoramaDrSuite.</p>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 uppercase">
                  Active: {resolvedTheme}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all cursor-pointer ${
                    theme === 'dark'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/50'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <Moon className="w-5 h-5" />
                  <span className="text-xs font-medium">Dark Mode</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all cursor-pointer ${
                    theme === 'light'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/50'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <Sun className="w-5 h-5" />
                  <span className="text-xs font-medium">Light Mode</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTheme('system')}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all cursor-pointer ${
                    theme === 'system'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/50'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <Laptop className="w-5 h-5" />
                  <span className="text-xs font-medium">System Sync</span>
                </button>
              </div>
            </div>

            {/* Suite Repositories & Workspace Directory Configuration */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Suite Repositories Workspace</h3>
                  <p className="text-xs text-slate-500">Root folder containing child application repositories with panorama.app.json manifests.</p>
                </div>
                {workspaceFeedback && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    {workspaceFeedback}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={workspaceRoot}
                    onChange={(e) => setWorkspaceRoot(e.target.value)}
                    placeholder="e.g. C:\Users\<Username>\Documents\AG Projects"
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleSelectWorkspaceFolder}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Browse for folder"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Browse...</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveWorkspaceRoot}
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
                  Default search path: <span className="text-slate-600 dark:text-slate-400">%USERPROFILE%\Documents\AG Projects</span>
                </p>
              </div>
            </div>

            {/* Version & Build Provenance Card */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">PanoramaSRE Build Provenance</h3>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                  {APP_VERSION_INFO.fullVersionString}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 font-mono text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Semantic Version:</span>
                  <span className="text-slate-800 dark:text-slate-300 font-semibold">{APP_VERSION_INFO.version}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Git Commit SHA:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{APP_VERSION_INFO.buildHash}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Build Timestamp:</span>
                  <span className="text-slate-800 dark:text-slate-300">{APP_VERSION_INFO.buildDate || 'Local Dev'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Build Identifier:</span>
                  <span className="text-slate-800 dark:text-slate-300">{APP_VERSION_INFO.buildNumber}</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">System Tray & Window Lifecycle</h3>
              
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm text-slate-800 dark:text-slate-300">Minimize to System Tray on Close (X)</div>
                  <div className="text-xs text-slate-500">Keeps background telemetry scheduler and local dev servers active.</div>
                </div>
                <input
                  type="checkbox"
                  checked={minimizeToTray}
                  onChange={(e) => setMinimizeToTray(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm text-slate-800 dark:text-slate-300">Windows 11 Toast Notifications</div>
                  <div className="text-xs text-slate-500">Edge-triggered alerts on app outage, 75°C thermals, or SSL expiry.</div>
                </div>
                <input
                  type="checkbox"
                  checked={toastAlerts}
                  onChange={(e) => setToastAlerts(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700"
                />
              </label>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">Telemetry & Polling Intervals</h3>
              
              <div>
                <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1.5">Tier 1 Polling Interval</label>
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

              <div>
                <label className="block text-xs font-mono text-slate-600 dark:text-slate-400 mb-1.5">
                  WSH Security Hardening & Penetration Audit Interval
                </label>
                <CustomSelect
                  value={securityAuditInterval}
                  onChange={(val) => {
                    setSecurityAuditInterval(val);
                    localStorage.setItem('panoramasre_security_audit_interval', val);
                    if (onSecurityAuditIntervalChanged) {
                      onSecurityAuditIntervalChanged(val);
                    }
                  }}
                  options={[
                    { value: '1', label: '1 minute (High Frequency / Verification)' },
                    { value: '3', label: '3 minutes' },
                    { value: '5', label: '5 minutes (Recommended Default)' },
                    { value: '10', label: '10 minutes' },
                    { value: '15', label: '15 minutes' },
                    { value: '30', label: '30 minutes (Low Resource)' },
                  ]}
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 font-mono">
                  Periodic automated verification of Docker network isolation, firewall rules, and container defense-in-depth invariants.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ssh' && (
          <div className="max-w-2xl space-y-4">
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 font-mono text-xs shadow-sm">
              <div className="text-slate-600 dark:text-slate-400 font-semibold mb-2">TARGET HOST CONNECTION</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">Host:</span> wsh.panoramadr.com</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">User:</span> root</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">Key:</span> C:\Users\rodrigo\.ssh\rsa-key-deployment</div>
              <div className="text-slate-800 dark:text-slate-300"><span className="text-slate-500">Key Type:</span> OpenSSH Private Key (RSA)</div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="flex flex-col space-y-3 h-full">
            {/* Log Controls Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Filter logs or parameters..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-0 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none w-full"
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
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                  }`}
                  title="Toggle 3s live polling"
                >
                  {autoRefreshLogs ? 'Live: ON' : 'Live: PAUSED'}
                </button>

                <button
                  onClick={fetchLogs}
                  disabled={isLoadingLogs}
                  className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Manual Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                </button>

                <button
                  onClick={handleClearLogs}
                  className="p-1.5 rounded-lg text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 transition-colors"
                  title="Clear All Logs"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Terminal Log Console */}
            <div className="flex-1 bg-slate-50 dark:bg-[#050b14] border border-slate-200 dark:border-slate-800 rounded-xl p-4 font-mono text-xs overflow-y-auto min-h-[420px] max-h-[600px] space-y-1 select-text">
              {filteredLogs.length === 0 ? (
                <div className="text-slate-500 dark:text-slate-600 italic py-8 text-center">
                  No log entries found. Perform actions or run commands to stream logs.
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isWarn = log.level === 'WARN';
                  const isError = log.level === 'ERROR';
                  return (
                    <div key={log.id} className="leading-relaxed hover:bg-slate-200/50 dark:hover:bg-slate-900/40 px-1 rounded flex items-start gap-2">
                      <span className="text-slate-500 dark:text-slate-500 shrink-0 text-[11px] select-none font-mono">
                        [{log.created_at.slice(11, 19)}]
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-bold shrink-0 font-mono ${
                          isError
                            ? 'bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                            : isWarn
                            ? 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/10 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {log.category}
                      </span>
                      <span
                        className={`break-all ${
                          isError
                            ? 'text-rose-700 dark:text-rose-400 font-medium'
                            : isWarn
                            ? 'text-amber-800 dark:text-amber-300 font-medium'
                            : 'text-slate-800 dark:text-emerald-300 selection:bg-emerald-500/20 dark:selection:bg-emerald-500/30 selection:text-emerald-900 dark:selection:text-emerald-200'
                        }`}
                      >
                        {log.message}
                        {log.metadata && (
                          <span className="text-slate-500 dark:text-slate-400 text-[11px] ml-2 font-mono">
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
          <div className="max-w-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">Local SQLite Telemetry Storage</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">Stores audit logs, system telemetry, and command run history locally in WAL mode.</p>
            <div className="text-xs font-mono text-slate-500">Database file: data/sre.sqlite (WAL enabled)</div>
          </div>
        )}
      </div>
    </div>
  );
};
