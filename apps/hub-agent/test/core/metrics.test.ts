import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/core/clock.js';
import { Metrics } from '../../src/core/metrics.js';

describe('Metrics', () => {
  it('histogram percentiles and overflow', () => {
    const m = new Metrics();
    for (let i = 0; i < 95; i++) m.observe('cmdAck', 40);
    for (let i = 0; i < 5; i++) m.observe('cmdAck', 800);
    m.observe('cmdAck', 9000);
    const s = m.snapshot().cmdAck;
    expect(s).toMatchObject({ count: 101, p50: 50, p95: 1000, max: 9000 });
    expect(s.buckets.reduce((a, b) => a + b, 0)).toBe(101);
    expect(s.buckets.at(-1)).toBe(1);
  });

  it('observeSince uses the clock; logs every 10 min', () => {
    const t = new FakeTime(1_000_000);
    const m = new Metrics(t);
    m.observeSince('setState', 1_000_000 - 120);
    expect(m.snapshot().setState.p50).toBe(200);
    const lines: object[] = [];
    m.startLogging({ info: (o) => lines.push(o) }, t);
    t.advance(30 * 60_000);
    expect(lines).toHaveLength(3);
    m.stopLogging();
    t.advance(60 * 60_000);
    expect(lines).toHaveLength(3);
  });
});
