import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setTheme, getTheme, initTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Clear dark class from html
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('should apply dark class when theme is set to dark', () => {
    setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should remove dark class when theme is set to light', () => {
    document.documentElement.classList.add('dark');
    setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('should persist theme to localStorage', () => {
    setTheme('dark');
    expect(localStorage.getItem('devicenet-theme')).toBe('dark');

    setTheme('light');
    expect(localStorage.getItem('devicenet-theme')).toBe('light');
  });

  it('should retrieve theme from localStorage', () => {
    localStorage.setItem('devicenet-theme', 'dark');
    expect(getTheme()).toBe('dark');
  });

  it('should default to system when no preference stored', () => {
    expect(getTheme()).toBe('system');
  });

  it('should initialize with system theme if no preference exists', () => {
    // Mock matchMedia if not available
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' ? false : true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
    }

    initTheme();
    // The theme should be applied based on system preference
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    expect(document.documentElement.classList.contains('dark')).toBe(isDarkMode);
  });

  it('should initialize with stored preference', () => {
    localStorage.setItem('devicenet-theme', 'dark');
    document.documentElement.classList.remove('dark');
    initTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
