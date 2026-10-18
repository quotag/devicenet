import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { Input } from './Input';
import { Row } from './Row';
import { Skeleton } from './Skeleton';
import { StatusBanner } from './StatusBanner';
import { Switch } from './Switch';
afterEach(cleanup);

describe('Button', () => {
  it('renders variant class and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button variant="danger" onClick={onClick}>Xóa</Button>);
    const b = screen.getByRole('button', { name: 'Xóa' });
    expect(b.className).toContain('dn-btn-danger');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('loading is busy and disabled', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Lưu</Button>);
    const b = screen.getByRole('button', { name: 'Lưu' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b).toBeDisabled();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it('disabled', () => {
    render(<Button disabled>X</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('Chip', () => {
  it('exposes aria-pressed', () => {
    render(<Chip selected>Phòng khách</Chip>);
    expect(screen.getByRole('button', { name: 'Phòng khách' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('add chip has no aria-pressed', () => {
    render(<Chip add>Phòng</Chip>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
  });
});

describe('Switch', () => {
  it('toggles with next value', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} label="Bật Đèn" onChange={onChange} />);
    const s = screen.getByRole('switch', { name: 'Bật Đèn' });
    expect(s).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(s);
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it('pending is busy and blocks input', () => {
    const onChange = vi.fn();
    render(<Switch checked pending label="Tắt Đèn" onChange={onChange} />);
    const s = screen.getByRole('switch');
    expect(s).toHaveAttribute('aria-busy', 'true');
    expect(s).toBeDisabled();
    fireEvent.click(s);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('disabled blocks input', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} disabled label="x" onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Badge / Card / Row / Skeleton', () => {
  it('badge tone class', () => {
    render(<Badge tone="ok">OK</Badge>);
    expect(screen.getByText('OK').className).toContain('dn-badge-ok');
  });
  it('card invalid shows alert error', () => {
    render(<Card title="T" state="invalid" error="Thiếu điều kiện">x</Card>);
    expect(screen.getByRole('alert')).toHaveTextContent('Thiếu điều kiện');
  });
  it('clickable row is a button with label/hint', () => {
    const onClick = vi.fn();
    render(<Row label="Hub" hint="online" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Hub/ }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByText('online')).toBeInTheDocument();
  });
  it('static row is not a button', () => {
    render(<Row label="Tên" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('skeleton is hidden from AT', () => {
    const { container } = render(<Skeleton width={10} height={10} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Input', () => {
  it('label bound, onChange gives string, hint described', () => {
    const onChange = vi.fn();
    render(<Input label="Tên" hint="Tối đa 30" onChange={onChange} />);
    const i = screen.getByLabelText('Tên');
    expect(i).toHaveAccessibleDescription('Tối đa 30');
    fireEvent.change(i, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('abc');
  });
  it('invalid sets aria-invalid; disabled', () => {
    render(<Input label="A" invalid disabled />);
    const i = screen.getByLabelText('A');
    expect(i).toHaveAttribute('aria-invalid', 'true');
    expect(i).toBeDisabled();
  });
});

describe('Banner / StatusBanner', () => {
  it('banner action fires', () => {
    const onAction = vi.fn();
    render(<Banner kind="offline" action="Thử lại" onAction={onAction}>Hub offline</Banner>);
    expect(screen.getByRole('status')).toHaveTextContent('Hub offline');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onAction).toHaveBeenCalled();
  });
  it.each([
    ['offline', 'dn-banner-offline'],
    ['lan', 'dn-banner-lan'],
    ['reconnecting', 'dn-banner-reconnecting'],
    ['saving', 'dn-banner-reconnecting'],
  ] as const)('mode %s', (mode, cls) => {
    render(<StatusBanner mode={mode} text="t" />);
    expect(screen.getByRole('status').className).toContain(cls);
  });
  it('reconnecting/saving show spinner, offline shows dot', () => {
    const { container, rerender } = render(<StatusBanner mode="saving" text="t" />);
    expect(container.querySelector('.dn-spin')).not.toBeNull();
    rerender(<StatusBanner mode="offline" text="t" />);
    expect(container.querySelector('.dn-spin')).toBeNull();
  });
});
