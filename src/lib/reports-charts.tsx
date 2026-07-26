import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ComposedChart,
  Pie,
  PieChart,
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartHint, ReportOutput } from "./reports-catalog";
import { parseChartNumber } from "./reports-catalog";

const PALETTE = [
  "#0f172a",
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
  "#84cc16",
  "#f97316",
  "#06b6d4",
  "#a855f7",
  "#22c55e",
  "#e11d48",
];

const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    isFinite(n) ? n : 0,
  );

function formatValue(v: number, format?: ChartHint["format"]) {
  if (format === "percent") return `${v.toFixed(1)}%`;
  if (format === "number") return new Intl.NumberFormat("en-IN").format(v);
  return fmtINR(v);
}

function truncate(s: string, n = 22) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function buildChartData(
  output: ReportOutput,
  hint: ChartHint,
  compare?: ReportOutput | null,
) {
  const rows = output.rows.map((r) => {
    const label = String(r[hint.xCol] ?? "");
    const obj: Record<string, any> = { label };
    hint.yCols.forEach((c, i) => {
      const key = hint.yLabels?.[i] ?? output.columns[c] ?? `v${i}`;
      obj[key] = parseChartNumber(r[c] as any);
    });
    return obj;
  });
  const keys = hint.yCols.map((c, i) => hint.yLabels?.[i] ?? output.columns[c] ?? `v${i}`);

  const compareKeys: string[] = [];
  if (compare && (hint.type === "line" || hint.type === "area" || hint.type === "bar" || hint.type === "combo")) {
    const cmpRows = compare.rows;
    keys.forEach((k) => compareKeys.push(`${k} (prev)`));
    rows.forEach((row, idx) => {
      const cmp = cmpRows[idx];
      if (!cmp) return;
      hint.yCols.forEach((c, i) => {
        row[compareKeys[i]] = parseChartNumber(cmp[c] as any);
      });
    });
  }

  if (hint.type === "hbar" || hint.type === "pie") {
    rows.sort((a, b) => (b[keys[0]] ?? 0) - (a[keys[0]] ?? 0));
  }
  const limited = hint.maxItems ? rows.slice(0, hint.maxItems) : rows;
  return { data: limited, keys, compareKeys };
}

export function ReportChart({
  output,
  hint,
  height = 260,
  activeLabel,
  onSegmentClick,
  compareOutput,
}: {
  output: ReportOutput;
  hint: ChartHint;
  height?: number;
  activeLabel?: string | null;
  onSegmentClick?: (label: string | null) => void;
  compareOutput?: ReportOutput | null;
}) {
  const { data, keys, compareKeys } = useMemo(
    () => buildChartData(output, hint, compareOutput ?? null),
    [output, hint, compareOutput],
  );
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const activeKeys = keys.filter((k) => !hidden[k]);
  const activeCompareKeys = compareKeys.filter((k) => !hidden[k]);

  if (!data.length) return null;

  const tooltipFmt = (v: any) => formatValue(Number(v), hint.format);
  const commonAxis = { tick: { fontSize: 11, fill: "#475569" }, stroke: "#cbd5e1" };
  const toggleKey = (k: string) => setHidden((h) => ({ ...h, [k]: !h[k] }));

  const handleClick = (payload: any) => {
    if (!onSegmentClick) return;
    const label: string | undefined = payload?.activeLabel ?? payload?.label ?? payload?.name;
    if (!label) return;
    onSegmentClick(activeLabel === label ? null : label);
  };

  const legend = (
    <Legend
      wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
      onClick={(e: any) => e?.dataKey && toggleKey(String(e.dataKey))}
      formatter={(value: string) => (
        <span style={{ color: hidden[value] ? "#94a3b8" : "#334155", textDecoration: hidden[value] ? "line-through" : "none" }}>
          {value}
        </span>
      )}
    />
  );

  const wrapperCls = "rounded-lg border bg-card p-2 sm:p-3";

  return (
    <div className={wrapperCls}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {hint.title && (
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
            {hint.title}
          </div>
        )}
        {activeLabel && onSegmentClick && (
          <button
            onClick={() => onSegmentClick(null)}
            className="shrink-0 rounded-full border bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
          >
            {truncate(activeLabel, 18)} ✕
          </button>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        {hint.type === "pie" ? (
          <PieChart>
            <Tooltip formatter={tooltipFmt} />
            {legend}
            <Pie
              data={data}
              dataKey={keys[0]}
              nameKey="label"
              innerRadius="45%"
              outerRadius="80%"
              paddingAngle={2}
              labelLine={false}
              onClick={(e: any) => onSegmentClick && onSegmentClick(activeLabel === e?.label ? null : e?.label)}
              style={{ cursor: onSegmentClick ? "pointer" : "default" }}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={PALETTE[i % PALETTE.length]}
                  fillOpacity={activeLabel && activeLabel !== d.label ? 0.25 : 1}
                />
              ))}
            </Pie>
          </PieChart>
        ) : hint.type === "hbar" ? (
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
            onClick={handleClick}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" {...commonAxis} tickFormatter={(v) => formatValue(v, hint.format)} />
            <YAxis
              dataKey="label"
              type="category"
              width={110}
              tick={{ fontSize: 11, fill: "#475569" }}
              tickFormatter={(l) => truncate(String(l), 16)}
            />
            <Tooltip formatter={tooltipFmt} />
            <Bar
              dataKey={keys[0]}
              radius={[0, 4, 4, 0]}
              style={{ cursor: onSegmentClick ? "pointer" : "default" }}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={PALETTE[i % PALETTE.length]}
                  fillOpacity={activeLabel && activeLabel !== d.label ? 0.3 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        ) : hint.type === "line" ? (
          <LineChart data={data} margin={{ left: 4, right: 8, top: 4, bottom: 4 }} onClick={handleClick}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" {...commonAxis} />
            <YAxis {...commonAxis} tickFormatter={(v) => formatValue(v, hint.format)} width={56} />
            <Tooltip formatter={tooltipFmt} />
            {legend}
            {activeKeys.map((k) => {
              const i = keys.indexOf(k);
              return (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={false}
                />
              );
            })}
            {activeCompareKeys.map((k) => {
              const i = compareKeys.indexOf(k);
              return (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  strokeOpacity={0.7}
                  dot={false}
                />
              );
            })}
          </LineChart>
        ) : hint.type === "area" ? (
          <AreaChart data={data} margin={{ left: 4, right: 8, top: 4, bottom: 4 }} onClick={handleClick}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" {...commonAxis} />
            <YAxis {...commonAxis} tickFormatter={(v) => formatValue(v, hint.format)} width={56} />
            <Tooltip formatter={tooltipFmt} />
            {legend}
            {activeKeys.map((k) => {
              const i = keys.indexOf(k);
              return (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={PALETTE[i % PALETTE.length]}
                  fill={PALETTE[i % PALETTE.length]}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              );
            })}
            {activeCompareKeys.map((k) => {
              const i = compareKeys.indexOf(k);
              return (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={PALETTE[i % PALETTE.length]}
                  fill="transparent"
                  strokeDasharray="4 3"
                  strokeOpacity={0.75}
                  strokeWidth={2}
                />
              );
            })}
          </AreaChart>
        ) : hint.type === "combo" ? (
          <ComposedChart data={data} margin={{ left: 4, right: 8, top: 4, bottom: 4 }} onClick={handleClick}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" {...commonAxis} />
            <YAxis {...commonAxis} tickFormatter={(v) => formatValue(v, hint.format)} width={56} />
            <Tooltip formatter={tooltipFmt} />
            {legend}
            {activeKeys.map((k) => {
              const i = keys.indexOf(k);
              return i < keys.length - 1 ? (
                <Bar
                  key={k}
                  dataKey={k}
                  fill={PALETTE[i % PALETTE.length]}
                  radius={[3, 3, 0, 0]}
                  style={{ cursor: onSegmentClick ? "pointer" : "default" }}
                >
                  {data.map((d, di) => (
                    <Cell key={di} fillOpacity={activeLabel && activeLabel !== d.label ? 0.3 : 1} />
                  ))}
                </Bar>
              ) : (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={false}
                />
              );
            })}
          </ComposedChart>
        ) : (
          <BarChart data={data} margin={{ left: 4, right: 8, top: 4, bottom: 4 }} onClick={handleClick}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" {...commonAxis} />
            <YAxis {...commonAxis} tickFormatter={(v) => formatValue(v, hint.format)} width={56} />
            <Tooltip formatter={tooltipFmt} />
            {legend}
            {activeKeys.map((k) => {
              const i = keys.indexOf(k);
              return (
                <Bar
                  key={k}
                  dataKey={k}
                  fill={PALETTE[i % PALETTE.length]}
                  radius={[3, 3, 0, 0]}
                  style={{ cursor: onSegmentClick ? "pointer" : "default" }}
                >
                  {data.map((d, di) => (
                    <Cell key={di} fillOpacity={activeLabel && activeLabel !== d.label ? 0.3 : 1} />
                  ))}
                </Bar>
              );
            })}
            {activeCompareKeys.map((k) => {
              const i = compareKeys.indexOf(k);
              return (
                <Bar
                  key={k}
                  dataKey={k}
                  fill={PALETTE[i % PALETTE.length]}
                  fillOpacity={0.4}
                  radius={[3, 3, 0, 0]}
                />
              );
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Canvas-based chart renderer for PDF embedding ----------
export async function renderChartToPngDataUrl(
  output: ReportOutput,
  hint: ChartHint,
  width = 900,
  height = 380,
): Promise<string> {
  const { data, keys } = buildChartData(output, hint);
  if (!data.length) return "";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (hint.title) {
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 16px Helvetica, Arial, sans-serif";
    ctx.fillText(hint.title, 16, 24);
  }

  const padL = 70,
    padR = 20,
    padT = 40,
    padB = 60;
  const cw = width - padL - padR;
  const ch = height - padT - padB;

  const numFmt = (v: number) => formatValue(v, hint.format);

  if (hint.type === "pie") {
    const total = data.reduce((s, d) => s + (d[keys[0]] ?? 0), 0) || 1;
    const cx = width / 2,
      cy = height / 2 + 10,
      r = Math.min(cw, ch) / 2 - 20;
    let start = -Math.PI / 2;
    data.forEach((d, i) => {
      const v = d[keys[0]] ?? 0;
      const angle = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fill();
      start += angle;
    });
    ctx.font = "11px Helvetica, Arial, sans-serif";
    const legendX = 16,
      legendY = padT + 8;
    data.slice(0, 12).forEach((d, i) => {
      const y = legendY + i * 18;
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fillRect(legendX, y, 12, 12);
      ctx.fillStyle = "#334155";
      ctx.fillText(`${truncate(String(d.label), 18)} — ${numFmt(d[keys[0]] ?? 0)}`, legendX + 18, y + 10);
    });
    return canvas.toDataURL("image/png");
  }

  const isH = hint.type === "hbar";
  const allVals: number[] = [];
  data.forEach((d) => keys.forEach((k) => allVals.push(d[k] ?? 0)));
  const maxV = Math.max(1, ...allVals);
  const minV = Math.min(0, ...allVals);

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + ch);
  ctx.lineTo(padL + cw, padT + ch);
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "10px Helvetica, Arial, sans-serif";
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = minV + ((maxV - minV) * i) / ticks;
    if (isH) {
      const x = padL + (cw * i) / ticks;
      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + ch);
      ctx.stroke();
      ctx.fillText(numFmt(v), x - 20, padT + ch + 14);
    } else {
      const y = padT + ch - (ch * i) / ticks;
      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + cw, y);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.fillText(numFmt(v), 6, y + 3);
    }
  }

  if (isH) {
    const bh = ch / data.length;
    data.forEach((d, i) => {
      const v = d[keys[0]] ?? 0;
      const w = (cw * (v - minV)) / (maxV - minV || 1);
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fillRect(padL, padT + i * bh + 3, w, Math.max(2, bh - 6));
      ctx.fillStyle = "#334155";
      ctx.font = "10px Helvetica, Arial, sans-serif";
      ctx.fillText(truncate(String(d.label), 22), 6, padT + i * bh + bh / 2 + 3);
    });
  } else if (hint.type === "line" || hint.type === "area") {
    const step = cw / Math.max(1, data.length - 1);
    keys.forEach((k, ki) => {
      ctx.strokeStyle = PALETTE[ki % PALETTE.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      const pts: [number, number][] = data.map((d, i) => {
        const v = d[k] ?? 0;
        const x = padL + i * step;
        const y = padT + ch - (ch * (v - minV)) / (maxV - minV || 1);
        return [x, y];
      });
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      if (hint.type === "area") {
        ctx.lineTo(padL + (data.length - 1) * step, padT + ch);
        ctx.lineTo(padL, padT + ch);
        ctx.closePath();
        ctx.fillStyle = PALETTE[ki % PALETTE.length] + "33";
        ctx.fill();
      }
    });
    ctx.fillStyle = "#64748b";
    ctx.font = "10px Helvetica, Arial, sans-serif";
    const labelEvery = Math.ceil(data.length / 10);
    data.forEach((d, i) => {
      if (i % labelEvery !== 0) return;
      const x = padL + i * step;
      const t = truncate(String(d.label), 10);
      ctx.fillText(t, x - 20, padT + ch + 14);
    });
  } else {
    const group = cw / data.length;
    const isCombo = hint.type === "combo";
    const barKeys = isCombo ? keys.slice(0, keys.length - 1) : keys;
    const bw = (group * 0.75) / Math.max(1, barKeys.length);
    data.forEach((d, i) => {
      barKeys.forEach((k, ki) => {
        const v = d[k] ?? 0;
        const x = padL + i * group + group * 0.125 + ki * bw;
        const h = (ch * (v - minV)) / (maxV - minV || 1);
        const y = padT + ch - h;
        ctx.fillStyle = PALETTE[ki % PALETTE.length];
        ctx.fillRect(x, y, bw - 2, h);
      });
    });
    if (isCombo) {
      const lineKey = keys[keys.length - 1];
      const idx = keys.length - 1;
      ctx.strokeStyle = PALETTE[idx % PALETTE.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      data.forEach((d, i) => {
        const v = d[lineKey] ?? 0;
        const x = padL + i * group + group / 2;
        const y = padT + ch - (ch * (v - minV)) / (maxV - minV || 1);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.fillStyle = "#64748b";
    ctx.font = "10px Helvetica, Arial, sans-serif";
    const labelEvery = Math.ceil(data.length / 12);
    data.forEach((d, i) => {
      if (i % labelEvery !== 0) return;
      const x = padL + i * group + group / 2;
      const t = truncate(String(d.label), 10);
      ctx.fillText(t, x - t.length * 3, padT + ch + 14);
    });
  }

  if (keys.length > 1) {
    ctx.font = "11px Helvetica, Arial, sans-serif";
    let lx = padL;
    const ly = height - 20;
    keys.forEach((k, i) => {
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fillRect(lx, ly, 10, 10);
      ctx.fillStyle = "#334155";
      ctx.fillText(k, lx + 14, ly + 9);
      lx += ctx.measureText(k).width + 40;
    });
  }

  return canvas.toDataURL("image/png");
}
