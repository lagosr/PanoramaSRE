import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DiscoveredApp, ApplianceStatus, SslFleetSummary } from '../../lib/types';
import { FleetAppCard } from './FleetAppCard';
import { ApplianceStatusStrip } from './ApplianceStatusStrip';
import { ReleaseCompositionDrawer } from './ReleaseCompositionDrawer';
import { ShieldAlert } from 'lucide-react';

interface CommandCenterViewProps {
  apps: DiscoveredApp[];
  appliances: ApplianceStatus[];
  sslFleet?: SslFleetSummary | null;
  isLoading: boolean;
}

export function CommandCenterView({ apps, appliances, sslFleet, isLoading }: CommandCenterViewProps) {
  const [selectedApp, setSelectedApp] = useState<DiscoveredApp | null>(null);

  const handleOpenApp = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  const handleInspectComposition = (app: DiscoveredApp) => {
    setSelectedApp(app);
  };

  const unhealthyApps = apps.filter(
    (a) => a.health?.status !== 'healthy' || a.provenanceState === 'PROD_UNREACHABLE'
  );

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full min-w-0 space-y-6 overflow-hidden">
      {/* Home Lab Appliances Status Banner */}
      <ApplianceStatusStrip appliances={appliances} sslFleet={sslFleet} />

      {/* Critical Fleet Alert Banner (Red Flag) */}
      {unhealthyApps.length > 0 && (
        <div className="rounded-xl border border-rose-500/80 bg-rose-950/40 p-4 sm:p-5 shadow-[0_0_25px_rgba(244,63,94,0.3)] ring-1 ring-rose-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-pulse">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-200 tracking-wide">
                CRITICAL FLEET INCIDENT DETECTED
              </h3>
              <p className="text-xs text-rose-300/90 mt-0.5">
                {unhealthyApps.length} application{unhealthyApps.length > 1 ? 's are' : ' is'} reporting unhealthy or unreachable in production:{' '}
                <span className="font-semibold text-white">
                  {unhealthyApps.map((a) => a.manifest.displayName).join(', ')}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {unhealthyApps.map((a) => (
              <button
                key={a.manifest.slug}
                onClick={() => setSelectedApp(a)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all whitespace-nowrap"
              >
                Inspect {a.manifest.displayName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fleet Overview Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            Panorama Suite Applications
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time Git provenance drift, container health, and release orchestration
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-mono text-slate-400">
            {apps.length} Applications Registered
          </span>
        </div>
      </div>

      {/* Loading Skeleton or Cards Grid */}
      {isLoading && apps.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 w-full min-w-0">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 w-full min-w-0">
          {apps.map((app) => (
            <FleetAppCard
              key={app.manifest.slug}
              app={app}
              onOpenApp={handleOpenApp}
              onInspectComposition={handleInspectComposition}
            />
          ))}
        </div>
      )}

      {/* Release Composition Inspector Drawer */}
      <ReleaseCompositionDrawer
        app={selectedApp}
        isOpen={!!selectedApp}
        onClose={() => setSelectedApp(null)}
      />
    </div>
  );
}
