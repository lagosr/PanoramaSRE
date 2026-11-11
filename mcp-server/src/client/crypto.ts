import crypto from 'node:crypto';

/**
 * Recursively sorts object keys alphabetically so JSON.stringify produces the exact
 * same canonical byte sequence as Rust's `serde_json::Value::Object` (`BTreeMap`).
 */
export function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v !== undefined) {
        sorted[key] = sortKeysDeep(v);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Produces deterministic compact JSON matching `ipc_security::canonical_signing_payload` in Rust.
 */
export function canonicalizeParams(params: Record<string, unknown> | null | undefined): string {
  if (!params || Object.keys(params).length === 0) {
    return '{}';
  }
  return JSON.stringify(sortKeysDeep(params));
}

/**
 * Formats the canonical signing payload `<ts>.<nonce>.<action>.<canonical_params_json>`.
 */
export function buildCanonicalSigningPayload(
  ts: number,
  nonce: string,
  action: string,
  params: Record<string, unknown> | null | undefined
): string {
  return `${ts}.${nonce}.${action}.${canonicalizeParams(params)}`;
}

/**
 * Computes lowercase hex HMAC-SHA256 signature for an IPC request.
 */
export function signIpcRequest(
  secret: string,
  ts: number,
  nonce: string,
  action: string,
  params: Record<string, unknown> | null | undefined
): string {
  const payload = buildCanonicalSigningPayload(ts, nonce, action, params);
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(payload, 'utf8').digest('hex');
}

/**
 * Generates a cryptographically random 128-bit hex nonce.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
