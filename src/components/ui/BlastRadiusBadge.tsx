import React from 'react';
import {
  Database,
  ShieldAlert,
  Key,
  Package,
  Container,
  Code2,
  HelpCircle,
} from 'lucide-react';

export interface BlastRadiusMeta {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClasses: string;
  dotColor: string;
}

export const BLAST_RADIUS_CONFIG: Record<string, BlastRadiusMeta> = {
  DB_MIGRATION: {
    label: 'Database Schema',
    description: 'Touches SQL migrations or schema scripts; requires DB migration gate.',
    icon: Database,
    colorClasses: 'bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-500/30 hover:border-amber-500/60',
    dotColor: 'bg-amber-400',
  },
  AUTH_SECURITY: {
    label: 'Auth & Security',
    description: 'Modifies authentication, token validation, route guards, or security layers.',
    icon: ShieldAlert,
    colorClasses: 'bg-rose-500/15 text-rose-900 dark:text-rose-300 border-rose-500/30 hover:border-rose-500/60',
    dotColor: 'bg-rose-400',
  },
  ENV_CONTRACT: {
    label: 'Env Contract',
    description: 'Alters environment variables (.env files) or adds mandatory runtime keys.',
    icon: Key,
    colorClasses: 'bg-purple-500/15 text-purple-900 dark:text-purple-300 border-purple-500/30 hover:border-purple-500/60',
    dotColor: 'bg-purple-400',
  },
  DEPENDENCY_DELTA: {
    label: 'Dependencies',
    description: 'Modifies npm dependencies (package.json / package-lock.json).',
    icon: Package,
    colorClasses: 'bg-blue-500/15 text-blue-900 dark:text-blue-300 border-blue-500/30 hover:border-blue-500/60',
    dotColor: 'bg-blue-400',
  },
  DOCKER_INFRA: {
    label: 'Docker & Infra',
    description: 'Updates container configurations, Dockerfile, Compose, or deployment pipelines.',
    icon: Container,
    colorClasses: 'bg-cyan-500/15 text-cyan-900 dark:text-cyan-300 border-cyan-500/30 hover:border-cyan-500/60',
    dotColor: 'bg-cyan-400',
  },
  APP_LOGIC_UI: {
    label: 'App Logic & UI',
    description: 'Modifies application pages, frontend components, or internal services.',
    icon: Code2,
    colorClasses: 'bg-slate-500/15 text-slate-800 dark:text-slate-300 border-slate-500/30 hover:border-slate-500/60',
    dotColor: 'bg-slate-400',
  },
};

interface BlastRadiusBadgeProps {
  badge: string;
  showIcon?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

export const BlastRadiusBadge: React.FC<BlastRadiusBadgeProps> = ({
  badge,
  showIcon = true,
  className = '',
  size = 'sm',
}) => {
  const meta = BLAST_RADIUS_CONFIG[badge] || {
    label: badge,
    description: `Blast radius impact: ${badge}`,
    icon: HelpCircle,
    colorClasses: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
    dotColor: 'bg-slate-400',
  };

  const Icon = meta.icon;
  const isSm = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-mono font-medium border transition-colors cursor-help group relative ${
        meta.colorClasses
      } ${isSm ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'} ${className}`}
      title={`${meta.label}: ${meta.description}`}
    >
      {showIcon && <Icon className={isSm ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} />}
      <span>{meta.label}</span>
    </span>
  );
};
