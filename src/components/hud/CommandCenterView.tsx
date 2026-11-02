import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DiscoveredApp, ApplianceStatus, SslFleetSummary } from '../../lib/types';
import { FleetAppCard } from './FleetAppCard';
import { ApplianceStatusStrip } from './ApplianceStatusStrip';
import { ReleaseCompositionDrawer } from './ReleaseCompositionDrawer';

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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Home Lab Appliances Status Banner */}
      <ApplianceStatusStrip appliances={appliances} sslFleet={sslFleet} />

      {/* Fleet Overview Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Panorama Suite Applications
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time Git provenance drift, container health, and release orchestration
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400">
            {apps.length} Applications Registered
          </span>
        </div>
      </div>

      {/* Loading Skeleton or Cards Grid */}
      {isLoading && apps.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

      {/* Release Composition Drawer */}
      <ReleaseCompositionDrawer
        app={selectedApp}
        isOpen={selectedApp !== null}
        onClose={() => setSelectedApp(null)}
      />
    </div>
  );
}
