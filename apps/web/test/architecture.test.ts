import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import * as shared from "@devicenet/shared";

const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

const files = walk(SRC)
  .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
  .map((f) => ({ rel: relative(SRC, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));

describe("architecture", () => {
  it("imports mqtt / firebase/firestore only inside src/transport/", () => {
    const re = /(from\s+|import\s*\(\s*)["'](mqtt|firebase\/firestore)["']/;
    const bad = files.filter((f) => !f.rel.startsWith("transport/") && re.test(f.text)).map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it("uses setInterval only in transport/lan and CountdownRing", () => {
    const bad = files
      .filter((f) => !f.rel.startsWith("transport/lan/") && f.rel !== "components/dn/CountdownRing.tsx")
      .filter((f) => /\bsetInterval\s*\(/.test(f.text))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it("does not redefine shared zod schemas locally", () => {
    const names = Object.keys(shared).filter((k) => /Schema$/.test(k));
    const bad: string[] = [];
    for (const f of files) {
      if (!/\bz\.object\s*\(/.test(f.text)) continue;
      for (const n of names) {
        const base = n.replace(/Schema$/, "");
        const re = new RegExp(`(const|let)\s+(${n}|${base})\s*=\s*z\.object\(`);
        if (re.test(f.text)) bad.push(`${f.rel}:${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
