import { describe, expect, it } from 'vitest';
import { isPrivateIp } from '../../src/lan/privateIpGuard.js';

describe('isPrivateIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.1.1', '::1', 'fd12::1', 'fc00::1', 'fe80::1', '::ffff:192.168.1.5', 'fe80::1%eth0'])(
    'allows %s',
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '2001:db8::1', '::ffff:8.8.8.8', 'garbage', ''])('rejects %s', (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );
  it('rejects undefined', () => expect(isPrivateIp(undefined)).toBe(false));
});
