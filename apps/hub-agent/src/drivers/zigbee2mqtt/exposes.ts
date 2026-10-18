import { accessFromZ2M, type Property, type PropertyMap } from '@devicenet/shared';

type Expose = Record<string, unknown>;

const LABELS: Record<string, string> = {
  state: 'Trạng thái',
  brightness: 'Độ sáng',
  color_temp: 'Nhiệt độ màu',
  position: 'Vị trí',
  power: 'Công suất',
  voltage: 'Điện áp',
  current: 'Dòng điện',
  energy: 'Điện năng',
  power_on_behavior: 'Khi có điện lại',
  indicator_mode: 'Đèn báo',
  child_lock: 'Khóa trẻ em',
  linkquality: 'Chất lượng sóng',
  battery: 'Pin',
  voltage_battery: 'Điện áp pin',
  temperature: 'Nhiệt độ',
  humidity: 'Độ ẩm',
  illuminance: 'Ánh sáng',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  power_on_behavior: { off: 'Tắt', on: 'Bật', previous: 'Nhớ' },
  indicator_mode: { off: 'Tắt', 'off/on': 'Sáng khi tắt', 'on/off': 'Sáng khi bật', on: 'Bật' },
};

const PRECISION: Record<string, number> = {
  power: 1,
  voltage: 0,
  current: 2,
  energy: 1,
  temperature: 1,
  humidity: 1,
};

const CONTROL_NAMES = new Set(['state', 'brightness', 'color_temp', 'indicator_mode', 'position']);
const DIAG_NAMES = new Set(['linkquality', 'battery', 'voltage_battery']);
const GROUP_TYPES = new Set(['switch', 'light', 'fan', 'cover', 'lock', 'climate']);

/** Spec 000 data-model §4: Z2M `definition.exposes` -> PropertyMap (keys stay snake_case). */
export function buildProperties(exposes: unknown[]): PropertyMap {
  const out: PropertyMap = {};
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Expose;
      if (Array.isArray(e.features) && GROUP_TYPES.has(String(e.type))) {
        walk(e.features);
        continue;
      }
      const p = toProperty(e);
      if (p) out[p.key] = p;
    }
  };
  walk(exposes);
  return out;
}

function toProperty(e: Expose): Property | null {
  const name = String(e.property ?? e.name ?? '');
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) return null;
  const type = String(e.type);
  const access = accessFromZ2M(typeof e.access === 'number' ? e.access : 1);
  const writable = access !== 'r';
  const label = LABELS[name] ?? humanize(name);
  const meta: Record<string, unknown> = { z2m: name };
  const wCategory = CONTROL_NAMES.has(name) ? 'control' : 'config';

  switch (type) {
    case 'binary': {
      if (e.value_on !== undefined) meta.valueOn = e.value_on;
      if (e.value_off !== undefined) meta.valueOff = e.value_off;
      return { key: name, type: 'binary', label, access, category: writable ? wCategory : 'diag', driverMeta: meta };
    }
    case 'numeric': {
      const category = writable ? wCategory : DIAG_NAMES.has(name) ? 'diag' : 'sensor';
      const p: Property = { key: name, type: 'numeric', label, access, category, driverMeta: meta };
      if (typeof e.unit === 'string' && e.unit && e.unit !== 'lqi') p.unit = e.unit;
      if (typeof e.value_min === 'number') p.min = e.value_min;
      if (typeof e.value_max === 'number') p.max = e.value_max;
      if (typeof e.value_step === 'number' && e.value_step > 0) p.step = e.value_step;
      if (name in PRECISION) p.precision = PRECISION[name];
      else if (category === 'sensor') p.precision = 1;
      return p;
    }
    case 'enum': {
      const values = Array.isArray(e.values) ? e.values.map(String).filter((v) => v.length > 0) : [];
      if (values.length === 0) return null;
      const p: Property = { key: name, type: 'enum', label, access, category: writable ? wCategory : 'diag', values, driverMeta: meta };
      const vl = VALUE_LABELS[name];
      if (vl) p.valueLabels = Object.fromEntries(Object.entries(vl).filter(([k]) => values.includes(k)));
      return p;
    }
    case 'text':
      return { key: name, type: 'text', label, access, category: writable ? 'config' : 'diag', driverMeta: meta };
    case 'composite':
      return { key: name, type: 'composite', label, access, category: 'diag', driverMeta: meta };
    default:
      return null;
  }
}

function humanize(key: string): string {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
