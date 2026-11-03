import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const THEME_STORAGE_KEY = 'panoramasre_theme';
export const THEME_BROADCAST_CHANNEL = 'panorama_theme_sync';

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val;
    }
  } catch {}
  return 'dark'; // Dark is canonical default across PanoramaDrSuite
}

export function writeStoredTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem('panorama_theme', theme);
  } catch {}
}

export function applyThemeToDom(theme: Theme): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark';
  const root = document.documentElement;
  const resolved: ResolvedTheme = theme === 'system' ? getSystemTheme() : theme;

  if (resolved === 'dark') {
    root.classList.remove('light');
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
  }

  return resolved;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode; initialTheme?: Theme }> = ({
  children,
  initialTheme,
}) => {
  const [theme, setThemeState] = useState<Theme>(() => initialTheme || readStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    applyThemeToDom(initialTheme || readStoredTheme())
  );

  const applyAndSave = useCallback((newTheme: Theme, broadcast = true) => {
    setThemeState(newTheme);
    const resolved = applyThemeToDom(newTheme);
    setResolvedTheme(resolved);
    writeStoredTheme(newTheme);

    if (broadcast && typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
        channel.postMessage({ type: 'THEME_CHANGED', theme: newTheme });
        channel.close();
      } catch {}
    }
  }, []);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      applyAndSave(newTheme, true);
    },
    [applyAndSave]
  );

  const toggleTheme = useCallback(() => {
    const next: Theme = resolvedTheme === 'dark' ? 'light' : 'dark';
    applyAndSave(next, true);
  }, [resolvedTheme, applyAndSave]);

  // Listen to system preference changes if 'system' is selected
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handleSystemChange = () => {
      if (theme === 'system') {
        const resolved = applyThemeToDom('system');
        setResolvedTheme(resolved);
      }
    };

    media.addEventListener('change', handleSystemChange);
    return () => media.removeEventListener('change', handleSystemChange);
  }, [theme]);

  // Cross-window / cross-service broadcast listener
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    try {
      const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === 'THEME_CHANGED' && event.data?.theme) {
          const incoming = event.data.theme as Theme;
          if (incoming === 'dark' || incoming === 'light' || incoming === 'system') {
            applyAndSave(incoming, false);
          }
        }
      };
      return () => {
        channel.close();
      };
    } catch {}
  }, [applyAndSave]);

  // Initial apply on mount
  useEffect(() => {
    const resolved = applyThemeToDom(theme);
    setResolvedTheme(resolved);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
