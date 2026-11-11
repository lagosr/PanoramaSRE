export type SreChannel = 'installed' | 'dev' | 'portable';

export interface SreInstanceLease {
  instanceId: string;
  pid: number;
  pipeName: string;
  version: string;
  channel: SreChannel;
  exePath: string;
  workspaceRoot: string;
  startedAt: string;
  hmacSecret: string;
}

export interface IpcRequest {
  id: string;
  ts: number;
  nonce: string;
  action: string;
  params: Record<string, unknown>;
  sig: string;
}

export interface IpcErrorPayload {
  code: string;
  message: string;
}

export interface IpcResponse<T = unknown> {
  id: string;
  ok: boolean;
  data?: T;
  error?: IpcErrorPayload;
}

export interface InstancePingData {
  instanceId: string;
  pid: number;
  version: string;
  channel: SreChannel;
  exePath: string;
  workspaceRoot: string;
  startedAt: string;
  managedApps: string[];
  managedCount: number;
}

export interface LiveSreInstance {
  lease: SreInstanceLease;
  ping: InstancePingData;
  leaseFilePath: string;
}

export type DevServerStatusType = 'STOPPED' | 'RUNNING_MANAGED' | 'RUNNING_EXTERNAL';

export interface DevServerAppStatus {
  slug: string;
  appId: string;
  displayName: string;
  port: number;
  basePath: string;
  workspacePath: string;
  requiresAuthInDev: boolean;
  status: DevServerStatusType;
  pid: number | null;
  localUrl: string;
  sqlitePath: string | null;
  sqliteSizeBytes: number | null;
  sqliteUserVersion: number | null;
}

export interface DevStatusResponseData {
  instanceId: string;
  channel: SreChannel;
  apps: DevServerAppStatus[];
}

export interface McpToolSchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, McpToolSchemaProperty>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SreToolDomain {
  domainId: string;
  description: string;
  tools: McpToolDefinition[];
}
