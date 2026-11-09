import { TerminalTab } from '../layout/SreTerminalDrawer';

export interface SslStageInfo {
  stage: number;
  label: string;
  subStep: string;
  isFinished: boolean;
  isFailed: boolean;
}

export type DeviceOperationStatus = 'pending' | 'in_progress' | 'success' | 'failed' | 'skipped';

export interface DeviceBatchStatus {
  deviceKey: string;
  displayName: string;
  domain: string;
  issuanceStatus: DeviceOperationStatus;
  deploymentStatus: DeviceOperationStatus;
  detail?: string;
  error?: string;
}

export interface SslBatchProgress {
  stageInfo: SslStageInfo;
  isBatch: boolean;
  activeDeviceKey?: string;
  activeDeviceName?: string;
  totalDevices: number;
  completedDevices: number;
  failedDevices: number;
  devices: DeviceBatchStatus[];
}

export const KNOWN_SSL_DEVICES: Array<{ deviceKey: string; displayName: string; domain: string; aliases: string[] }> = [
  { deviceKey: 'Unifi_Cloud_Key_G2', displayName: 'UniFi CloudKey G2', domain: 'ui.panoramadr.com', aliases: ['ui', 'cloudkey', 'Network_CloudKey'] },
  { deviceKey: 'Unifi_Protect_UNVR', displayName: 'UniFi Protect UNVR', domain: 'protect.panoramadr.com', aliases: ['protect', 'unvr', 'Protect_UNVR'] },
  { deviceKey: 'HomeAssistant', displayName: 'Home Assistant', domain: 'ha.panoramadr.com', aliases: ['ha', 'homeassistant'] },
  { deviceKey: 'Genmon', displayName: 'Generator Monitor', domain: 'genmon.panoramadr.com', aliases: ['genmon'] },
  { deviceKey: 'WebServicesHost', displayName: 'Web Services Host (DietPi)', domain: 'wsh.panoramadr.com', aliases: ['wsh', 'dietpi'] },
  { deviceKey: 'NanoStation_House', displayName: 'NanoStation 5AC House', domain: 'nano-house.panoramadr.com', aliases: ['nano-house', 'house'] },
  { deviceKey: 'NanoStation_Shed', displayName: 'NanoStation 5AC Shed', domain: 'nano-shed.panoramadr.com', aliases: ['nano-shed', 'shed'] },
];

export function getSslStageInfo(tab?: TerminalTab): SslStageInfo | null {
  if (!tab) return null;

  const isFinished = !tab.isRunning && tab.exitCode === 0;
  const isFailed = !tab.isRunning && tab.exitCode !== undefined && tab.exitCode !== 0;

  const lines = tab.lines || [];
  const fullText = lines.join('\n');
  const tail = lines.slice(-20).join(' ');

  let stage = 1;
  let label = 'Pre-flight & Local Repository';
  let subStep = 'Evaluating certificate expiration & staging repository';

  // Check if error occurred
  if (/Deployment Error|Failed to generate certificate|CHECKSUM MISMATCH|Remote verification failed/i.test(tail)) {
    if (fullText.includes('--- STAGE 2: APPLIANCE DEPLOYMENT')) {
      stage = 3;
      label = 'Staging & Transport';
      subStep = 'Deployment transport or verification failed';
    } else {
      stage = 2;
      label = 'ACME DNS-01 Challenge';
      subStep = 'ACME certificate request or challenge failed';
    }
    return { stage, label, subStep, isFinished, isFailed: true };
  }

  // Stage 4: Atomic Install & Service Reload
  if (/Installing and restarting service|Service restart command issued|Lighttpd service restart command issued|JOB COMPLETE/i.test(fullText)) {
    stage = 4;
    label = 'Atomic Install & Service Reload';
    if (/JOB COMPLETE/i.test(tail) || isFinished) {
      subStep = isFinished ? 'All SSL stages completed successfully' : 'Issuing final health probes';
    } else if (/restart/i.test(tail)) {
      subStep = 'Restarting web service & applying file permissions';
    } else {
      subStep = 'Concatenating combined PEM bundle';
    }
    return { stage, label, subStep, isFinished, isFailed };
  }

  // Stage 3: Appliance Staging & SCP/SMB Transport
  if (/--- STAGE 2: APPLIANCE DEPLOYMENT|Using SSH key authentication|Connecting to|Verifying remote SCP|Uploading certificates|Checking integrity|Integrity confirmed/i.test(fullText)) {
    stage = 3;
    label = 'Staging & Transport';
    if (/Checking integrity|Integrity confirmed/i.test(tail)) {
      subStep = 'Verifying remote SHA256/MD5 transfer checksums';
    } else if (/Uploading certificates|pscp|scp\.exe/i.test(tail)) {
      subStep = 'Uploading certificates to appliance staging area';
    } else if (/Verifying remote SCP|Creating remote staging/i.test(tail)) {
      subStep = 'Preparing remote appliance directories';
    } else {
      subStep = 'Connecting to appliance over secure transport';
    }
    return { stage, label, subStep, isFinished, isFailed };
  }

  // Stage 2: ACME DNS-01 Challenge (Cloudflare / Let's Encrypt)
  if (/New-PACertificate|Submit-Renewal|Posh-ACME|Cloudflare|Authorizing|Validating|Certificate generated and saved/i.test(fullText) ||
      (/--- STAGE 1: CERTIFICATE ISSUANCE/i.test(fullText) && /Processing:/i.test(fullText) && !/Skipped renewal/i.test(tail))) {
    stage = 2;
    label = 'ACME DNS-01 Challenge';
    if (/Certificate generated and saved/i.test(tail)) {
      subStep = 'ACME certificate signed & saved to local disk';
    } else if (/Cloudflare|Authorizing|Validating/i.test(tail)) {
      subStep = 'Cloudflare DNS-01 TXT challenge verification';
    } else {
      subStep = 'Communicating with Let\'s Encrypt ACME endpoint';
    }
    return { stage, label, subStep, isFinished, isFailed };
  }

  // Stage 1: Pre-flight
  if (isFinished) {
    return {
      stage: 4,
      label: 'Lifecycle Finished',
      subStep: 'Completed without pending actions',
      isFinished: true,
      isFailed: false,
    };
  }

  return { stage, label, subStep, isFinished, isFailed };
}

/**
 * Parses stdout lines to reconstruct per-device lifecycle progress
 * across all appliances targeted in the current batch or single execution.
 */
export function getSslBatchProgress(tab?: TerminalTab): SslBatchProgress | null {
  const stageInfo = getSslStageInfo(tab);
  if (!stageInfo || !tab) return null;

  const lines = tab.lines || [];
  const fullText = lines.join('\n');

  // Detect whether this is a single-target or multi-device batch
  // Look at the command invocation in lines[0] or [1]
  const targetDeviceMatch = fullText.match(/-TargetDevice\s+([^\s]+)/i);
  const deployTargetsMatch = fullText.match(/-DeployTargets\s+([^\s]+)/i);

  let targetKeys: string[] = [];
  if (targetDeviceMatch && deployTargetsMatch && targetDeviceMatch[1] === deployTargetsMatch[1]) {
    const single = targetDeviceMatch[1];
    const found = KNOWN_SSL_DEVICES.find(d => d.deviceKey.toLowerCase() === single.toLowerCase() || d.aliases.some(a => a.toLowerCase() === single.toLowerCase()));
    if (found) {
      targetKeys = [found.deviceKey];
    }
  }

  // If no single target was isolated, it's a full fleet batch (all 7 devices)
  const isBatch = targetKeys.length !== 1;
  const deviceList = isBatch
    ? KNOWN_SSL_DEVICES
    : KNOWN_SSL_DEVICES.filter(d => targetKeys.includes(d.deviceKey));

  let activeDeviceKey: string | undefined;
  let activeDeviceName: string | undefined;

  const devices: DeviceBatchStatus[] = deviceList.map((dev) => {
    let issuanceStatus: DeviceOperationStatus = 'pending';
    let deploymentStatus: DeviceOperationStatus = 'pending';
    let detail: string | undefined;
    let error: string | undefined;

    // 1. Issuance Stage Parsing
    const processingRegex = new RegExp(`Processing:\\s*(?:${dev.deviceKey}|${dev.displayName})\\s*\\((?:${dev.domain})\\)`, 'i');
    const certGeneratedRegex = new RegExp(`Certificate generated and saved for (?:${dev.deviceKey}|${dev.displayName})`, 'i');
    const skippedRenewalRegex = new RegExp(`Skipped renewal for (?:${dev.deviceKey}|${dev.displayName})`, 'i');
    const issuanceFailedRegex = new RegExp(`Failed to generate certificate for (?:${dev.deviceKey}|${dev.displayName})`, 'i');

    if (fullText.includes('--- STAGE 1: CERTIFICATE ISSUANCE')) {
      if (processingRegex.test(fullText)) {
        issuanceStatus = 'in_progress';
        detail = 'Requesting ACME certificate';
        activeDeviceKey = dev.deviceKey;
        activeDeviceName = dev.displayName;
      }
      if (skippedRenewalRegex.test(fullText)) {
        issuanceStatus = 'skipped';
        detail = 'Certificate valid (skipped)';
      }
      if (certGeneratedRegex.test(fullText)) {
        issuanceStatus = 'success';
        detail = 'Certificate signed';
      }
      if (issuanceFailedRegex.test(fullText)) {
        issuanceStatus = 'failed';
        error = 'ACME validation failed';
      }
    }

    // 2. Deployment Stage Parsing
    const deployHeaderRegex = new RegExp(`(?:${dev.displayName.toUpperCase()}|${dev.deviceKey.toUpperCase()}) DEPLOYMENT`, 'i');
    const skippedDeployRegex = new RegExp(`Skipped ${dev.displayName}`, 'i');
    const deployErrorRegex = new RegExp(`(?:\\[ERR\\]\\s*)?${dev.displayName} Deployment Error:\\s*(.*)`, 'i');

    if (fullText.includes('--- STAGE 2: APPLIANCE DEPLOYMENT')) {
      if (deployHeaderRegex.test(fullText)) {
        deploymentStatus = 'in_progress';
        detail = 'Transporting & verifying';
        activeDeviceKey = dev.deviceKey;
        activeDeviceName = dev.displayName;

        // Check if there is an explicit error line after this deployment header
        const errorMatch = fullText.match(deployErrorRegex);
        if (errorMatch) {
          deploymentStatus = 'failed';
          error = errorMatch[1]?.trim() || 'Deployment transport failed';
          detail = error;
        } else if (skippedDeployRegex.test(fullText)) {
          deploymentStatus = 'skipped';
          detail = 'Deployment skipped';
        } else if (fullText.includes('JOB COMPLETE') || fullText.includes('=== SERVICE DOMAIN EXPIRATION')) {
          deploymentStatus = 'success';
          detail = 'Deployed & verified';
        }
      }
    }

    // If job finished overall with exit code 0 and no error logged for this dev
    if (stageInfo.isFinished && !error) {
      if (issuanceStatus === 'in_progress') issuanceStatus = 'success';
      if (deploymentStatus === 'in_progress' || deploymentStatus === 'pending') {
        deploymentStatus = 'success';
        detail = 'Deployed & verified';
      }
    }

    return {
      deviceKey: dev.deviceKey,
      displayName: dev.displayName,
      domain: dev.domain,
      issuanceStatus,
      deploymentStatus,
      detail,
      error,
    };
  });

  const totalDevices = devices.length;
  const completedDevices = devices.filter(
    d => (d.deploymentStatus === 'success' || d.deploymentStatus === 'skipped') &&
         (d.issuanceStatus === 'success' || d.issuanceStatus === 'skipped')
  ).length;
  const failedDevices = devices.filter(
    d => d.deploymentStatus === 'failed' || d.issuanceStatus === 'failed'
  ).length;

  return {
    stageInfo,
    isBatch,
    activeDeviceKey,
    activeDeviceName,
    totalDevices,
    completedDevices,
    failedDevices,
    devices,
  };
}
