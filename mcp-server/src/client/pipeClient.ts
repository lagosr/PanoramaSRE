import net from 'node:net';
import crypto from 'node:crypto';
import { generateNonce, signIpcRequest, sortKeysDeep } from './crypto.ts';
import type { IpcRequest, IpcResponse, SreInstanceLease } from '../types/ipc.ts';

const MAX_RESPONSE_BYTES = 256 * 1024; // 256 KiB cap

export interface PipeCallOptions {
  timeoutMs?: number;
}

/**
 * Sends a cryptographically signed HMAC-SHA256 request over the instance's Windows Named Pipe
 * and awaits the single-line NDJSON response.
 */
export async function callSrePipe<T = unknown>(
  lease: SreInstanceLease,
  action: string,
  params: Record<string, unknown> = {},
  options: PipeCallOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const id = `req-${crypto.randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000);
  const nonce = generateNonce();
  const sortedParams = (sortKeysDeep(params) as Record<string, unknown>) || {};
  const sig = signIpcRequest(lease.hmacSecret, ts, nonce, action, sortedParams);

  const requestEnvelope: IpcRequest = {
    id,
    ts,
    nonce,
    action,
    params: sortedParams,
    sig,
  };

  const rawPayload = `${JSON.stringify(requestEnvelope)}\n`;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let buffer = '';

    const socket = net.connect({ path: lease.pipeName });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for PanoramaSRE instance ${lease.instanceId} (${lease.pipeName}) on action '${action}'`
          )
        );
      }
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(rawPayload, 'utf8');
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > MAX_RESPONSE_BYTES) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`IPC response exceeded maximum buffer size (${MAX_RESPONSE_BYTES} bytes)`));
        }
        return;
      }

      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1 && !settled) {
        settled = true;
        clearTimeout(timer);
        const line = buffer.slice(0, newlineIdx).trim();
        socket.end();

        try {
          const parsed = JSON.parse(line) as IpcResponse<T>;
          if (!parsed.ok) {
            const code = parsed.error?.code || 'IPC_ERROR';
            const msg = parsed.error?.message || 'Unknown IPC error';
            reject(new Error(`[${code}] ${msg}`));
            return;
          }
          resolve(parsed.data as T);
        } catch (parseErr) {
          reject(new Error(`Failed to parse IPC response JSON: ${(parseErr as Error).message}`));
        }
      }
    });

    socket.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Named Pipe connection error (${lease.pipeName}): ${err.message}`));
      }
    });

    socket.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Named Pipe closed before response was received (${lease.pipeName})`));
      }
    });
  });
}
