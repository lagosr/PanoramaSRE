import React, { useId } from 'react';
import type { OttoRuntimePhase } from '../../lib/types';

export interface OttoIconProps {
  className?: string;
  state?: OttoRuntimePhase;
  thinking?: boolean;
  title?: string;
}

/**
 * Otto — PanoramaSRE AI SRE Engineer Mascot Avatar
 * Solar-Amber Sea Otter Engineer with Radar-Cyan cyber-goggles, expressive dual-catchlight eyes,
 * and glowing circuit-pulse pebble. Uses React `useId()` to scope SVG gradient definitions cleanly
 * when multiple Otto avatars render simultaneously across Sidebar, Top Bar, Header, and Chat.
 */
export const OttoIcon: React.FC<OttoIconProps> = ({
  className = 'w-6 h-6',
  state = 'IDLE',
  thinking = false,
  title = 'Otto — Autonomous AI SRE',
}) => {
  const uid = useId().replace(/:/g, '');
  const furId = `otto-fur-${uid}`;
  const faceId = `otto-face-${uid}`;
  const lensId = `otto-lens-${uid}`;
  const pebbleId = `otto-pebble-${uid}`;

  const isActiveThinking =
    thinking || state === 'THINKING' || state === 'STAGE0_EVAL' || state === 'SENSING';
  const isActing = state === 'STAGING' || state === 'ACTING' || state === 'VERIFYING';
  const isPaused = state === 'PAUSED';
  const isTripped = state === 'TRIPPED';

  const sparkStroke = isTripped ? '#f43f5e' : isPaused ? '#94a3b8' : '#00f5d4';
  const secondarySparkStroke = isTripped ? '#fb7185' : isPaused ? '#94a3b8' : '#fbbf24';
  const pulseStroke = isTripped ? '#f43f5e' : isPaused ? '#94a3b8' : isActing ? '#f59e0b' : '#00f5d4';

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={`${className} ${isPaused ? 'opacity-65 grayscale-[45%]' : ''} shrink-0`}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={furId} x1="14" y1="12" x2="50" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fdba74" />
          <stop offset="48%" stopColor="#ff7b00" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
        <linearGradient id={faceId} x1="20" y1="24" x2="44" y2="47" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fffbeb" />
          <stop offset="100%" stopColor="#fde68a" />
        </linearGradient>
        <linearGradient id={lensId} x1="20" y1="10" x2="44" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isTripped ? '#fecdd3' : '#a5f3fc'} />
          <stop offset="50%" stopColor={isTripped ? '#f43f5e' : '#00f5d4'} />
          <stop offset="100%" stopColor={isTripped ? '#9f1239' : '#0284c7'} />
        </linearGradient>
        <linearGradient id={pebbleId} x1="22" y1="47" x2="42" y2="61" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>

      {/* Playful Radar-Cyan & Solar-Amber telemetry spark rays */}
      <g
        strokeWidth="2.6"
        strokeLinecap="round"
        className={isActiveThinking || isActing ? 'animate-pulse' : ''}
        opacity={isPaused ? 0.35 : 1}
      >
        <line x1="10.5" y1="18.5" x2="6" y2="15" stroke={sparkStroke} />
        <line x1="53.5" y1="18.5" x2="58" y2="15" stroke={sparkStroke} />
        <line x1="8" y1="31" x2="4" y2="31" stroke={secondarySparkStroke} />
        <line x1="56" y1="31" x2="60" y2="31" stroke={secondarySparkStroke} />
      </g>

      {/* Rounded otter ears */}
      <circle cx="17.5" cy="19.5" r="5.6" fill={`url(#${furId})`} stroke="#431407" strokeWidth="2.1" />
      <circle cx="17.8" cy="19.8" r="2.7" fill="#fed7aa" />
      <circle cx="46.5" cy="19.5" r="5.6" fill={`url(#${furId})`} stroke="#431407" strokeWidth="2.1" />
      <circle cx="46.2" cy="19.8" r="2.7" fill="#fed7aa" />

      {/* Rounded Solar-Amber otter head & torso silhouette */}
      <path
        d="M14.2 31.5C14.2 20.8 21.8 14 32 14C42.2 14 49.8 20.8 49.8 31.5C49.8 41.2 44.2 50.5 32 51.5C19.8 50.5 14.2 41.2 14.2 31.5Z"
        fill={`url(#${furId})`}
        stroke="#431407"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* Soft glossy fur highlight */}
      <path
        d="M18.6 25.5C17.4 28 17.1 30.8 17.4 33.6"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Radar-Cyan engineer cyber-goggles resting on forehead */}
      <path d="M16.2 19.2C20.5 16.4 43.5 16.4 47.8 19.2" stroke="#1e293b" strokeWidth="3.8" strokeLinecap="round" />
      <rect
        x="19.2"
        y="12.2"
        width="11.2"
        height="8.6"
        rx="4.2"
        fill={`url(#${lensId})`}
        stroke="#0f172a"
        strokeWidth="2"
        className={isActiveThinking ? 'animate-pulse' : ''}
      />
      <path d="M21.8 14.5H25.2" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="30.4" y1="16.5" x2="33.6" y2="16.5" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />
      <rect
        x="33.6"
        y="12.2"
        width="11.2"
        height="8.6"
        rx="4.2"
        fill={`url(#${lensId})`}
        stroke="#0f172a"
        strokeWidth="2"
        className={isActiveThinking ? 'animate-pulse' : ''}
      />
      <path d="M36.2 14.5H39.6" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.6" strokeLinecap="round" />

      {/* Warm cream facial mask / muzzle */}
      <path
        d="M18 33.8C18 27.6 23.2 24.4 32 24.4C40.8 24.4 46 27.6 46 33.8C46 41.2 40.4 46.2 32 46.2C23.6 46.2 18 41.2 18 33.8Z"
        fill={`url(#${faceId})`}
        stroke="#9a3412"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* Expressive eyes with dual white catchlights */}
      <ellipse cx="25.2" cy="32.2" rx="2.7" ry="3.3" fill="#0f172a" />
      <circle cx="24.3" cy="30.9" r="1.05" fill="#ffffff" />
      <circle cx="26.1" cy="33.3" r="0.55" fill="#ffffff" fillOpacity="0.8" />

      <ellipse cx="38.8" cy="32.2" rx="2.7" ry="3.3" fill="#0f172a" />
      <circle cx="37.9" cy="30.9" r="1.05" fill="#ffffff" />
      <circle cx="39.7" cy="33.3" r="0.55" fill="#ffffff" fillOpacity="0.8" />

      {/* Warm rosy cheeks */}
      <ellipse cx="20.4" cy="36.2" rx="2.6" ry="1.5" fill="#fb7185" fillOpacity="0.55" />
      <ellipse cx="43.6" cy="36.2" rx="2.6" ry="1.5" fill="#fb7185" fillOpacity="0.55" />

      {/* Cute rounded otter button nose & cheerful smile */}
      <ellipse cx="32" cy="35.6" rx="2.6" ry="1.8" fill="#1e293b" />
      <ellipse cx="31.3" cy="35.1" rx="0.8" ry="0.45" fill="#ffffff" fillOpacity="0.65" />
      <path
        d="M27.8 39.2C29.4 41.1 31.2 40.8 32 39.5C32.8 40.8 34.6 41.1 36.2 39.2"
        stroke="#0f172a"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Delicate otter whiskers */}
      <g stroke="#7c2d12" strokeOpacity="0.6" strokeWidth="1.3" strokeLinecap="round">
        <line x1="15.5" y1="36.2" x2="19.5" y2="36.8" />
        <line x1="16" y1="39.4" x2="20" y2="38.8" />
        <line x1="48.5" y1="36.2" x2="44.5" y2="36.8" />
        <line x1="48" y1="39.4" x2="44" y2="38.8" />
      </g>

      {/* Glowing Radar-Cyan SRE circuit-wrench pebble held by tiny paws */}
      <rect
        x="22"
        y="47.5"
        width="20"
        height="12.5"
        rx="6"
        fill={`url(#${pebbleId})`}
        stroke="#0f172a"
        strokeWidth="1.9"
      />
      <path
        d="M26 53.8H29L30.6 51L33.2 56.5L35 53.8H38"
        stroke={pulseStroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isActiveThinking || isActing ? 'animate-pulse' : ''}
      />
      <ellipse cx="21.5" cy="53.4" rx="3.4" ry="2.6" fill={`url(#${furId})`} stroke="#431407" strokeWidth="1.8" />
      <ellipse cx="42.5" cy="53.4" rx="3.4" ry="2.6" fill={`url(#${furId})`} stroke="#431407" strokeWidth="1.8" />
    </svg>
  );
};
