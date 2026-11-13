import { describe, it, expect } from 'vitest';
import { parseUtcDate, formatLocalDateTime, formatLocalDate, formatLocalTime, formatLocalIsoDate, formatRelativeTime } from '../formatters';

describe('formatters and date normalization', () => {
  it('correctly normalizes SQLite space-separated UTC strings', () => {
    const parsed = parseUtcDate('2026-11-01 12:00:00');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(formatLocalDateTime(parsed)).toBeDefined();
    expect(formatLocalDate(parsed)).toBeDefined();
    expect(formatLocalTime(parsed)).toBeDefined();
    expect(formatLocalIsoDate(parsed)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('correctly normalizes standard ISO UTC strings', () => {
    const parsed = parseUtcDate('2026-11-01T12:00:00Z');
    expect(parsed?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(formatLocalDateTime(parsed)).toBeDefined();
  });

  it('preserves local date and time for RFC3339 archive timestamps with local timezone offset', () => {
    // Archive filename db-backup_v8_2026-11-13_02-00-05.tar.gz is emitted by local_backups.rs
    // with the workstation's local RFC3339 offset so it does not shift back to 2026-11-12 07:00 PM
    const nowLocal = new Date(2026, 10, 13, 2, 0, 5); // Local 2026-11-13 02:00:05
    const tzOffsetMin = -nowLocal.getTimezoneOffset();
    const sign = tzOffsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(tzOffsetMin);
    const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
    const mm = String(absMin % 60).padStart(2, '0');
    const rfc3339Local = `2026-11-13T02:00:05${sign}${hh}:${mm}`;

    expect(formatLocalIsoDate(rfc3339Local)).toBe('2026-11-13');
    expect(formatLocalTime(rfc3339Local)).toMatch(/02:00:05\s*AM/i);
  });

  it('returns null for null, undefined or empty input', () => {
    expect(parseUtcDate(null)).toBeNull();
    expect(parseUtcDate(undefined)).toBeNull();
    expect(parseUtcDate('')).toBeNull();
  });

  it('formats relative time accurately', () => {
    const now = new Date();
    expect(formatRelativeTime(now)).toBe('Just now');
    
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago');
    
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
  });
});
