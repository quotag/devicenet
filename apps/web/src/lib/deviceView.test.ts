/**
 * Tests for device view models.
 * Covers status filtering, ordering, and defaults per spec §9.
 */

import { describe, it, expect } from "vitest";
import {
  fixtureDeviceToggle,
  fixtureDeviceLight,
  fixtureDeviceSensor,
  fixtureDeviceNew,
  FIXTURES,
  createDeviceMap,
} from "../../test/fixtures";
import {
  toggleKey,
  primaryKey,
  secondarySensors,
  homeDevices,
  foundDevices,
  propertyGroups,
} from "./deviceView";
import { Layout, PropertyKey, SiteId } from "@devicenet/shared";

describe("deviceView", () => {
  describe("toggleKey", () => {
    it("returns device.toggleProperty if set", () => {
      const key = toggleKey(fixtureDeviceToggle);
      expect(key).toBe("switch");
    });

    it("returns first writable binary property if toggleProperty not set", () => {
      const device = { ...fixtureDeviceSensor, toggleProperty: undefined };
      // Sensor has no writable binary, so should be undefined
      const key = toggleKey(device);
      expect(key).toBeUndefined();
    });

    it("finds writable binary among properties", () => {
      const device = { ...fixtureDeviceLight, toggleProperty: undefined };
      const key = toggleKey(device);
      expect(key).toBe("state");
    });
  });

  describe("primaryKey", () => {
    it("returns device.primaryProperty if set", () => {
      const key = primaryKey(fixtureDeviceToggle);
      expect(key).toBe("power");
    });

    it("returns first numeric sensor property if primaryProperty not set", () => {
      const device = { ...fixtureDeviceToggle, primaryProperty: undefined };
      const key = primaryKey(device);
      expect(key).toBe("power");
    });

    it("returns undefined if no numeric sensor", () => {
      const device = {
        ...fixtureDeviceToggle,
        primaryProperty: undefined,
        properties: {
          switch: {
            key: "switch" as PropertyKey,
            label: "Switch",
            type: "binary" as const,
            access: "rw" as const,
            category: "control" as const,
          },
        },
      };
      const key = primaryKey(device);
      expect(key).toBeUndefined();
    });
  });

  describe("secondarySensors", () => {
    it("returns up to N numeric sensors excluding primary", () => {
      const sensors = secondarySensors(fixtureDeviceToggle, 2);
      expect(sensors.length).toBe(1); // only "energy" is secondary
      expect(sensors[0].key).toBe("energy");
    });

    it("respects N parameter", () => {
      const sensors = secondarySensors(fixtureDeviceToggle, 1);
      expect(sensors.length).toBe(1);
    });

    it("returns empty array if no secondary sensors", () => {
      const sensors = secondarySensors(fixtureDeviceLight, 2);
      expect(sensors.length).toBe(0);
    });
  });

  describe("homeDevices", () => {
    it("filters to active devices only", () => {
      const devices = createDeviceMap([
        fixtureDeviceToggle,
        fixtureDeviceLight,
        fixtureDeviceNew, // status: "new"
      ]);
      const result = homeDevices(
        devices,
        undefined,
        FIXTURES.siteId,
        "all"
      );
      expect(result).not.toContain(fixtureDeviceNew.id);
      expect(result).toContain(fixtureDeviceToggle.id);
      expect(result).toContain(fixtureDeviceLight.id);
    });

    it("filters to current site only", () => {
      const otherDevice = {
        ...fixtureDeviceToggle,
        id: "dev_other_site" as any,
        siteId: "other_site" as any,
      };
      const devices = createDeviceMap([
        fixtureDeviceToggle,
        otherDevice,
      ]);
      const result = homeDevices(
        devices,
        undefined,
        FIXTURES.siteId,
        "all"
      );
      expect(result).toContain(fixtureDeviceToggle.id);
      expect(result).not.toContain(otherDevice.id);
    });

    it("filters to room when filter is roomId", () => {
      const devices = createDeviceMap([
        fixtureDeviceToggle, // roomId: FIXTURES.roomId
        fixtureDeviceSensor, // roomId: FIXTURES.roomId2
      ]);
      const result = homeDevices(
        devices,
        undefined,
        FIXTURES.siteId,
        FIXTURES.roomId
      );
      expect(result).toContain(fixtureDeviceToggle.id);
      expect(result).not.toContain(fixtureDeviceSensor.id);
    });

    it("orders devices by layout first, then createdAt", () => {
      const earlier = { ...fixtureDeviceToggle, createdAt: FIXTURES.earlier - 60_000 };
      const later = { ...fixtureDeviceLight, createdAt: FIXTURES.earlier };
      const devices = createDeviceMap([later, earlier]);

      // Layout defines order: light first, then toggle
      const layout: Layout = {
        siteId: FIXTURES.siteId,
        rev: 1,
        updatedAt: FIXTURES.now,
        filters: {
          all: {
            cols: 2,
            tiles: {
              [fixtureDeviceLight.id]: { x: 0, y: 0, w: 1, h: 1 },
              [earlier.id]: { x: 1, y: 0, w: 1, h: 1 },
            },
          },
        },
      };

      const result = homeDevices(devices, layout, FIXTURES.siteId, "all");
      expect(result[0]).toBe(fixtureDeviceLight.id);
      expect(result[1]).toBe(earlier.id);
    });

    it("appends new devices in createdAt order if not in layout", () => {
      const old = { ...fixtureDeviceToggle, createdAt: FIXTURES.earlier - 120_000 };
      const new_ = { ...fixtureDeviceLight, createdAt: FIXTURES.earlier };
      const devices = createDeviceMap([new_, old]);

      // Layout only has old device
      const layout: Layout = {
        siteId: FIXTURES.siteId,
        rev: 1,
        updatedAt: FIXTURES.now,
        filters: {
          all: {
            cols: 2,
            tiles: {
              [old.id]: { x: 0, y: 0, w: 1, h: 1 },
            },
          },
        },
      };

      const result = homeDevices(devices, layout, FIXTURES.siteId, "all");
      expect(result[0]).toBe(old.id);
      expect(result[1]).toBe(new_.id); // Appended by createdAt
    });

    it("handles missing layout gracefully", () => {
      const devices = createDeviceMap([
        fixtureDeviceToggle,
        fixtureDeviceLight,
      ]);
      const result = homeDevices(devices, undefined, FIXTURES.siteId, "all");
      // Should order by createdAt (both have same createdAt in fixture)
      expect(result.length).toBe(2);
      expect(result).toContain(fixtureDeviceToggle.id);
      expect(result).toContain(fixtureDeviceLight.id);
    });
  });

  describe("foundDevices", () => {
    it("returns only devices with status 'new'", () => {
      const devices = createDeviceMap([
        fixtureDeviceToggle, // active
        fixtureDeviceNew,    // new
      ]);
      const result = foundDevices(devices, FIXTURES.hubId);
      expect(result).toEqual([fixtureDeviceNew.id]);
    });

    it("filters to hub", () => {
      const otherHub = {
        ...fixtureDeviceNew,
        id: "dev_other_hub" as any,
        hubId: "other_hub" as any,
      };
      const devices = createDeviceMap([
        fixtureDeviceNew,
        otherHub,
      ]);
      const result = foundDevices(devices, FIXTURES.hubId);
      expect(result).toEqual([fixtureDeviceNew.id]);
      expect(result).not.toContain(otherHub.id);
    });

    it("returns empty if no new devices", () => {
      const devices = createDeviceMap([fixtureDeviceToggle]);
      const result = foundDevices(devices, FIXTURES.hubId);
      expect(result).toEqual([]);
    });
  });

  describe("propertyGroups", () => {
    it("groups properties by category", () => {
      const groups = propertyGroups(fixtureDeviceToggle);
      expect(groups.control).toHaveLength(1);
      expect(groups.control[0].key).toBe("switch");
      expect(groups.sensor).toHaveLength(2);
      expect(groups.config).toHaveLength(0);
      expect(groups.diag).toHaveLength(0);
    });

    it("includes all property types", () => {
      const device = {
        ...fixtureDeviceToggle,
        properties: {
          ...fixtureDeviceToggle.properties,
          firmware: {
            key: "firmware" as PropertyKey,
            label: "Firmware",
            type: "text" as const,
            access: "r" as const,
            category: "diag" as const,
          },
        },
      };
      const groups = propertyGroups(device);
      expect(groups.diag).toHaveLength(1);
    });
  });
});
