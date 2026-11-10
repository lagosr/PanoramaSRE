import React from 'react';

export interface ColoredSegment {
  text: string;
  className: string;
}

/**
 * Parses a terminal log line and assigns contextual colors for:
 * - Timestamps and execution tags: cyan / blue
 * - Errors, fatal issues, and exit codes > 0: red
 * - Warnings, deprecations, and cautions: amber / yellow
 * - Success markers, completions, and health: emerald / green
 * - Docker steps, digests, and commands: sky / cyan
 * - Default text: slate-300 / emerald-400
 */
export function formatConsoleLine(line: string): React.ReactNode {
  if (!line) return <span>&nbsp;</span>;

  // 0a. BuildKit step completion / cache hits & explicit ELF / Telemetry OPTIMAL lines
  if (
    /^\s*#\d+\s+(DONE\b|CACHED\b)/i.test(line) ||
    /\[ELF-GATE\] Verified/i.test(line) ||
    /\[TELEMETRY\].*Status=OPTIMAL/i.test(line)
  ) {
    return <span className="text-emerald-700 dark:text-emerald-400 font-medium">{line}</span>;
  }

  // 0b. BuildKit step headers (e.g. `#25 [runner 9/10] RUN ...`) — render before generic
  // error/warning checks so echoed JS/shell strings (`console.error`, `FAIL`, `dirty`) do not false-positive
  if (/^\s*#\d+\s+\[[^\]]+\]\s+/.test(line)) {
    const bracketEnd = line.indexOf(']');
    if (bracketEnd !== -1) {
      const tag = line.substring(0, bracketEnd + 1);
      const rest = line.substring(bracketEnd + 1);
      return (
        <span>
          <span className="text-sky-700 dark:text-sky-400 font-bold">{tag}</span>
          <span className="text-slate-700 dark:text-slate-300">{rest}</span>
        </span>
      );
    }
  }

  // 1. Critical Errors (WCAG AAA/AA 4.5:1+)
  if (
    /error/i.test(line) ||
    /fatal/i.test(line) ||
    /\[err\]/i.test(line) ||
    /\bERR\b/.test(line) ||
    /\bFAIL:/i.test(line) ||
    /failed/i.test(line) ||
    /exit code: [1-9]\d*/i.test(line) ||
    /command failed/i.test(line) ||
    /rejected/i.test(line)
  ) {
    return <span className="text-rose-600 dark:text-rose-400 font-semibold">{line}</span>;
  }

  // 2. Warnings & Deprecations (WCAG AA 4.5:1+)
  if (
    /warn/i.test(line) ||
    /\bWRN\b/.test(line) ||
    /caution/i.test(line) ||
    /deprecated/i.test(line) ||
    /uncommitted/i.test(line) ||
    /dirty/i.test(line) ||
    /blocking/i.test(line)
  ) {
    return <span className="text-amber-700 dark:text-amber-400 font-medium">{line}</span>;
  }

  // 3. Success, Tunnel Info & Completion (WCAG AAA/AA 4.5:1+)
  if (
    /success/i.test(line) ||
    /healthy/i.test(line) ||
    /done/i.test(line) ||
    /passed/i.test(line) ||
    /synchronized/i.test(line) ||
    /exit code: 0/i.test(line) ||
    /finished `release`/i.test(line) ||
    /Registered tunnel connection/i.test(line)
  ) {
    return <span className="text-emerald-700 dark:text-emerald-400 font-medium">{line}</span>;
  }

  // 3.5. Standard Tunnel Informational logs
  if (/\bINF\b/.test(line)) {
    return <span className="text-sky-700 dark:text-sky-300 font-medium">{line}</span>;
  }

  // 4. Docker & Runner Prefixes (#1, #2, [RUNNER], [PanoramaSRE])
  if (line.startsWith('#') || line.startsWith('[RUNNER]') || line.startsWith('[PanoramaSRE]') || line.startsWith('[RESOURCE_LOCK]')) {
    const bracketEnd = line.indexOf(']');
    if (bracketEnd !== -1 && (line.startsWith('[') || line.startsWith('#'))) {
      const tag = line.substring(0, bracketEnd + 1);
      const rest = line.substring(bracketEnd + 1);
      return (
        <span>
          <span className="text-sky-700 dark:text-sky-400 font-bold">{tag}</span>
          <span className="text-slate-800 dark:text-slate-300">{rest}</span>
        </span>
      );
    }
  }

  // 5. Git / Remote / Network commands
  if (line.startsWith('>>>') || line.startsWith('==>') || line.startsWith('---') || line.startsWith('Hit:') || line.startsWith('Get:')) {
    return <span className="text-teal-700 dark:text-cyan-300 font-medium">{line}</span>;
  }

  // 6. Default styled console text
  return <span className="text-slate-800 dark:text-slate-300">{line}</span>;
}
