/**
 * Test fixtures for deviceView, stores, and transport layer.
 * All types are from @devicenet/shared to maintain consistency.
 */

import {
  Device,
  DeviceState,
  DeviceStatus,
  HubStatus,
  PairingState,
  PropertyKey,
  PropertyMap,
  PropertyValue,
} from "@devicenet/shared";

const NOW_MS = 1729000000000; // 2024-10-15 around 20:00 UTC

// ============ ID Fixtures ============

export const FIXTURES = {
  // Tenant & Site & Room
  tenantId: "tenant_test" as any,
  siteId: "site_001" as any,
  roomId: "room_kitchen" as any,
  roomId2: "room_living" as any,

  // Hub
  hubId: "hub_001" as any,

  // Devices
  deviceId1: "dev_001_plug" as any,
  deviceId2: "dev_002_light" as any,
  deviceId3: "dev_003_thermo" as any,

  // Timestamps
  now: NOW_MS,
  earlier: NOW_MS - 60_000, // 1 min ago
};

// ============ Device Fixtures ============

/**
 * Plug with power control and monitoring.
 */
export const fixtureDeviceToggle: Device = {
  id: FIXTURES.deviceId1,
  hubId: FIXTURES.hubId,
  siteId: FIXTURES.siteId,
  roomId: FIXTURES.roomId,
  driver: "zigbee2mqtt",
  externalId: "0x0015240a",
  model: "SP-EUC01",
  vendor: "Sonoff",
  firmware: "20241001",
  name: "Ổ cắm quạt",
  icon: "plug",
  toggleProperty: "switch" as PropertyKey,
  primaryProperty: "power" as PropertyKey,
  properties: {
    switch: {
      key: "switch" as PropertyKey,
      label: "Công tắc",
      type: "binary",
      access: "rw",
      category: "control",
    },
    power: {
      key: "power" as PropertyKey,
      label: "Công suất",
      type: "numeric",
      access: "r",
      category: "sensor",
      unit: "W",
      precision: 0,
    },
    energy: {
      key: "energy" as PropertyKey,
      label: "Năng lượng",
      type: "numeric",
      access: "r",
      category: "sensor",
      unit: "kWh",
      precision: 2,
    },
  } as PropertyMap,
  status: "active" as const,
  createdAt: FIXTURES.earlier,
  updatedAt: FIXTURES.earlier,
};

/**
 * Light bulb with brightness and color.
 */
export const fixtureDeviceLight: Device = {
  id: FIXTURES.deviceId2,
  hubId: FIXTURES.hubId,
  siteId: FIXTURES.siteId,
  roomId: FIXTURES.roomId,
  driver: "zigbee2mqtt",
  externalId: "0x0015240b",
  model: "IKEA Tradfri",
  vendor: "IKEA",
  name: "Đèn sân",
  icon: "lightbulb",
  toggleProperty: "state" as PropertyKey,
  primaryProperty: "brightness" as PropertyKey,
  properties: {
    state: {
      key: "state" as PropertyKey,
      label: "Bật/Tắt",
      type: "binary",
      access: "rw",
      category: "control",
    },
    brightness: {
      key: "brightness" as PropertyKey,
      label: "Độ sáng",
      type: "numeric",
      access: "rw",
      category: "control",
      min: 0,
      max: 254,
    },
  } as PropertyMap,
  status: "active" as const,
  createdAt: FIXTURES.earlier,
  updatedAt: FIXTURES.earlier,
};

/**
 * Temperature sensor (read-only).
 */
export const fixtureDeviceSensor: Device = {
  id: FIXTURES.deviceId3,
  hubId: FIXTURES.hubId,
  siteId: FIXTURES.siteId,
  roomId: FIXTURES.roomId2,
  driver: "zigbee2mqtt",
  externalId: "0x0015240c",
  model: "TH-TW",
  vendor: "Tuya",
  name: "Cảm biến nhiệt độ",
  icon: "thermometer",
  primaryProperty: "temperature" as PropertyKey,
  properties: {
    temperature: {
      key: "temperature" as PropertyKey,
      label: "Nhiệt độ",
      type: "numeric",
      access: "r",
      category: "sensor",
      unit: "°C",
      precision: 1,
    },
    humidity: {
      key: "humidity" as PropertyKey,
      label: "Độ ẩm",
      type: "numeric",
      access: "r",
      category: "sensor",
      unit: "%",
      precision: 0,
    },
  } as PropertyMap,
  status: "active" as const,
  createdAt: FIXTURES.earlier,
  updatedAt: FIXTURES.earlier,
};

/**
 * New (unpaired) device.
 */
export const fixtureDeviceNew: Device = {
  ...fixtureDeviceLight,
  id: "dev_004_new" as any,
  status: "new" as const,
};

// ============ Device State Fixtures ============

export const fixtureDeviceStateOn: DeviceState = {
  v: 1,
  ts: FIXTURES.now,
  seq: 1,
  deviceId: FIXTURES.deviceId1,
  online: true,
  lastSeen: FIXTURES.now,
  values: {
    switch: true,
    power: 86,
    energy: 12.34,
  } as Record<PropertyKey, PropertyValue>,
  at: {
    switch: FIXTURES.now,
    power: FIXTURES.now,
    energy: FIXTURES.earlier,
  } as Record<PropertyKey, number>,
  lqi: 200,
};

export const fixtureDeviceStateOff: DeviceState = {
  ...fixtureDeviceStateOn,
  values: {
    switch: false,
    power: 0,
    energy: 12.34,
  } as Record<PropertyKey, PropertyValue>,
};

// ============ Hub & Pairing Fixtures ============

export const fixtureHubStatusOnline: HubStatus = {
  v: 1,
  ts: FIXTURES.now,
  seq: 5,
  online: true,
  agentVersion: "1.0.0",
  z2m: "online",
  z2mVersion: "1.38.0",
  lanUrl: "http://192.168.1.20:8080",
  ip: "192.168.1.20",
  platform: "windows",
  deviceCount: 3,
};

export const fixtureHubStatusOffline: HubStatus = {
  ...fixtureHubStatusOnline,
  online: false,
  ts: FIXTURES.earlier,
};

export const fixturePairingActive: PairingState = {
  v: 1,
  ts: FIXTURES.now,
  seq: 1,
  active: true,
  expiresAt: FIXTURES.now + 120_000, // 120 seconds from now
  startedAt: FIXTURES.now,
  found: [],
};

export const fixturePairingInactive: PairingState = {
  ...fixturePairingActive,
  active: false,
};

// ============ Helpers ============

/**
 * Create a record of devices for testing.
 */
export function createDeviceMap(devices: Device[]): Record<string, Device> {
  return Object.fromEntries(devices.map((d) => [d.id, d]));
}
