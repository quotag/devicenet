import type { Property, PropertyValue } from '@devicenet/shared';

function meta(prop: Property, k: 'valueOn' | 'valueOff', dflt: string): unknown {
  const v = prop.driverMeta?.[k];
  return v === undefined ? dflt : v;
}

/** Canonical value -> Z2M payload value (binary boolean -> value_on/value_off, default "ON"/"OFF"). */
export function toDriverValue(prop: Property, v: PropertyValue): unknown {
  if (prop.type === 'binary' && typeof v === 'boolean') {
    return v ? meta(prop, 'valueOn', 'ON') : meta(prop, 'valueOff', 'OFF');
  }
  return v;
}

/** Z2M raw value -> canonical value. */
export function fromDriverValue(prop: Property, raw: unknown): PropertyValue {
  if (prop.type === 'binary') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    if (typeof raw === 'string') {
      if (raw === meta(prop, 'valueOn', 'ON')) return true;
      if (raw === meta(prop, 'valueOff', 'OFF')) return false;
      const u = raw.toUpperCase();
      return u === 'ON' || u === 'TRUE' || u === '1' || u === 'LOCK';
    }
    return false;
  }
  return raw as PropertyValue;
}
