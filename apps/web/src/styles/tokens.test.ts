import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('tokens.css generation', () => {
  it('should have generated tokens.css with CSS variables', () => {
    const tokensPath = path.resolve(__dirname, './tokens.css');
    const content = fs.readFileSync(tokensPath, 'utf-8');

    // Check for essential color tokens
    expect(content).toContain('--bg:');
    expect(content).toContain('--surface:');
    expect(content).toContain('--text:');
    expect(content).toContain('--accent:');

    // Check for spacing tokens
    expect(content).toContain('--space-1:');
    expect(content).toContain('--space-4:');

    // Check for radius tokens
    expect(content).toContain('--radius-button:');
    expect(content).toContain('--radius-card:');

    // Check for size tokens
    expect(content).toContain('--touch-min:');
    expect(content).toContain('--header-h:');

    // Check for dark mode override
    expect(content).toContain('.dark {');
  });

  it('should have light theme color values', () => {
    const tokensPath = path.resolve(__dirname, './tokens.css');
    const content = fs.readFileSync(tokensPath, 'utf-8');

    // Check that the :root section has light values
    const rootMatch = content.match(/:root \{([^}]+)\}/);
    expect(rootMatch).toBeTruthy();
    if (rootMatch) {
      expect(rootMatch[1]).toContain('#f6f7f9'); // bg light
    }
  });

  it('should have dark theme color overrides', () => {
    const tokensPath = path.resolve(__dirname, './tokens.css');
    const content = fs.readFileSync(tokensPath, 'utf-8');

    // Check that the .dark section has dark values
    const darkMatch = content.match(/\.dark \{([^}]+)\}/);
    expect(darkMatch).toBeTruthy();
    if (darkMatch) {
      expect(darkMatch[1]).toContain('#0f1115'); // bg dark
    }
  });
});
