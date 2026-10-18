import { isIP } from 'node:net';

/** True for loopback, RFC1918, link-local (v4/v6), IPv6 ULA (fc00::/7). */
export function isPrivateIp(raw: string | undefined): boolean {
  if (!raw) return false;
  let ip = raw.trim();
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l === '::1') return true;
    const first = parseInt(l.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
    return false;
  }
  return false;
}
