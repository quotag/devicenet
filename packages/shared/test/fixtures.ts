export const ULID = "01HZX3K8Q4V5N7M2B9C6D1E0FG";
export const id = (p: string) => `${p}_${ULID}`;
export const T = id("tenant"), H = id("hub"), S = id("site"), R = id("room"), D = id("dev");
export const RULE = id("rule"), SCN = id("scn"), RUN = id("run"), EVT = id("evt"), CMD = id("cmd");

/** TS011F smart plug properties as the driver would produce them */
export const plugProperties = {
  state: { key: "state", label: "Trạng thái", access: "rw", category: "control", type: "binary" },
  power: { key: "power", label: "Công suất", access: "r", category: "sensor", type: "numeric", unit: "W", precision: 1 },
  voltage: { key: "voltage", label: "Điện áp", access: "r", category: "sensor", type: "numeric", unit: "V", min: 0, max: 300 },
  current: { key: "current", label: "Dòng điện", access: "r", category: "sensor", type: "numeric", unit: "A", precision: 2 },
  energy: { key: "energy", label: "Điện năng", access: "r", category: "sensor", type: "numeric", unit: "kWh", precision: 2 },
} as const;

export const plugDevice = {
  id: D, hubId: H, siteId: S, roomId: R, driver: "zigbee2mqtt", externalId: "0xa4c138aabbccddee",
  model: "TS011F", vendor: "Tuya", name: "Ổ cắm phòng khách", properties: plugProperties,
  status: "active", createdAt: 1_760_000_000_000, updatedAt: 1_760_000_000_000,
};

export const plugState = {
  v: 1, ts: 1_760_000_001_000, seq: 5, deviceId: D, online: true, lastSeen: 1_760_000_001_000,
  values: { state: true, power: 38.5, voltage: 229, current: 0.17, energy: 12.34 },
  at: { state: 1_760_000_000_500, power: 1_760_000_001_000 },
};

export const cx = {
  deviceName: () => "Ổ cắm phòng khách",
  propertyLabel: (_d: string, k: string) => plugProperties[k as keyof typeof plugProperties]?.label ?? k,
  unit: (_d: string, k: string) => (plugProperties[k as keyof typeof plugProperties] as { unit?: string })?.unit,
  sceneName: () => "Đi ngủ",
};
