import { describe, expect, it, vi } from "vitest";
vi.mock("@/env", () => ({ env: { mode: "cloud", apiUrl: "http://x" } }));
import { ApiError, createApi, setTokenGetter } from "./api";
import { paths, pathStr } from "./paths";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("maps error body to ApiError", async () => {
    const f = vi.fn(async () => json(409, { error: { code: "already_claimed", message: "Hub đã được liên kết" } }));
    const api = createApi("http://x", f as unknown as typeof fetch);
    const err = await api.GET("/v1/tenants/me" as never).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "already_claimed", message: "Hub đã được liên kết" });
  });

  it("falls back for non-JSON error body", async () => {
    const f = vi.fn(async () => new Response("boom", { status: 502, statusText: "Bad Gateway" }));
    const api = createApi("http://x", f as unknown as typeof fetch);
    const err = await api.GET("/v1/tenants/me" as never).catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "unknown", message: "Bad Gateway" });
  });

  it("injects Bearer token", async () => {
    setTokenGetter(() => "abc");
    const f = vi.fn(async (_r: Request) => json(200, { ok: true }));
    const api = createApi("http://x", f as unknown as typeof fetch);
    await api.GET("/v1/tenants/me" as never);
    expect(f.mock.calls[0]![0].headers.get("Authorization")).toBe("Bearer abc");
    setTokenGetter(() => null);
  });
});

describe("paths", () => {
  it("builds tenant-scoped paths", () => {
    expect(pathStr(paths.device("t1", "d1"))).toBe("tenants/t1/devices/d1");
    expect(pathStr(paths.rooms("t1", "s1"))).toBe("tenants/t1/sites/s1/rooms");
    expect(pathStr(paths.layout("t1", "s1"))).toBe("tenants/t1/layouts/s1");
  });
});
