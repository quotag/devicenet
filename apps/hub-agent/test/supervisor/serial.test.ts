import { describe, expect, it } from 'vitest';
import { resolveSerialPort, SerialNotFoundError } from '../../src/supervisor/serial.js';

const list = (ports: Array<{ path: string; vendorId?: string; productId?: string }>) => async () => ports;

describe('resolveSerialPort', () => {
  it('matches CP210x case-insensitively', async () => {
    const p = await resolveSerialPort('auto', list([{ path: 'COM1' }, { path: 'COM7', vendorId: '10c4', productId: 'ea60' }]));
    expect(p).toBe('COM7');
  });
  it('matches CH9102', async () => {
    expect(await resolveSerialPort('auto', list([{ path: 'COM9', vendorId: '1A86', productId: '55D4' }]))).toBe('COM9');
  });
  it('explicit override skips listing', async () => {
    expect(
      await resolveSerialPort('COM3', async () => {
        throw new Error('no');
      }),
    ).toBe('COM3');
    expect(await resolveSerialPort('/dev/serial/by-id/usb-x', list([]))).toBe('/dev/serial/by-id/usb-x');
  });
  it('throws clear error when none', async () => {
    await expect(resolveSerialPort('auto', list([{ path: 'COM1', vendorId: '0403', productId: '6001' }]))).rejects.toThrow(
      /Không tìm thấy USB Zigbee/,
    );
    await expect(resolveSerialPort('auto', list([]))).rejects.toBeInstanceOf(SerialNotFoundError);
  });
});
