import type { Property, PropertyKey, PropertyMap, PropertyValue } from '@devicenet/shared';

/** A device reported by the driver (bridge/devices or interview_successful). */
export interface DiscoveredDevice {
  /** driver identity (ieee address for Zigbee) */
  externalId: string;
  /** current driver-side name (Z2M friendly_name) */
  friendlyName: string;
  model?: string;
  vendor?: string;
  description?: string;
  firmware?: string;
  /** raw driver exposes (Z2M `definition.exposes`), fed to `buildProperties` */
  exposes: unknown[];
  /** true once the interview finished successfully */
  interviewed: boolean;
}

/** Common driver interface (spec 001 FR-H03). */
export interface Driver {
  id: 'zigbee2mqtt';
  start(): Promise<void>;
  stop(): Promise<void>;
  /** bridge/devices + interview_successful */
  onDeviceDiscovered(cb: (d: DiscoveredDevice) => void): void;
  onState(cb: (externalId: string, raw: Record<string, unknown>) => void): void;
  onAvailability(cb: (externalId: string, online: boolean) => void): void;
  setProperty(externalId: string, key: PropertyKey, value: PropertyValue, prop: Property): Promise<void>;
  startPairing(seconds: number): Promise<void>;
  stopPairing(): Promise<void>;
  removeDevice(externalId: string, force: boolean): Promise<void>;
  rename(externalId: string, friendlyName: string): Promise<void>;
  /** bridge/request/device/... or `/get {state:""}` */
  ping(externalId: string): Promise<void>;
  buildProperties(exposes: unknown[]): PropertyMap;
  /** boolean -> "ON"/"OFF" */
  toDriverValue(prop: Property, v: PropertyValue): unknown;
  /** "ON" -> true */
  fromDriverValue(prop: Property, raw: unknown): PropertyValue;
  knownDevices?(): DiscoveredDevice[];
}
