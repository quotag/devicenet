import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DeviceIcon, getIconPickerList } from './DeviceIcon';

describe('DeviceIcon', () => {
  it('should render an icon', () => {
    const { container } = render(<DeviceIcon icon="plug" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('should default to plug icon when icon is not provided', () => {
    const { container } = render(<DeviceIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('should default to plug icon when icon is null', () => {
    const { container } = render(<DeviceIcon icon={null} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('should default to plug icon when icon is invalid', () => {
    const { container } = render(<DeviceIcon icon={'invalid' as any} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('should apply custom size and strokeWidth', () => {
    const { container } = render(<DeviceIcon icon="plug" size={32} strokeWidth={2} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
  });

  it('should apply custom className', () => {
    const { container } = render(<DeviceIcon icon="plug" className="custom-class" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('custom-class')).toBe(true);
  });

  it('should have icon picker list with 8 items', () => {
    const list = getIconPickerList();
    expect(list).toHaveLength(8);
  });

  it('should have valid icon picker items with labels', () => {
    const list = getIconPickerList();
    list.forEach((item) => {
      expect(item.value).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.icon).toBeTruthy();
    });
  });

  it('should include all expected icons in picker list', () => {
    const list = getIconPickerList();
    const values = list.map((item) => item.value);
    expect(values).toContain('plug');
    expect(values).toContain('toggle-left');
    expect(values).toContain('lightbulb');
    expect(values).toContain('fan');
    expect(values).toContain('thermometer');
    expect(values).toContain('zap');
    expect(values).toContain('radar');
    expect(values).toContain('door-open');
  });
});
