import { SerialPort } from 'serialport';

export const ZIGBEE_USB_IDS = ['10C4:EA60', '1A86:55D4'] as const;
export const SERIAL_NOT_FOUND_MESSAGE = 'Không tìm thấy USB Zigbee';

export class SerialNotFoundError extends Error {
  constructor(detail?: string) {
    super(detail ? `${SERIAL_NOT_FOUND_MESSAGE} (${detail})` : SERIAL_NOT_FOUND_MESSAGE);
    this.name = 'SerialNotFoundError';
  }
}

export interface PortInfoLike {
  path: string;
  vendorId?: string;
  productId?: string;
}
export type ListPorts = () => Promise<PortInfoLike[]>;

/**
 * Resolve the Zigbee serial port. `setting`: `auto` | explicit `COMx` | `/dev/serial/by-id/*` path.
 * Called at every Z2M (re)start so a COM renumber is picked up (research R2).
 */
export async function resolveSerialPort(
  setting: string = 'auto',
  list: ListPorts = () => SerialPort.list() as Promise<PortInfoLike[]>,
): Promise<string> {
  const s = setting.trim();
  if (s && s.toLowerCase() !== 'auto') return s;
  const ports = await list();
  const hit = ports.find((p) => {
    if (!p.vendorId || !p.productId) return false;
    return (ZIGBEE_USB_IDS as readonly string[]).includes(`${p.vendorId}:${p.productId}`.toUpperCase());
  });
  if (!hit) throw new SerialNotFoundError(`VID:PID ${ZIGBEE_USB_IDS.join(' / ')}`);
  return hit.path;
}
