import React from 'react';

export interface ColoredSegment {
  text: string;
  className?: string;
}

/**
 * Remove ANSI SGR, CSI, OSC, and stray carriage-return sequences so copied
 * output is clean plain text without terminal control artifacts.
 */
export function stripAnsiCodes(input: string): string {
  if (!input) return '';
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r/g, '');
}

function stripNonSgrControlCodes(input: string): string {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[(?![0-9;]*m)[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b(?!\[)[@-Z\\-_]/g, '')
    .replace(/\r/g, '');
}

function resolveAnsiStyle(codesRaw: string, prevClass: string): string {
  if (!codesRaw || codesRaw === '0') return '';
  const codes = codesRaw.split(';').map((c) => parseInt(c, 10));
  let nextClass = prevClass;

  for (const code of codes) {
    if (Number.isNaN(code) || code === 0) {
      nextClass = '';
    } else if (code === 1) {
      nextClass = `${nextClass} font-semibold`.trim();
    } else if (code === 2) {
      nextClass = `${nextClass} opacity-75`.trim();
    } else if (code === 30 || code === 90) {
      nextClass = 'text-slate-500 dark:text-slate-400';
    } else if (code === 31 || code === 91) {
      nextClass = 'text-rose-600 dark:text-rose-400 font-semibold';
    } else if (code === 32 || code === 92) {
      nextClass = 'text-emerald-700 dark:text-emerald-400 font-medium';
    } else if (code === 33 || code === 93) {
      nextClass = 'text-amber-700 dark:text-amber-400 font-medium';
    } else if (code === 34 || code === 94 || code === 36 || code === 96) {
      nextClass = 'text-sky-700 dark:text-sky-400 font-medium';
    } else if (code === 35 || code === 95) {
      nextClass = 'text-purple-700 dark:text-purple-400 font-medium';
    } else if (code === 37 || code === 97) {
      nextClass = 'text-slate-900 dark:text-slate-100';
    } else if (code === 39) {
      nextClass = '';
    }
  }

  return nextClass;
}

function determineRootLineClass(cleanLine: string): { rootClass: string; isBuildKitHeader: boolean } {
  const isBuildKitHeader = /^\s*#\d+\s+\[[^\]]+\]\s+/.test(cleanLine);

  // Neutralize zero-count phrases so `0 errors` / `0 failed` / `0 warnings` never false-positive red/amber
  const lineForSeverity = cleanLine
    .replace(/\b0\s+(?:errors?|failed|failures?|warnings?)\b/gi, '')
    .replace(/\bwithout\s+errors?\b/gi, '');

  // 0a. High-signal pass & BuildKit cache/done markers
  if (
    /^\s*#\d+\s+(DONE\b|CACHED\b)/i.test(cleanLine) ||
    /\[ELF-GATE\] Verified/i.test(cleanLine) ||
    /\[TELEMETRY\].*Status=OPTIMAL/i.test(cleanLine) ||
    /^\s*\[(?:PASS|OK)\]/i.test(cleanLine) ||
    /\b0\s+failed\b/i.test(cleanLine) ||
    /\[SMOKE-GATE\]\s+PASSED\b/i.test(cleanLine) ||
    /\bReady in\s+\d+/i.test(cleanLine) ||
    /^\s*\[DEV:[^\]]+\]\s*\[PASS\]/i.test(cleanLine)
  ) {
    return {
      rootClass: 'text-emerald-700 dark:text-emerald-400 font-medium',
      isBuildKitHeader,
    };
  }

  // 0b. BuildKit RUN headers stay non-error unless exited non-zero
  if (isBuildKitHeader) {
    return {
      rootClass: 'text-slate-800 dark:text-slate-300',
      isBuildKitHeader: true,
    };
  }

  // 1. Critical Errors
  if (
    /^\s*(?:\[DEV:[^\]]+\]\s*)?\[FAIL\]/i.test(cleanLine) ||
    /\[ERROR\]/i.test(lineForSeverity) ||
    /\berror\b/i.test(lineForSeverity) ||
    /error:/i.test(lineForSeverity) ||
    /fatal/i.test(lineForSeverity) ||
    /\[err\]/i.test(lineForSeverity) ||
    /\bERR\b/.test(lineForSeverity) ||
    /\bFAIL:/i.test(lineForSeverity) ||
    /\bfailed\b/i.test(lineForSeverity) ||
    /exit code:\s*[1-9]\d*/i.test(cleanLine) ||
    /exit status\s*[1-9]\d*/i.test(cleanLine) ||
    /command failed/i.test(cleanLine) ||
    /rejected/i.test(lineForSeverity)
  ) {
    return {
      rootClass: 'text-rose-600 dark:text-rose-400 font-semibold',
      isBuildKitHeader: false,
    };
  }

  // 2. Warnings & Deprecations
  if (
    /\[WARN\]/i.test(cleanLine) ||
    /\bwarn(?:ing)?\b/i.test(lineForSeverity) ||
    /\bWRN\b/.test(lineForSeverity) ||
    /\bcaution\b/i.test(lineForSeverity) ||
    /\bdeprecated\b/i.test(lineForSeverity) ||
    /\buncommitted\b/i.test(cleanLine) ||
    /\bdirty\b/i.test(lineForSeverity) ||
    /\bblocking\b/i.test(lineForSeverity)
  ) {
    return {
      rootClass: 'text-amber-700 dark:text-amber-400 font-medium',
      isBuildKitHeader: false,
    };
  }

  // 3. Success / Completion
  if (
    /\bsuccess\b/i.test(cleanLine) ||
    /\bhealthy\b/i.test(cleanLine) ||
    /\bdone\b/i.test(cleanLine) ||
    /\bpassed\b/i.test(cleanLine) ||
    /\bsynchronized\b/i.test(cleanLine) ||
    /exit code:\s*0\b/i.test(cleanLine) ||
    /finished `release`/i.test(cleanLine) ||
    /Registered tunnel connection/i.test(cleanLine)
  ) {
    return {
      rootClass: 'text-emerald-700 dark:text-emerald-400 font-medium',
      isBuildKitHeader: false,
    };
  }

  // 4. Info / Tunnel / Network command markers
  if (/\bINF\b/.test(cleanLine) || /\[INFO\]/i.test(cleanLine)) {
    return {
      rootClass: 'text-sky-700 dark:text-sky-300 font-medium',
      isBuildKitHeader: false,
    };
  }

  if (
    cleanLine.startsWith('>>>') ||
    cleanLine.startsWith('==>') ||
    cleanLine.startsWith('---') ||
    cleanLine.startsWith('Hit:') ||
    cleanLine.startsWith('Get:')
  ) {
    return {
      rootClass: 'text-teal-700 dark:text-cyan-300 font-medium',
      isBuildKitHeader: false,
    };
  }

  return {
    rootClass: 'text-slate-800 dark:text-slate-300',
    isBuildKitHeader: false,
  };
}

const INLINE_TOKEN_REGEX =
  /(https?:\/\/[^\s"'<>)]+|\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b|\[\d{2}:\d{2}:\d{2}\]|^\s*#\d+\s+\[[^\]]+\]|\[(?:PASS|OK|FAIL|ERROR|WARN|INFO|INF|WRN|ERR|DEV:[^\]]+|PanoramaSRE|RUNNER|RESOURCE_LOCK|METRICS|TELEMETRY|SMOKE-GATE|ELF-GATE|[a-zA-Z0-9_-]{2,20})\]|\b\d+(?:\.\d+)?(?:ms|s)\b|(?:http_|HTTP\s+|status[=:\s]+)\d{3}\b)/gi;

function getTokenClassName(token: string, inheritedAnsiClass: string): string | undefined {
  if (/^\[(?:PASS|OK)\]$/i.test(token)) {
    return 'text-emerald-700 dark:text-emerald-400 font-bold';
  }
  if (/^\[(?:FAIL|ERROR|ERR)\]$/i.test(token)) {
    return 'text-rose-600 dark:text-rose-400 font-bold';
  }
  if (/^\[(?:WARN|WRN)\]$/i.test(token)) {
    return 'text-amber-700 dark:text-amber-400 font-bold';
  }
  if (/^\[(?:INFO|INF)\]$/i.test(token)) {
    return 'text-sky-700 dark:text-sky-400 font-semibold';
  }
  if (/^\s*#\d+\s+\[/.test(token)) {
    return 'text-sky-700 dark:text-sky-400 font-bold';
  }
  if (/^\[(?:PanoramaSRE|RUNNER|RESOURCE_LOCK|METRICS|TELEMETRY|SMOKE-GATE|ELF-GATE|DEV:[^\]]+)\]$/i.test(token)) {
    return 'text-indigo-700 dark:text-sky-400 font-bold';
  }
  if (/^https?:\/\//i.test(token)) {
    return 'text-sky-700 dark:text-cyan-300 underline decoration-sky-500/30';
  }
  if (/^(?:\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}|\[\d{2}:\d{2}:\d{2}\])/.test(token)) {
    return 'text-slate-500 dark:text-slate-400';
  }
  if (/^\[[^\]]+\]$/.test(token)) {
    return inheritedAnsiClass || 'text-teal-700 dark:text-cyan-300 font-semibold';
  }
  if (/^(?:http_|HTTP\s+|status[=:\s]+)\d{3}$/i.test(token)) {
    const codeMatch = token.match(/\d{3}$/);
    const code = codeMatch ? parseInt(codeMatch[0], 10) : 0;
    if (code >= 500 || code === 0) return 'text-rose-600 dark:text-rose-400 font-semibold';
    if (code >= 400) return 'text-amber-700 dark:text-amber-400 font-semibold';
    return 'text-emerald-700 dark:text-emerald-400 font-semibold';
  }
  if (/^\d+(?:\.\d+)?(?:ms|s)$/i.test(token)) {
    return inheritedAnsiClass || 'text-slate-600 dark:text-slate-400 font-medium';
  }
  return inheritedAnsiClass || undefined;
}

function renderSemanticTokens(text: string, ansiClass: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  INLINE_TOKEN_REGEX.lastIndex = 0;

  while ((match = INLINE_TOKEN_REGEX.exec(text)) !== null) {
    if (match.index > lastIdx) {
      const plain = text.slice(lastIdx, match.index);
      nodes.push(
        ansiClass ? (
          <span key={`${keyPrefix}-p-${lastIdx}`} className={ansiClass}>
            {plain}
          </span>
        ) : (
          plain
        )
      );
    }
    const token = match[0];
    const tokenClass = getTokenClassName(token, ansiClass);
    nodes.push(
      tokenClass ? (
        <span key={`${keyPrefix}-t-${match.index}`} className={tokenClass}>
          {token}
        </span>
      ) : (
        token
      )
    );
    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    const trailing = text.slice(lastIdx);
    nodes.push(
      ansiClass ? (
        <span key={`${keyPrefix}-e-${lastIdx}`} className={ansiClass}>
          {trailing}
        </span>
      ) : (
        trailing
      )
    );
  }

  return nodes;
}

/**
 * Parse a console line into semantic, ANSI-aware React nodes with WCAG AA/AAA light & dark parity.
 * Preserves deterministic root class styling for build/smoke/error severity classifications.
 */
export function formatConsoleLine(line: string): React.ReactNode {
  if (!line) return <span>&nbsp;</span>;

  const sgrPreserved = stripNonSgrControlCodes(line);
  const cleanLine = stripAnsiCodes(sgrPreserved);
  if (!cleanLine) return <span>&nbsp;</span>;

  const { rootClass } = determineRootLineClass(cleanLine);

  const sgrRegex = /\x1b\[([0-9;]*)m/g;
  const children: React.ReactNode[] = [];
  let activeAnsiClass = '';
  let lastIndex = 0;
  let chunkIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sgrRegex.exec(sgrPreserved)) !== null) {
    if (match.index > lastIndex) {
      const slice = sgrPreserved.slice(lastIndex, match.index);
      children.push(...renderSemanticTokens(slice, activeAnsiClass, `c${chunkIndex++}`));
    }
    activeAnsiClass = resolveAnsiStyle(match[1], activeAnsiClass);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < sgrPreserved.length) {
    const tail = sgrPreserved.slice(lastIndex);
    children.push(...renderSemanticTokens(tail, activeAnsiClass, `c${chunkIndex++}`));
  }

  return <span className={rootClass}>{children}</span>;
}
