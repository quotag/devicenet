import { Line, LineChart, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "@/transport/HistorySource";
import { hhmm } from "@/lib/format";

const SIX = 6;

/** 6 evenly spaced hour ticks across [from, to], snapped to whole hours. */
export function hourTicks(from: number, to: number): number[] {
  const H = 3600_000;
  const step = Math.max(H, Math.round((to - from) / SIX / H) * H);
  const first = Math.ceil(from / H) * H;
  const out: number[] = [];
  for (let t = first; t <= to && out.length < SIX; t += step) out.push(t);
  return out;
}

export interface PropertyChartProps {
  points: HistoryPoint[];
  from: number;
  to: number;
  tz: string;
}

/** 24 h line (Recharts, lazy-loaded by PropertyRow): accent stroke, dashed grid, dot on the latest point. */
export default function PropertyChart({ points, from, to, tz }: PropertyChartProps) {
  const data = points.map(([ts, v]) => ({ ts, v }));
  const last = data[data.length - 1];
  return (
    <div style={{ width: "100%", height: 110 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <XAxis
            dataKey="ts"
            type="number"
            domain={[from, to]}
            ticks={hourTicks(from, to)}
            tickFormatter={(t: number) => hhmm(t, tz)}
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            interval={0}
          />
          <YAxis hide domain={["auto", "auto"]} />
          <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
          {last ? <ReferenceDot x={last.ts} y={last.v} r={3.5} fill="var(--accent)" stroke="none" /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
