import { describe, it, expect } from 'vitest';
import { parseUtcDate, formatLocalDateTime, formatLocalDate, formatRelativeTime } from '../formatters';

describe('formatters and date normalization', () => {
  it('correctly normalizes SQLite space-separated UTC strings', () => {
    const parsed = parseUtcDate('2026-11-01 12:00:00');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(formatLocalDateTime(parsed)).toBeDefined();
    expect(formatLocalDate(parsed)).toBeDefined();
  });

  it('correctly normalizes standard ISO UTC strings', () => {
    const parsed = parseUtcDate('2026-11-01T12:00:00Z');
    expect(parsed?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(formatLocalDateTime(parsed)).toBeDefined();
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
