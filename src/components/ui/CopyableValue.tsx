import React, { useState, useRef, useEffect } from 'react';
import { Check } from 'lucide-react';

export interface AddressToken {
  text: string;
  copyable: boolean;
  kind?: 'mac' | 'ipv4' | 'ipv6';
}

const MAC_PART = String.raw`(?:[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5})`;
const IPV4_PART = String.raw`(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|1?\d\d?)){3}(?:\/(?:3[0-2]|[12]?\d)|:\d{1,5})?(?![\d.])`;
const IPV6_PART = String.raw`(?<![:\w])(?:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?|::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*|(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}))(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?(?![:\w])`;

const MAC_EXACT = new RegExp(`^${MAC_PART}$`);
const IPV4_EXACT = new RegExp(`^${IPV4_PART}$`);

/**
 * Splits mixed text (summaries, UniFi filter specs, subnet lists) into plain segments
 * and copyable MAC, IPv4/CIDR/port, or IPv6/CIDR tokens without matching HH:MM:SS timestamps.
 */
export function tokenizeAddresses(text: string): AddressToken[] {
  if (!text) return [];
  const combined = new RegExp(`(${MAC_PART}|${IPV4_PART}|${IPV6_PART})`, 'g');
  const tokens: AddressToken[] = [];
  let lastIdx = 0;

  for (const match of text.matchAll(combined)) {
    const idx = match.index ?? 0;
    const raw = match[0];
    if (idx > lastIdx) {
      tokens.push({ text: text.slice(lastIdx, idx), copyable: false });
    }
    const kind: AddressToken['kind'] = MAC_EXACT.test(raw)
      ? 'mac'
      : IPV4_EXACT.test(raw)
      ? 'ipv4'
      : 'ipv6';
    tokens.push({ text: raw, copyable: true, kind });
    lastIdx = idx + raw.length;
  }

  if (lastIdx < text.length) {
    tokens.push({ text: text.slice(lastIdx), copyable: false });
  }
  return tokens;
}

export async function writeClipboardText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    }
  } catch {
    return false;
  }
  return false;
}

export interface CopyableValueProps {
  value?: string | null;
  display?: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string;
  className?: string;
}

/**
 * Renders an inline address value whose text can be single-clicked to copy immediately
 * without adding resting icon clutter. Drag-safe via pointer-down propagation stop.
 */
export const CopyableValue: React.FC<CopyableValueProps> = ({
  value,
  display,
  fallback = '—',
  label,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const trimmed = typeof value === 'string' ? value.trim() : '';
  const isPlaceholder =
    !trimmed || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'no-ip';

  if (isPlaceholder) {
    return <span className={className || undefined}>{display ?? fallback}</span>;
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await writeClipboardText(trimmed);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => void handleCopy(e)}
      title={copied ? 'Copied to clipboard' : `Click to copy ${label ? `${label} ` : ''}(${trimmed})`}
      aria-label={`Copy ${label || trimmed}`}
      className={`inline-flex items-center gap-1 rounded px-0.5 -mx-0.5 transition-colors cursor-pointer text-left hover:bg-[var(--color-brand-subtle)] hover:text-[var(--color-brand-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] ${
        copied ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10' : ''
      } ${className}`}
    >
      <span className="min-w-0 break-all">{display ?? trimmed}</span>
      {copied && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap flex-shrink-0">
          <Check className="w-3 h-3" />
          Copied
        </span>
      )}
    </button>
  );
};

export interface CopyableAddressTextProps {
  text?: string | null;
  fallback?: React.ReactNode;
  className?: string;
}

/**
 * Renders mixed text where every detected MAC, IPv4/CIDR/port, and IPv6/CIDR token
 * becomes an instant 1-click copy target while non-address prose stays normal text.
 */
export const CopyableAddressText: React.FC<CopyableAddressTextProps> = ({
  text,
  fallback = '—',
  className = '',
}) => {
  if (!text) {
    return <span className={className}>{fallback}</span>;
  }
  const tokens = tokenizeAddresses(text);
  if (tokens.length === 0) {
    return <span className={className}>{fallback}</span>;
  }
  return (
    <span className={className}>
      {tokens.map((tok, idx) =>
        tok.copyable ? (
          <CopyableValue
            key={`${idx}-${tok.text}`}
            value={tok.text}
            label={tok.kind === 'mac' ? 'MAC address' : 'IP / subnet'}
            className="font-mono"
          />
        ) : (
          <React.Fragment key={idx}>{tok.text}</React.Fragment>
        )
      )}
    </span>
  );
};
