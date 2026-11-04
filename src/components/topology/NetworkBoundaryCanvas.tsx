import React, { useState } from 'react';
import {
  Globe,
  Server,
  Layers,
  Box,
  HardDrive,
  Radio,
  ShieldCheck,
  Zap,
  ArrowRight,
} from 'lucide-react';
import {
  SynthesizedTopology,
  TopologyRouteItem,
  IngressHop,
} from '../../lib/topology-synthesizer';

interface NetworkBoundaryCanvasProps {
  topology: SynthesizedTopology;
  selectedRouteSlug: string | null;
  onSelectRouteSlug: (slug: string | null) => void;
  onOpenInspector: (route: TopologyRouteItem | null, hop: IngressHop | null) => void;
}

export const NetworkBoundaryCanvas: React.FC<NetworkBoundaryCanvasProps> = ({
  topology,
  selectedRouteSlug,
  onSelectRouteSlug,
  onOpenInspector,
}) => {
  const [hoveredRouteSlug, setHoveredRouteSlug] = useState<string | null>(null);
  const [activeRingLevel, setActiveRingLevel] = useState<number | null>(null);

  const isDimmed = (level: number) => activeRingLevel !== null && activeRingLevel !== level;
  const isActive = (level: number) => activeRingLevel === level;

  const activeSlug = hoveredRouteSlug || selectedRouteSlug || 'auth';
  const activeRoute = topology.routes.find((r) => r.slug === activeSlug) || topology.routes[0];
  const activeTrace = topology.ingressTraces[activeSlug] || [];

  return (
    <div className="space-y-6">
      {/* Route Quick Selector Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mr-1 font-mono">
            <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            Active Target Route:
          </span>
          {topology.routes.map((rt) => {
            const isSelected = activeSlug === rt.slug;
            return (
              <button
                key={rt.slug}
                onClick={() => onSelectRouteSlug(rt.slug === selectedRouteSlug ? null : rt.slug)}
                onMouseEnter={() => setHoveredRouteSlug(rt.slug)}
                onMouseLeave={() => setHoveredRouteSlug(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all duration-200 flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shadow-sm scale-105'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/60'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    rt.isHealthy ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                /{rt.slug}
                <span className="text-[10px] text-slate-400">:{rt.port}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-mono flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Zero-Trust Concentric Ring Defense Model
          </div>
        </div>
      </div>

      {/* Main Concentric Radial Topology Visualizer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Center: Interactive Radial Radar Target Map */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#070e17] p-4 sm:p-6 shadow-md relative overflow-hidden flex flex-col items-center justify-center min-h-[640px]">
          {/* Subtle Ambient Radial Glow */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-500/5 via-sky-500/5 to-transparent pointer-events-none" />

          {/* Concentric Nesting Rings Container with 4-Quadrant Cardinal Stations */}
          <div className="relative w-full max-w-[620px] aspect-square flex items-center justify-center my-4">
            {/* SVG Connecting Flow Spiral (Connecting Ring 0 (Top) -> Ring 1 (Right) -> Ring 2 (Bottom) -> Ring 3 (Left) -> Core (Center)) */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
              viewBox="0 0 600 600"
              fill="none"
            >
              <defs>
                <linearGradient id="spiralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
                  <stop offset="25%" stopColor="#10b981" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#0ea5e9" stopOpacity="0.8" />
                  <stop offset="75%" stopColor="#f59e0b" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="1" />
                </linearGradient>
              </defs>

              {/* Inward Ingress Flow Spiral */}
              <path
                d="M 300 40 
                   C 480 40, 520 180, 520 300 
                   C 520 440, 420 500, 300 500 
                   C 180 500, 140 400, 140 300 
                   C 140 220, 220 220, 260 260
                   L 300 300"
                stroke="url(#spiralGrad)"
                strokeWidth="2.5"
                strokeDasharray="6 6"
                className="animate-[dash_20s_linear_infinite]"
              />

              {/* Waypoint Directional Arrowheads */}
              <circle cx="300" cy="40" r="4" fill="#6366f1" />
              <circle cx="520" cy="300" r="4" fill="#10b981" />
              <circle cx="300" cy="500" r="4" fill="#0ea5e9" />
              <circle cx="140" cy="300" r="4" fill="#f59e0b" />
              <circle cx="300" cy="300" r="5" fill="#10b981" />
            </svg>

            {/* RING 0 (Outermost): Public WAN & Cloudflare Edge */}
            <div
              onMouseEnter={() => setActiveRingLevel(0)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute inset-4 rounded-full border-2 transition-all duration-300 ${
                isActive(0)
                  ? 'border-indigo-500 bg-indigo-500/15 shadow-[0_0_40px_rgba(99,102,241,0.35)] opacity-100 scale-[1.01]'
                  : isDimmed(0)
                  ? 'border-indigo-500/10 bg-transparent opacity-20'
                  : 'border-indigo-500/30 bg-indigo-500/[0.02] hover:border-indigo-500/60 opacity-100'
              }`}
            />

            {/* RING 0 CARDINAL STATION: TOP (12 o'clock) */}
            <div
              onClick={() => onOpenInspector(activeRoute, activeTrace[1] || null)}
              onMouseEnter={() => setActiveRingLevel(0)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute top-0 left-1/2 -translate-x-1/2 cursor-pointer z-20 transition-all duration-300 ${
                isActive(0)
                  ? 'scale-105 opacity-100'
                  : isDimmed(0)
                  ? 'opacity-25 hover:opacity-100'
                  : 'opacity-100 hover:scale-102'
              }`}
            >
              <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-indigo-400/50 shadow-lg">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Globe className="w-4 h-4" />
                </div>
                <div className="text-left font-mono">
                  <div className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                    Ring 0 · Cloudflare Edge
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-500">
                      WAN Anycast
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    wsh.panoramadr.com · TLS 1.3 · 0 Inbound Open Ports
                  </div>
                </div>
              </div>
            </div>

            {/* RING 1: DietPi Hardware Host & Loopback Plane */}
            <div
              onMouseEnter={() => setActiveRingLevel(1)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute inset-[78px] rounded-full border-2 transition-all duration-300 ${
                isActive(1)
                  ? 'border-emerald-500 bg-emerald-500/15 shadow-[0_0_40px_rgba(16,185,129,0.35)] opacity-100 scale-[1.01]'
                  : isDimmed(1)
                  ? 'border-emerald-500/10 bg-transparent opacity-20'
                  : 'border-emerald-500/30 bg-emerald-500/[0.02] hover:border-emerald-500/60 opacity-100'
              }`}
            />

            {/* RING 1 CARDINAL STATION: RIGHT (3 o'clock) */}
            <div
              onClick={() => onOpenInspector(activeRoute, activeTrace[3] || null)}
              onMouseEnter={() => setActiveRingLevel(1)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute top-1/2 right-0 translate-x-2 -translate-y-1/2 cursor-pointer z-20 transition-all duration-300 ${
                isActive(1)
                  ? 'scale-105 opacity-100'
                  : isDimmed(1)
                  ? 'opacity-25 hover:opacity-100'
                  : 'opacity-100 hover:scale-102'
              }`}
            >
              <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-emerald-400/50 shadow-lg">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Server className="w-4 h-4" />
                </div>
                <div className="text-left font-mono">
                  <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    Ring 1 · DietPi Host & Proxy
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600">
                      :443 Proxy
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    127.0.0.1:{activeRoute.port} · Lighttpd ^/{activeRoute.slug}
                  </div>
                </div>
              </div>
            </div>

            {/* RING 2: Docker Engine & Bridge NAT */}
            <div
              onMouseEnter={() => setActiveRingLevel(2)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute inset-[150px] rounded-full border-2 transition-all duration-300 ${
                isActive(2)
                  ? 'border-sky-500 bg-sky-500/15 shadow-[0_0_40px_rgba(14,165,233,0.35)] opacity-100 scale-[1.01]'
                  : isDimmed(2)
                  ? 'border-sky-500/10 bg-transparent opacity-20'
                  : 'border-sky-500/30 bg-sky-500/[0.02] hover:border-sky-500/60 opacity-100'
              }`}
            />

            {/* RING 2 CARDINAL STATION: BOTTOM (6 o'clock) */}
            <div
              onClick={() => onOpenInspector(activeRoute, activeTrace[5] || null)}
              onMouseEnter={() => setActiveRingLevel(2)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute bottom-0 left-1/2 -translate-x-1/2 cursor-pointer z-20 transition-all duration-300 ${
                isActive(2)
                  ? 'scale-105 opacity-100'
                  : isDimmed(2)
                  ? 'opacity-25 hover:opacity-100'
                  : 'opacity-100 hover:scale-102'
              }`}
            >
              <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-sky-400/50 shadow-lg">
                <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div className="text-left font-mono">
                  <div className="text-[11px] font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                    Ring 2 · Docker Bridge & NAT
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-500">
                      L2/L3 NAT
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Subnet: {activeRoute.bridgeSubnet} · iptables DNAT
                  </div>
                </div>
              </div>
            </div>

            {/* RING 3: Container Enclaves */}
            <div
              onMouseEnter={() => setActiveRingLevel(3)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute inset-[216px] rounded-full border-2 transition-all duration-300 ${
                isActive(3)
                  ? 'border-amber-500 bg-amber-500/15 shadow-[0_0_40px_rgba(245,158,11,0.35)] opacity-100 scale-[1.01]'
                  : isDimmed(3)
                  ? 'border-amber-500/10 bg-transparent opacity-20'
                  : 'border-amber-500/30 bg-amber-500/[0.02] hover:border-amber-500/60 opacity-100'
              }`}
            />

            {/* RING 3 CARDINAL STATION: LEFT (9 o'clock) */}
            <div
              onClick={() => onOpenInspector(activeRoute, activeTrace[6] || null)}
              onMouseEnter={() => setActiveRingLevel(3)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute top-1/2 left-0 -translate-x-2 -translate-y-1/2 cursor-pointer z-20 transition-all duration-300 ${
                isActive(3)
                  ? 'scale-105 opacity-100'
                  : isDimmed(3)
                  ? 'opacity-25 hover:opacity-100'
                  : 'opacity-100 hover:scale-102'
              }`}
            >
              <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-amber-400/50 shadow-lg">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Box className="w-4 h-4" />
                </div>
                <div className="text-left font-mono">
                  <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    Ring 3 · Container Enclave
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600">
                      App Namespace
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {activeRoute.containerName} · {activeRoute.containerIp}:{activeRoute.port}
                  </div>
                </div>
              </div>
            </div>

            {/* RING 4 (The Core Center Bullseye): Persistent Storage Data Plane */}
            <div
              onClick={() => onOpenInspector(activeRoute, activeTrace[activeTrace.length - 1] || null)}
              onMouseEnter={() => setActiveRingLevel(4)}
              onMouseLeave={() => setActiveRingLevel(null)}
              className={`absolute w-32 h-32 rounded-full border-2 cursor-pointer transition-all duration-300 flex flex-col items-center justify-center text-center p-2 z-30 ${
                isActive(4)
                  ? 'border-emerald-400 bg-emerald-500/25 shadow-[0_0_45px_rgba(16,185,129,0.5)] scale-110 opacity-100'
                  : isDimmed(4)
                  ? 'border-slate-300/30 dark:border-slate-700/30 bg-white/40 dark:bg-slate-900/40 opacity-25'
                  : 'border-slate-300 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl hover:border-emerald-500 opacity-100'
              }`}
            >
              <HardDrive className="w-5 h-5 text-emerald-500 mb-0.5" />
              <div className="text-[10px] font-mono font-bold text-slate-800 dark:text-slate-100">
                Core: Storage
              </div>
              <div className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold truncate max-w-[100px]">
                {activeRoute.slug}.sqlite
              </div>
              <span className="text-[8px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mt-0.5">
                WAL Mode
              </span>
            </div>
          </div>

          {/* Explanatory Legend Footer */}
          <div className="w-full pt-3 mt-1 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-center gap-4 text-xs font-mono text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Ring 0: Top (WAN Edge)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Ring 1: Right (DietPi Host)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Ring 2: Bottom (Docker Bridge)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Ring 3: Left (App Container)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Core: Center (Storage WAL)
            </span>
          </div>
        </div>

        {/* Right: Ingress Traversal Inspector & Layer Telemetry Card */}
        <div className="lg:col-span-4 space-y-4">
          {/* Active Target Summary Header Card */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Zap className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  Active Ingress Journey
                </h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                /{activeRoute.slug}
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Interactive 5-stage ingress journey through concentric security perimeters into host storage:
            </p>

            <div className="space-y-2 pt-1 font-mono text-xs">
              {/* Ring 0 Card */}
              <div
                onMouseEnter={() => setActiveRingLevel(0)}
                onMouseLeave={() => setActiveRingLevel(null)}
                onClick={() => onOpenInspector(activeRoute, activeTrace[1] || null)}
                className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                  isActive(0)
                    ? 'border-indigo-500 bg-indigo-500/15 shadow-md scale-[1.02] opacity-100'
                    : isDimmed(0)
                    ? 'opacity-35 hover:opacity-100 border-slate-200/50 dark:border-slate-800/50 bg-slate-50/40 dark:bg-slate-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:border-indigo-400/60 opacity-100'
                }`}
              >
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    Ring 0: WAN Edge & Anycast
                  </span>
                  <span className="text-[10px] text-slate-400">12 o'clock</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  wsh.panoramadr.com · TLS 1.3 Terminated · 0 Open WAN Ports
                </div>
              </div>

              {/* Ring 1 Card */}
              <div
                onMouseEnter={() => setActiveRingLevel(1)}
                onMouseLeave={() => setActiveRingLevel(null)}
                onClick={() => onOpenInspector(activeRoute, activeTrace[3] || null)}
                className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                  isActive(1)
                    ? 'border-emerald-500 bg-emerald-500/15 shadow-md scale-[1.02] opacity-100'
                    : isDimmed(1)
                    ? 'opacity-35 hover:opacity-100 border-slate-200/50 dark:border-slate-800/50 bg-slate-50/40 dark:bg-slate-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:border-emerald-400/60 opacity-100'
                }`}
              >
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Ring 1: DietPi Host Proxy
                  </span>
                  <span className="text-[10px] text-slate-400">3 o'clock</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  127.0.0.1:{activeRoute.port} · Lighttpd ^/{activeRoute.slug}
                </div>
              </div>

              {/* Ring 2 Card */}
              <div
                onMouseEnter={() => setActiveRingLevel(2)}
                onMouseLeave={() => setActiveRingLevel(null)}
                onClick={() => onOpenInspector(activeRoute, activeTrace[5] || null)}
                className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                  isActive(2)
                    ? 'border-sky-500 bg-sky-500/15 shadow-md scale-[1.02] opacity-100'
                    : isDimmed(2)
                    ? 'opacity-35 hover:opacity-100 border-slate-200/50 dark:border-slate-800/50 bg-slate-50/40 dark:bg-slate-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:border-sky-400/60 opacity-100'
                }`}
              >
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-sky-600 dark:text-sky-400 font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                    Ring 2: Docker Bridge NAT
                  </span>
                  <span className="text-[10px] text-slate-400">6 o'clock</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Subnet: {activeRoute.bridgeSubnet} · iptables DNAT
                </div>
              </div>

              {/* Ring 3 Card */}
              <div
                onMouseEnter={() => setActiveRingLevel(3)}
                onMouseLeave={() => setActiveRingLevel(null)}
                onClick={() => onOpenInspector(activeRoute, activeTrace[6] || null)}
                className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                  isActive(3)
                    ? 'border-amber-500 bg-amber-500/15 shadow-md scale-[1.02] opacity-100'
                    : isDimmed(3)
                    ? 'opacity-35 hover:opacity-100 border-slate-200/50 dark:border-slate-800/50 bg-slate-50/40 dark:bg-slate-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:border-amber-400/60 opacity-100'
                }`}
              >
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Ring 3: Container Enclave
                  </span>
                  <span className="text-[10px] text-slate-400">9 o'clock</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {activeRoute.containerName} · {activeRoute.containerIp}:{activeRoute.port}
                </div>
              </div>

              {/* Core Ring 4 Card */}
              <div
                onMouseEnter={() => setActiveRingLevel(4)}
                onMouseLeave={() => setActiveRingLevel(null)}
                onClick={() => onOpenInspector(activeRoute, activeTrace[activeTrace.length - 1] || null)}
                className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                  isActive(4)
                    ? 'border-emerald-400 bg-emerald-500/15 shadow-md scale-[1.02] opacity-100'
                    : isDimmed(4)
                    ? 'opacity-35 hover:opacity-100 border-slate-200/50 dark:border-slate-800/50 bg-slate-50/40 dark:bg-slate-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:border-emerald-400/60 opacity-100'
                }`}
              >
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-emerald-500 font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Core: Storage Plane
                  </span>
                  <span className="text-[10px] text-slate-400">Center</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 truncate">
                  {activeRoute.app?.manifest.dataVolume || `/var/data/${activeRoute.containerName}/data`}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Action Trigger */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-500">Inspect Deep Socket Details:</span>
            <button
              onClick={() => onOpenInspector(activeRoute, null)}
              className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-sm flex items-center gap-1.5"
            >
              Open Inspector
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
