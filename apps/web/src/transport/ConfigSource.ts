import type { z } from "zod";

/** A source of tenant config (Firestore in cloud, hub `/api/config` on LAN). Writes into the `config` store. */
export interface ConfigSource {
  start(tenantId: string): void;
  stop(): void;
  /** Resolves once the first snapshot of every collection has been applied. */
  readonly ready: Promise<void>;
}

/** Recursively convert Firestore `Timestamp`-like values (have `toMillis()`) to epoch ms. */
export function convertTimestamps(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  const o = v as { toMillis?: () => number };
  if (typeof o.toMillis === "function") return o.toMillis();
  if (Array.isArray(v)) return v.map(convertTimestamps);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = convertTimestamps(val);
  return out;
}

/** Convert timestamps, `safeParse` with the shared schema; invalid -> warn + undefined. */
export function parseDoc<S extends z.ZodTypeAny>(schema: S, raw: unknown, label: string): z.infer<S> | undefined {
  const res = schema.safeParse(convertTimestamps(raw));
  if (res.success) return res.data;
  console.warn(`[config] skipping invalid ${label}`, res.error.issues);
  return undefined;
}

export function parseDocs<S extends z.ZodTypeAny>(schema: S, raws: readonly unknown[], label: string): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const r of raws) {
    const d = parseDoc(schema, r, label);
    if (d !== undefined) out.push(d);
  }
  return out;
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
