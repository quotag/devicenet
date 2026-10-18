/**
 * Device view models for the PWA.
 * Pure functions deriving display data from Firestore/MQTT state.
 *
 * Reference: specs/002-frontend-pwa/data-model.md "View models"
 */

import {
  Device,
  DeviceStatus,
  Layout,
  Property,
  PropertyKey,
  SiteId,
} from "@devicenet/shared";

/**
 * Get the toggle property key for a device.
 * Defaults to the device's toggleProperty, or first writable binary property.
 * @param device The device
 * @returns Property key, or undefined if no writable binary exists
 */
export function toggleKey(device: Device): PropertyKey | undefined {
  if (device.toggleProperty) return device.toggleProperty;

  // Find first writable binary property
  for (const [key, prop] of Object.entries(device.properties)) {
    if (prop.type === "binary" && (prop.access === "w" || prop.access === "rw")) {
      return key as PropertyKey;
    }
  }
  return undefined;
}

/**
 * Get the primary property key for a device.
 * Defaults to device.primaryProperty, or first numeric sensor.
 * @param device The device
 * @returns Property key, or undefined if no numeric sensor exists
 */
export function primaryKey(device: Device): PropertyKey | undefined {
  if (device.primaryProperty) return device.primaryProperty;

  // Find first numeric sensor property
  for (const [key, prop] of Object.entries(device.properties)) {
    if (prop.type === "numeric" && prop.category === "sensor") {
      return key as PropertyKey;
    }
  }
  return undefined;
}

/**
 * Get up to N secondary numeric sensor properties (for 2×1 tiles).
 * Used to show additional numeric values on tile right column.
 * @param device The device
 * @param n How many to return (default 2)
 * @returns Array of Property objects
 */
export function secondarySensors(device: Device, n: number = 2): Property[] {
  const sensors: Property[] = [];
  const primary = primaryKey(device);

  for (const [key, prop] of Object.entries(device.properties)) {
    if (
      prop.type === "numeric" &&
      prop.category === "sensor" &&
      key !== primary &&
      sensors.length < n
    ) {
      sensors.push(prop);
    }
  }
  return sensors;
}

/**
 * Get all devices for the Home screen, filtered and ordered.
 * Only `status === "active"` devices; ordered by layout, then createdAt.
 * @param devices All devices in the app state
 * @param layout The layout for this site/filter, or undefined
 * @param siteId The current site
 * @param filter Room ID or "all"
 * @returns Ordered list of device IDs to display
 */
export function homeDevices(
  devices: Record<string, Device>,
  layout: Layout | undefined,
  siteId: SiteId,
  filter: string
): string[] {
  // Filter to active devices in this site and room
  const filtered = Object.entries(devices)
    .filter(
      ([_, d]) =>
        d.siteId === siteId &&
        d.status === "active" &&
        (filter === "all" || d.roomId === filter)
    )
    .map(([id, d]) => ({ id, createdAt: d.createdAt }));

  // Get the layout tiles for this filter (if exists)
  const filterKey = filter === "all" ? "all" : filter;
  const layoutTiles = layout?.filters[filterKey]?.tiles ?? {};

  // Sort: devices in layout first (by layout order), then new devices by createdAt
  const result: string[] = [];
  const inLayout = new Set<string>();

  // Add layout-ordered devices
  for (const [deviceId] of Object.entries(layoutTiles)) {
    if (filtered.some((d) => d.id === deviceId)) {
      result.push(deviceId);
      inLayout.add(deviceId);
    }
  }

  // Add remaining devices by createdAt
  filtered
    .filter((d) => !inLayout.has(d.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((d) => result.push(d.id));

  return result;
}

/**
 * Get all newly paired devices waiting to be named.
 * Used in S-11 "Find devices" step.
 * @param devices All devices
 * @param hubId The hub being paired with
 * @returns Array of device IDs with status "new"
 */
export function foundDevices(devices: Record<string, Device>, hubId: string): string[] {
  return Object.entries(devices)
    .filter(([_, d]) => d.hubId === hubId && d.status === "new")
    .map(([id]) => id);
}

/**
 * Group device properties into categories for display (S-20 Device Detail).
 * @param device The device
 * @returns Object mapping category to array of Property objects
 */
export function propertyGroups(
  device: Device
): Record<string, Property[]> {
  const groups: Record<string, Property[]> = {
    control: [],
    sensor: [],
    config: [],
    diag: [],
  };

  for (const prop of Object.values(device.properties)) {
    groups[prop.category]?.push(prop);
  }

  return groups;
}
