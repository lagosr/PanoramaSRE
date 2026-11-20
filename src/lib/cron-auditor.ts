import type {
  AppCronAuditReport,
  CronAuditStatus,
  CronJobAuditResult,
  CronJobDeclaration,
  DiscoveredApp,
  FleetCronAuditSummary,
  WshAppScriptTelemetry,
  WshCronFileTelemetry,
  WshSnapshot,
} from './types';

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Synchronous, browser- & Node-safe UTF-8 SHA-256 hex digest matching Linux sha256sum,
 * PowerShell DeployCron.psm1, and Rust sha2::Sha256 identically.
 */
export function sha256Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(paddedLen - 8, highBits, false);
  view.setUint32(paddedLen - 4, lowBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((val) => val.toString(16).padStart(8, '0'))
    .join('');
}

export function renderExpectedCronFile(app: DiscoveredApp): {
  content: string;
  contentSha256: string;
  primaryShell: '/bin/sh' | '/bin/bash';
  cronFileName: string;
  enabledJobs: CronJobDeclaration[];
} {
  const slug = app.manifest.slug;
  const displayName = app.manifest.displayName;
  const remoteAppRoot = (app.manifest.remoteAppRoot || `/opt/${slug}`).replace(/\/+$/, '');
  const jobs = app.manifest.sre.cronJobs || [];
  const enabledJobs = jobs.filter((j) => j.enabled !== false);
  const usesBash = enabledJobs.some((j) => j.shell === '/bin/bash');
  const primaryShell: '/bin/sh' | '/bin/bash' = usesBash ? '/bin/bash' : '/bin/sh';

  const lines: string[] = [
    '# Managed by PanoramaDeployEngine - DO NOT EDIT MANUALLY',
    `# App: ${slug} (${displayName})`,
    `SHELL=${primaryShell}`,
    'PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin',
  ];

  for (const job of enabledJobs) {
    const scriptRel = job.script.trim().replace(/\\/g, '/');
    const parts: string[] = [
      job.schedule.trim(),
      job.user || 'root',
      `${remoteAppRoot}/${scriptRel}`,
    ];
    if (job.args && job.args.length > 0) {
      parts.push(job.args.join(' '));
    }
    const redirect = job.logRedirect === undefined ? '> /dev/null 2>&1' : job.logRedirect;
    if (redirect.length > 0) {
      parts.push(redirect);
    }
    lines.push(parts.join(' '));
  }

  const content = `${lines.join('\n')}\n`;
  return {
    content,
    contentSha256: sha256Utf8(content),
    primaryShell,
    cronFileName: `panorama-${slug}`,
    enabledJobs,
  };
}

function normalizeCrontabCompare(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getScriptBaseName(scriptRel: string): string {
  const cleaned = scriptRel.trim().replace(/\\/g, '/');
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export function auditFleetCrons(
  apps: DiscoveredApp[],
  snapshot: WshSnapshot | null
): FleetCronAuditSummary {
  const cronServiceStatus = snapshot?.services?.cron || 'unknown';
  const cronServiceActive = snapshot ? cronServiceStatus === 'active' : false;
  const cronFiles: WshCronFileTelemetry[] = snapshot?.cron_telemetry?.cron_d_files || [];
  const appScripts: WshAppScriptTelemetry[] = snapshot?.cron_telemetry?.app_scripts || [];
  const recentLogLines = (snapshot?.cron_telemetry?.recent_runs_raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cronEnabledApps = apps.filter(
    (app) =>
      app.manifest.hostingTarget !== 'cloudflare-pages' &&
      Array.isArray(app.manifest.sre.cronJobs) &&
      app.manifest.sre.cronJobs.length > 0
  );

  const managedFileNames = new Set<string>();
  const reports: AppCronAuditReport[] = [];

  for (const app of cronEnabledApps) {
    const slug = app.manifest.slug;
    const remoteAppRoot = (app.manifest.remoteAppRoot || `/opt/${slug}`).replace(/\/+$/, '');
    const appDirName = remoteAppRoot.split('/').filter(Boolean).pop() || slug;
    const rendered = renderExpectedCronFile(app);
    const legacyNames = app.manifest.sre.cronLegacyFiles || [];
    const expectedCronFileName = rendered.cronFileName;

    managedFileNames.add(expectedCronFileName);
    for (const legacy of legacyNames) {
      managedFileNames.add(legacy);
    }

    const appLogLines = recentLogLines.filter(
      (line) =>
        line.includes(remoteAppRoot) ||
        line.includes(`(${app.manifest.slug})`) ||
        (app.manifest.sre.cronJobs || []).some((j) => line.includes(getScriptBaseName(j.script)))
    );

    if (!snapshot) {
      const unloadedJobs: CronJobAuditResult[] = (app.manifest.sre.cronJobs || []).map((job) => ({
        job,
        scriptName: getScriptBaseName(job.script),
        remoteScriptPath: `${remoteAppRoot}/${job.script.trim().replace(/\\/g, '/')}`,
        liveScript: null,
        scriptExistsOnWsh: false,
        permissionsOk: false,
        crlfClean: false,
        syntaxOk: false,
        shaMatch: false,
        lastRunLine: null,
        issues: ['Waiting for WSH host telemetry snapshot...'],
      }));

      reports.push({
        app,
        slug,
        displayName: app.manifest.displayName,
        remoteAppRoot,
        expectedCronFileName,
        expectedCronContent: rendered.content,
        expectedCronSha256: rendered.contentSha256,
        liveCronFile: null,
        liveLegacyFiles: [],
        status: 'UNKNOWN',
        jobs: unloadedJobs,
        issues: [],
        recentLogLines: [],
      });
      continue;
    }

    const liveCronFile = cronFiles.find((f) => f.name === expectedCronFileName) || null;
    const liveLegacyFiles = cronFiles.filter((f) => legacyNames.includes(f.name));
    const issues: string[] = [];

    let hasFatalFormatError = false;
    let hasContentOrPermDrift = false;
    let hasMissingTarget = false;

    if (!cronServiceActive) {
      issues.push(`WSH host cron daemon is '${cronServiceStatus}' (expected 'active').`);
    }

    if (!liveCronFile) {
      hasMissingTarget = true;
      if (liveLegacyFiles.length > 0) {
        issues.push(
          `Legacy file(s) active (${liveLegacyFiles.map((f) => `/etc/cron.d/${f.name}`).join(', ')}); pending migration to /etc/cron.d/${expectedCronFileName}.`
        );
      } else {
        issues.push(`Missing /etc/cron.d/${expectedCronFileName} on WSH.`);
      }
    } else {
      if (liveCronFile.has_crlf) {
        hasFatalFormatError = true;
        issues.push(`/etc/cron.d/${expectedCronFileName} contains CRLF line endings.`);
      }
      if (!liveCronFile.ends_with_newline) {
        hasFatalFormatError = true;
        issues.push(`/etc/cron.d/${expectedCronFileName} lacks a trailing LF newline.`);
      }
      if (liveCronFile.mode !== '644' || (liveCronFile.owner && liveCronFile.owner !== 'root:root')) {
        hasFatalFormatError = true;
        issues.push(
          `/etc/cron.d/${expectedCronFileName} has mode ${liveCronFile.mode} (${liveCronFile.owner}) instead of 644 (root:root).`
        );
      }
      const normalizedLive = normalizeCrontabCompare(liveCronFile.content_raw);
      const shaMatches =
        (Boolean(liveCronFile.content_sha256) &&
          liveCronFile.content_sha256.toLowerCase() === rendered.contentSha256) ||
        normalizedLive === rendered.content;
      if (!shaMatches) {
        hasContentOrPermDrift = true;
        issues.push(`/etc/cron.d/${expectedCronFileName} content differs from Git SSOT declaration.`);
      }
    }

    if (liveLegacyFiles.length > 0 && liveCronFile) {
      issues.push(
        `Legacy cron file(s) still exist alongside ${expectedCronFileName}: ${liveLegacyFiles.map((f) => f.name).join(', ')}.`
      );
    }

    const jobResults: CronJobAuditResult[] = (app.manifest.sre.cronJobs || []).map((job) => {
      const scriptName = getScriptBaseName(job.script);
      const remoteScriptPath = `${remoteAppRoot}/${job.script.trim().replace(/\\/g, '/')}`;
      const liveScript =
        appScripts.find((s) => s.path === remoteScriptPath) ||
        appScripts.find((s) => s.app_dir === appDirName && s.script_name === scriptName) ||
        null;
      const lastRunLine =
        [...recentLogLines].reverse().find((l) => l.includes(remoteScriptPath) || l.includes(scriptName)) || null;
      const jobIssues: string[] = [];

      if (job.enabled === false) {
        return {
          job,
          scriptName,
          remoteScriptPath,
          liveScript,
          scriptExistsOnWsh: Boolean(liveScript),
          permissionsOk: true,
          crlfClean: true,
          syntaxOk: true,
          shaMatch: true,
          lastRunLine,
          issues: ['Job disabled in panorama.app.json'],
        };
      }

      if (!liveScript) {
        hasMissingTarget = true;
        jobIssues.push(`Missing script on WSH: ${remoteScriptPath}`);
        issues.push(`Script missing on WSH: ${remoteScriptPath}`);
        return {
          job,
          scriptName,
          remoteScriptPath,
          liveScript: null,
          scriptExistsOnWsh: false,
          permissionsOk: false,
          crlfClean: false,
          syntaxOk: false,
          shaMatch: false,
          lastRunLine,
          issues: jobIssues,
        };
      }

      const crlfClean = !liveScript.has_crlf;
      const syntaxOk = Boolean(liveScript.syntax_ok);
      const permissionsOk =
        liveScript.mode === '700' && (!liveScript.owner || liveScript.owner === 'root:root');
      const isExecutable = liveScript.mode === '700' || liveScript.mode === '755';
      const shaMatch =
        !job.localScriptSha256 ||
        liveScript.sha256.toLowerCase() === job.localScriptSha256.toLowerCase();

      if (!crlfClean) {
        hasFatalFormatError = true;
        const msg = `${scriptName} contains CRLF line endings on WSH.`;
        jobIssues.push(msg);
        issues.push(msg);
      }
      if (!syntaxOk) {
        hasFatalFormatError = true;
        const msg = `${scriptName} failed shell syntax validation (sh -n / bash -n).`;
        jobIssues.push(msg);
        issues.push(msg);
      }
      if (!isExecutable || (liveScript.owner && liveScript.owner !== 'root:root')) {
        hasFatalFormatError = true;
        const msg = `${scriptName} permissions ${liveScript.mode} (${liveScript.owner}) are non-executable or wrong owner.`;
        jobIssues.push(msg);
        issues.push(msg);
      } else if (!permissionsOk) {
        hasContentOrPermDrift = true;
        const msg = `${scriptName} permissions are ${liveScript.mode} (hardened target: 700).`;
        jobIssues.push(msg);
        issues.push(msg);
      }
      if (!shaMatch) {
        hasContentOrPermDrift = true;
        const msg = `${scriptName} SHA-256 on WSH (${liveScript.sha256.slice(0, 10)}) drifted from local repo (${job.localScriptSha256?.slice(0, 10)}).`;
        jobIssues.push(msg);
        issues.push(msg);
      }

      return {
        job,
        scriptName,
        remoteScriptPath,
        liveScript,
        scriptExistsOnWsh: true,
        permissionsOk,
        crlfClean,
        syntaxOk,
        shaMatch,
        lastRunLine,
        issues: jobIssues,
      };
    });

    let status: CronAuditStatus = 'IN_SYNC';
    if (!cronServiceActive) {
      status = 'DAEMON_DOWN';
    } else if (hasFatalFormatError) {
      status = 'INVALID_FORMAT';
    } else if (!liveCronFile && liveLegacyFiles.length > 0) {
      status = 'LEGACY_UNMIGRATED';
    } else if (hasMissingTarget) {
      status = 'MISSING';
    } else if (liveLegacyFiles.length > 0) {
      status = 'LEGACY_UNMIGRATED';
    } else if (hasContentOrPermDrift) {
      status = 'DRIFTED';
    }

    reports.push({
      app,
      slug,
      displayName: app.manifest.displayName,
      remoteAppRoot,
      expectedCronFileName,
      expectedCronContent: rendered.content,
      expectedCronSha256: rendered.contentSha256,
      liveCronFile,
      liveLegacyFiles,
      status,
      jobs: jobResults,
      issues: Array.from(new Set(issues)),
      recentLogLines: appLogLines,
    });
  }

  const unmanagedCronFiles = cronFiles.filter((f) => !managedFileNames.has(f.name));
  const inSyncCount = reports.filter((r) => r.status === 'IN_SYNC').length;
  const attentionCount = snapshot
    ? !cronServiceActive && reports.length === 0
      ? 1
      : reports.filter((r) => r.status !== 'IN_SYNC').length
    : 0;

  return {
    cronServiceStatus,
    cronServiceActive,
    apps: reports,
    inSyncCount,
    attentionCount,
    unmanagedCronFiles,
  };
}
