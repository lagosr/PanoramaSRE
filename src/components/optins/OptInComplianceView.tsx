import React, { useMemo, useState } from 'react';
import { formatPhone } from '@lagosr/panorama-ui-kit';
import { OptInComplianceSnapshot, ParakithOptInRecord } from '../../lib/types';
import { CustomSelect } from '../ui/CustomSelect';
import { ConfirmDangerModal } from '../ui/ConfirmDangerModal';
import {
  formatLocalDateTime,
  formatRelativeTime,
  parseUtcDate,
} from '../../lib/formatters';
import {
  MessageSquare,
  RefreshCw,
  Download,
  FileJson,
  Search,
  CheckCircle2,
  XCircle,
  Eye,
  Trash2,
  Copy,
  Check,
  X,
  Database,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';

interface OptInComplianceViewProps {
  snapshot: OptInComplianceSnapshot | null;
  isSyncing: boolean;
  workspacePath?: string;
  d1DatabaseId?: string;
  onSyncNow: () => void;
  onExport: (records: ParakithOptInRecord[], format: 'csv' | 'json') => void;
  onDeleteRecord: (recordId: number) => Promise<void>;
}

export const OptInComplianceView: React.FC<OptInComplianceViewProps> = ({
  snapshot,
  isSyncing,
  workspacePath,
  d1DatabaseId = '3837dd0d-c331-4ae5-96c5-3b9759b0ed26',
  onSyncNow,
  onExport,
  onDeleteRecord,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [consentFilter, setConsentFilter] = useState<string>('all');
  const [timeframeFilter, setTimeframeFilter] = useState<string>('all');
  const [inspectedRecord, setInspectedRecord] = useState<ParakithOptInRecord | null>(null);
  const [pendingDeleteRecord, setPendingDeleteRecord] = useState<ParakithOptInRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedProof, setCopiedProof] = useState(false);

  const records = snapshot?.records ?? [];

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const digitsQuery = searchQuery.replace(/\D/g, '');
    const nowMs = Date.now();
    const cutoffDays = timeframeFilter === '7d' ? 7 : timeframeFilter === '30d' ? 30 : null;
    const cutoffMs = cutoffDays ? nowMs - cutoffDays * 24 * 60 * 60 * 1000 : null;

    return records.filter((rec) => {
      if (consentFilter === 'yes' && rec.consent !== 'yes') return false;
      if (consentFilter === 'no' && rec.consent !== 'no') return false;

      if (cutoffMs !== null) {
        const dt = parseUtcDate(rec.createdAt);
        if (!dt || dt.getTime() < cutoffMs) return false;
      }

      if (q) {
        const fullName = `${rec.firstName} ${rec.lastName}`.toLowerCase();
        const phoneDigits = rec.phone.replace(/\D/g, '');
        const formattedPhone = formatPhone(rec.phone).toLowerCase();
        const matchesNameOrIp =
          fullName.includes(q) ||
          rec.phone.toLowerCase().includes(q) ||
          formattedPhone.includes(q) ||
          rec.ipAddress.toLowerCase().includes(q);
        const matchesDigits = digitsQuery.length > 0 && phoneDigits.includes(digitsQuery);
        if (!matchesNameOrIp && !matchesDigits) return false;
      }

      return true;
    });
  }, [records, searchQuery, consentFilter, timeframeFilter]);

  const handleCopyProofJson = async () => {
    if (!inspectedRecord) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(inspectedRecord, null, 2));
      setCopiedProof(true);
      setTimeout(() => setCopiedProof(false), 1800);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteRecord || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteRecord(pendingDeleteRecord.id);
      if (inspectedRecord?.id === pendingDeleteRecord.id) {
        setInspectedRecord(null);
      }
      setPendingDeleteRecord(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-6 w-full min-w-0 max-w-[1920px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 tracking-tight">
            <MessageSquare className="w-5 h-5 text-[var(--color-brand-text)] shrink-0" />
            <span>Parakith SMS Opt-In Compliance Ledger</span>
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Cloudflare D1 carrier evidentiary records ({snapshot?.databaseName || 'parakith-opt-ins'} • WNAM)
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
          <button
            type="button"
            onClick={onSyncNow}
            disabled={isSyncing || !workspacePath}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing D1...' : 'Sync D1 Now'}</span>
          </button>

          <button
            type="button"
            onClick={() => onExport(filteredRecords, 'csv')}
            disabled={filteredRecords.length === 0}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-[var(--color-accent-text)]" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => onExport(filteredRecords, 'json')}
            disabled={filteredRecords.length === 0}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <FileJson className="w-3.5 h-3.5 text-amber-500" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Sync Error Alert */}
      {snapshot?.syncError && (
        <div className="rounded-2xl border border-rose-500/40 bg-white dark:bg-slate-900 p-4 shadow-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
              Remote D1 Synchronization Warning
            </h3>
            <p className="text-xs font-mono text-slate-700 dark:text-slate-300 mt-1 break-words">
              {snapshot.syncError}
            </p>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 tabular-nums">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Total Records
          </span>
          <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1 block">
            {snapshot?.totalCount ?? 0}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Active Opt-Ins
          </span>
          <span className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1 block">
            {snapshot?.consentedCount ?? 0}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Declined (no)
          </span>
          <span className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-1 block">
            {snapshot?.declinedCount ?? 0}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Last 7 Days
          </span>
          <span className="text-2xl font-bold font-mono text-[var(--color-accent-text)] mt-1 block">
            {snapshot?.last7dCount ?? 0}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            D1 Binding (WNAM)
          </span>
          <div className="flex items-center gap-1.5 mt-1.5">
            <Database className="w-4 h-4 text-[var(--color-brand-text)] shrink-0" />
            <span className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 truncate" title={d1DatabaseId}>
              {snapshot?.databaseName || 'parakith-opt-ins'}
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 truncate block mt-0.5">
            {d1DatabaseId.slice(0, 8)}...
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Last Synced
          </span>
          <span className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-1 block truncate">
            {formatRelativeTime(snapshot?.lastSyncedAt)}
          </span>
          <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 truncate block mt-0.5">
            {snapshot?.lastSyncedAt ? formatLocalDateTime(snapshot.lastSyncedAt) : 'Cached locally'}
          </span>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search subscriber name, phone digits, or IP address..."
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[var(--color-brand)]"
          />
        </div>

        <div className="flex flex-wrap sm:flex-nowrap gap-3 items-center">
          <div className="w-48">
            <CustomSelect
              value={consentFilter}
              onChange={setConsentFilter}
              options={[
                { value: 'all', label: 'All Consent States' },
                { value: 'yes', label: 'Consented (yes)' },
                { value: 'no', label: 'Declined (no)' },
              ]}
            />
          </div>

          <div className="w-44">
            <CustomSelect
              value={timeframeFilter}
              onChange={setTimeframeFilter}
              options={[
                { value: 'all', label: 'All Time' },
                { value: '7d', label: 'Last 7 Days' },
                { value: '30d', label: 'Last 30 Days' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Evidentiary Records Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">ID</th>
                <th className="py-3 px-4">Subscriber</th>
                <th className="py-3 px-4">Phone</th>
                <th className="py-3 px-4">Consent</th>
                <th className="py-3 px-4">Source IP</th>
                <th className="py-3 px-4">Recorded At (Local)</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 px-4 text-center text-slate-500 dark:text-slate-400">
                    {records.length === 0
                      ? 'No cached opt-in submissions yet. Click "Sync D1 Now" to pull live Cloudflare D1 records.'
                      : 'No opt-in records match your active search or filters.'}
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => (
                  <tr
                    key={rec.id}
                    onClick={() => setInspectedRecord(rec)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono font-semibold text-slate-600 dark:text-slate-300">
                      #{rec.id}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {rec.firstName} {rec.lastName}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatPhone(rec.phone) || rec.phone}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {rec.consent === 'yes' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" />
                          YES
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          <XCircle className="w-3 h-3" />
                          NO
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {rec.ipAddress}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {formatLocalDateTime(rec.createdAt)}
                    </td>
                    <td
                      className="py-3 px-4 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => setInspectedRecord(rec)}
                          className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors inline-flex items-center gap-1 whitespace-nowrap flex-shrink-0 cursor-pointer"
                          title="Inspect Twilio carrier proof-of-consent"
                        >
                          <Eye className="w-3 h-3 text-emerald-500" />
                          <span>Inspect Proof</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteRecord(rec)}
                          disabled={!workspacePath}
                          className="p-1.5 rounded-md bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40 text-rose-600 dark:text-rose-400 border border-rose-500/30 transition-colors flex-shrink-0 cursor-pointer"
                          title="Delete synthetic/test record from remote D1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proof-of-Consent Inspector Slide-Over Drawer (100% solid opaque surface) */}
      {inspectedRecord && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/80 backdrop-blur-sm"
          onClick={() => setInspectedRecord(null)}
        >
          <div
            className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    Carrier Proof of Consent • Record #{inspectedRecord.id}
                  </h3>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                    Twilio 10DLC Audit Trail ({inspectedRecord.consent === 'yes' ? 'OPTED IN' : 'DECLINED'})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInspectedRecord(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                    Subscriber Name
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5 block">
                    {inspectedRecord.firstName} {inspectedRecord.lastName}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                    Phone Number
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 mt-0.5 block">
                    {formatPhone(inspectedRecord.phone) || inspectedRecord.phone}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                    Recorded Timestamp (Local)
                  </span>
                  <span className="font-mono text-slate-900 dark:text-slate-100 mt-0.5 block">
                    {formatLocalDateTime(inspectedRecord.createdAt)}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                    Recorded Timestamp (UTC Raw)
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 mt-0.5 block break-all">
                    {inspectedRecord.createdAt}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 sm:col-span-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                    Client IP Address
                  </span>
                  <span className="font-mono text-slate-900 dark:text-slate-100 mt-0.5 block">
                    {inspectedRecord.ipAddress}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 sm:col-span-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                    User-Agent String
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 mt-0.5 block break-all">
                    {inspectedRecord.userAgent}
                  </span>
                </div>
              </div>

              {/* Material 3 Adaptive JSON Evidentiary Payload */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Carrier Dispute JSON Payload
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyProofJson}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer"
                  >
                    {copiedProof ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span>Copied Proof</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Proof JSON</span>
                      </>
                    )}
                  </button>
                </div>

                <pre className="rounded-xl p-4 bg-slate-50 border border-slate-200/90 text-emerald-900 dark:bg-[#050b14] dark:border-slate-800 dark:text-emerald-400 font-mono text-xs overflow-x-auto shadow-inner">
                  {JSON.stringify(inspectedRecord, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Typed Confirmation Modal for Synthetic / Test Record Removal */}
      <ConfirmDangerModal
        isOpen={!!pendingDeleteRecord}
        title={`Delete Opt-In Record #${pendingDeleteRecord?.id ?? ''}`}
        description={`This permanently deletes D1 row #${pendingDeleteRecord?.id ?? ''} (${pendingDeleteRecord?.firstName ?? ''} ${pendingDeleteRecord?.lastName ?? ''}, ${pendingDeleteRecord?.phone ? formatPhone(pendingDeleteRecord.phone) || pendingDeleteRecord.phone : ''}) from remote Cloudflare D1 (${snapshot?.databaseName || 'parakith-opt-ins'}) and writes an audit event. Only remove synthetic test rows, never genuine customer consent records.`}
        confirmWord="DELETE"
        confirmLabel="Delete From D1"
        onConfirm={handleConfirmDelete}
        onCancel={() => !isDeleting && setPendingDeleteRecord(null)}
        isProcessing={isDeleting}
      />
    </div>
  );
};
