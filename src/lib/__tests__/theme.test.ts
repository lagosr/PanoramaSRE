import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readStoredTheme,
  writeStoredTheme,
  applyThemeToDom,
  THEME_STORAGE_KEY,
} from '../../context/ThemeContext';

describe('PanoramaSRE Theme System & Light Mode', () => {
  let mockStorage: Record<string, string> = {};
  let mockClasses: Set<string> = new Set();
  let mockStyle: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    mockClasses = new Set();
    mockStyle = {};

    // Mock localStorage
    const localStorageMock = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = String(val);
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };

    // Mock document.documentElement
    const docElementMock = {
      classList: {
        contains: (cls: string) => mockClasses.has(cls),
        add: (cls: string) => {
          mockClasses.add(cls);
        },
        remove: (cls: string) => {
          mockClasses.delete(cls);
        },
      },
      style: mockStyle,
    };

    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('document', {
      documentElement: docElementMock,
    });
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('light'),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to dark when no preference is saved in localStorage', () => {
    expect(readStoredTheme()).toBe('dark');
  });

  it('reads stored light theme preference from localStorage', () => {
    mockStorage[THEME_STORAGE_KEY] = 'light';
    expect(readStoredTheme()).toBe('light');
  });

  it('reads stored system theme preference from localStorage', () => {
    mockStorage[THEME_STORAGE_KEY] = 'system';
    expect(readStoredTheme()).toBe('system');
  });

  it('writes theme preference to localStorage and panorama_theme key for suite synchronization', () => {
    writeStoredTheme('light');
    expect(mockStorage[THEME_STORAGE_KEY]).toBe('light');
    expect(mockStorage['panorama_theme']).toBe('light');

    writeStoredTheme('dark');
    expect(mockStorage[THEME_STORAGE_KEY]).toBe('dark');
    expect(mockStorage['panorama_theme']).toBe('dark');
  });

  it('applies light theme correctly to the HTML DOM root', () => {
    const resolved = applyThemeToDom('light');
    expect(resolved).toBe('light');
    expect(mockClasses.has('light')).toBe(true);
    expect(mockClasses.has('dark')).toBe(false);
    expect(mockStyle['colorScheme']).toBe('light');
  });

  it('applies dark theme correctly to the HTML DOM root', () => {
    applyThemeToDom('light');
    expect(mockClasses.has('light')).toBe(true);

    const resolved = applyThemeToDom('dark');
    expect(resolved).toBe('dark');
    expect(mockClasses.has('dark')).toBe(true);
    expect(mockClasses.has('light')).toBe(false);
    expect(mockStyle['colorScheme']).toBe('dark');
  });

  it('resolves system theme matching prefers-color-scheme media query', () => {
    const resolved = applyThemeToDom('system');
    expect(resolved).toBe('light');
    expect(mockClasses.has('light')).toBe(true);
    expect(mockStyle['colorScheme']).toBe('light');
  });
});
