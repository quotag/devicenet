import { describe, expect, it } from "vitest";
import { parseClaimQr } from "./QrScan";

describe("parseClaimQr", () => {
  it("parses devicenet claim URLs", () => {
    expect(parseClaimQr("devicenet://claim?code=K7M2X9A4")).toBe("K7M2X9A4");
    expect(parseClaimQr("devicenet://claim?x=1&code=K7M2X9A4")).toBe("K7M2X9A4");
  });
  it("accepts a bare code and rejects junk", () => {
    expect(parseClaimQr("K7M2X9A4")).toBe("K7M2X9A4");
    expect(parseClaimQr("devicenet://claim")).toBeNull();
    expect(parseClaimQr("https://example.com")).toBeNull();
    expect(parseClaimQr("devicenet://claim?code=SHORT")).toBeNull();
  });
});
