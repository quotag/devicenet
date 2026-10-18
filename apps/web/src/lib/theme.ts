export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'devicenet-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY) as Theme | null;
  } catch {
    return null;
  }
}

function setStoredTheme(theme: Theme): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors
  }
}

function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
}

function applyTheme(theme: 'light' | 'dark'): void {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
}

export function initTheme(): void {
  let theme: Theme = 'system';

  // Get stored preference or system default
  const stored = getStoredTheme();
  if (stored) {
    theme = stored;
  }

  // Apply initial theme
  const effective = getEffectiveTheme(theme);
  applyTheme(effective);

  // Listen to system theme changes (only if using system preference)
  if (theme === 'system') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      applyTheme(e.matches ? 'dark' : 'light');
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
    } else {
      mediaQuery.addListener(handler);
    }
  }
}

export function setTheme(theme: Theme): void {
  setStoredTheme(theme);
  const effective = getEffectiveTheme(theme);
  applyTheme(effective);

  // Re-setup system listener if switching to system
  if (theme === 'system') {
    initTheme();
  }
}

export function getTheme(): Theme {
  return getStoredTheme() || 'system';
}
