import { describe, expect, it } from "vitest";
import * as S from "../src";
import { ULID, id } from "./fixtures";

type Sch = { safeParse: (v: unknown) => { success: boolean } };
const idSchemas: Array<[string, Sch, string]> = [
  ["TenantId", S.TenantId, "tenant"], ["HubId", S.HubId, "hub"], ["SiteId", S.SiteId, "site"],
  ["RoomId", S.RoomId, "room"], ["DeviceId", S.DeviceId, "dev"], ["RuleId", S.RuleId, "rule"],
  ["SceneId", S.SceneId, "scn"], ["RunId", S.RunId, "run"], ["EventId", S.EventId, "evt"], ["CommandId", S.CommandId, "cmd"],
];

describe("ids", () => {
  it.each(idSchemas)("%s accepts prefix_ULID and rejects wrong prefix / bad ULID", (_n, schema, p) => {
    expect(schema.safeParse(id(p)).success).toBe(true);
    expect(schema.safeParse(`zzz_${ULID}`).success).toBe(false);
    expect(schema.safeParse(`${p}_${ULID.slice(1)}`).success).toBe(false);
    expect(schema.safeParse(`${p}_${ULID.replace("0", "U")}`).success).toBe(false); // U excluded in Crockford
    expect(schema.safeParse(`${p}_${ULID.toLowerCase()}`).success).toBe(false);
  });
  it("ULID_RE", () => {
    expect(S.ULID_RE.test(ULID)).toBe(true);
    expect(S.ULID_RE.test("short")).toBe(false);
  });
  it("Uid", () => {
    expect(S.Uid.safeParse("firebaseUid123").success).toBe(true);
    expect(S.Uid.safeParse("").success).toBe(false);
  });
  it("PropertyKey", () => {
    expect(S.PropertyKey.safeParse("power").success).toBe(true);
    expect(S.PropertyKey.safeParse("color_temp_2").success).toBe(true);
    expect(S.PropertyKey.safeParse("Power").success).toBe(false);
    expect(S.PropertyKey.safeParse("1power").success).toBe(false);
  });
  it("EpochMs", () => {
    expect(S.EpochMs.safeParse(1_760_000_000_000).success).toBe(true);
    expect(S.EpochMs.safeParse("2026-01-01T00:00:00Z").success).toBe(false);
    expect(S.EpochMs.safeParse(-1).success).toBe(false);
    expect(S.EpochMs.safeParse(1.5).success).toBe(false);
  });
  it("Rev", () => {
    expect(S.Rev.safeParse(0).success).toBe(true);
    expect(S.Rev.safeParse(-1).success).toBe(false);
  });
});
