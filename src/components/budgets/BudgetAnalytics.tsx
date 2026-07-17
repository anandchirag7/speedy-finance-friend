import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBudgetTrend } from "@/lib/budgets.functions";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

type CategorySummary = {
  id: string;
  name: string;
  color: string | null;
  budget: number;
  spent: number;
  hasChildren: boolean;
};

const PALETTE = [
  "#6366F1", "#10B981", "#F59E0B", "#EF4444", "#06B6D4",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#84CC16",
];

function shortMonth(mk: string) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function BudgetAnalytics({
  month,
  categorySummaries,
  totalBudget,
  totalSpent,
}: {
  month: string;
  categorySummaries: CategorySummary[];
  totalBudget: number;
  totalSpent: number;
}) {
  const navigate = useNavigate();
  const trendFn = useServerFn(getBudgetTrend);
  const q = useQuery({
    queryKey: ["budget-trend", month],
    queryFn: () => trendFn({ data: { month, months: 6 } }),
    staleTime: 60_000,
  });

  const topCats = useMemo(
    () =>
      [...categorySummaries]
        .filter((c) => !c.hasChildren && (c.spent > 0 || c.budget > 0))
        .sort((a, b) => b.spent - a.spent)
        .slice(0, 8),
    [categorySummaries],
  );

  const donutData = useMemo(() => {
    const top = topCats.slice(0, 7);
    const rest = topCats.slice(7);
    const restTotal = rest.reduce((s, c) => s + c.spent, 0);
    const arr = top.map((c, i) => ({
      name: c.name,
      value: c.spent,
      color: c.color || PALETTE[i % PALETTE.length],
    }));
    if (restTotal > 0) arr.push({ name: "Other", value: restTotal, color: "#94A3B8" });
    return arr.filter((d) => d.value > 0);
  }, [topCats]);

  const overspending = useMemo(
    () =>
      categorySummaries
        .filter((c) => !c.hasChildren && c.budget > 0 && c.spent > c.budget)
        .map((c) => ({ ...c, over: c.spent - c.budget, pct: (c.spent / c.budget) * 100 }))
        .sort((a, b) => b.over - a.over)
        .slice(0, 6),
    [categorySummaries],
  );

  const budgetVsActual = useMemo(() => {
    return (q.data?.trend ?? []).map((t) => ({
      month: shortMonth(t.month),
      Budget: t.budget,
      Spent: t.spent,
    }));
  }, [q.data]);

  const trendLine = budgetVsActual;

  const compareData = useMemo(
    () =>
      topCats.slice(0, 6).map((c, i) => ({
        name: c.name.length > 12 ? c.name.slice(0, 12) + "…" : c.name,
        Spent: c.spent,
        Budget: c.budget,
        color: c.color || PALETTE[i % PALETTE.length],
      })),
    [topCats],
  );

  // Forecast: linear projection of remaining budget given trailing avg spend
  const forecast = useMemo(() => {
    const trend = q.data?.trend ?? [];
    if (!trend.length) return null;
    const last = trend[trend.length - 1];
    const avg =
      trend.slice(0, -1).reduce((s, t) => s + t.spent, 0) / Math.max(1, trend.length - 1);
    const projected = Math.max(last.spent, avg);
    const remaining = Math.max(0, totalBudget - totalSpent);
    return { projected, remaining, avg };
  }, [q.data, totalBudget, totalSpent]);

  if (q.isLoading) {
    return (
      <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-6">
          <Skeleton className="h-4 w-40" />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const goTxns = () => navigate({ to: "/transactions" });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Budget vs Actual"
          subtitle="Last 6 months"
          action={<DrillButton onClick={goTxns} />}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={budgetVsActual} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => compactINR(v)} />
              <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "#F1F5F9" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "#64748B" }} />
              <Bar dataKey="Budget" fill="#C7D2FE" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Spent" fill="#6366F1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Spending by Category" subtitle="This month">
          {donutData.length === 0 ? (
            <EmptyChart message="No spending recorded yet." />
          ) : (
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <div className="w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {donutData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<AnalyticsTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full space-y-1.5 sm:w-1/2">
                {donutData.map((d) => {
                  const pct = totalSpent > 0 ? (d.value / totalSpent) * 100 : 0;
                  return (
                    <div key={d.name} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                        <span className="truncate text-slate-700">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-2 tabular-nums text-slate-500">
                        <span>{pct.toFixed(1)}%</span>
                        <span className="font-medium text-slate-900">{formatINR(d.value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Monthly Trend" subtitle="Spending momentum">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendLine} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => compactINR(v)} />
              <Tooltip content={<AnalyticsTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "#64748B" }} />
              <Line type="monotone" dataKey="Spent" stroke="#6366F1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Budget" stroke="#94A3B8" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Category Comparison" subtitle="Top 6 by spend">
          {compareData.length === 0 ? (
            <EmptyChart message="Set budgets to compare against actuals." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart layout="vertical" data={compareData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => compactINR(v)} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fill: "#334155", fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "#F1F5F9" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "#64748B" }} />
                <Bar dataKey="Budget" fill="#C7D2FE" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Spent" fill="#6366F1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-100 pb-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900">Top overspending</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">Categories above their monthly cap</p>
            </div>
            <Badge className="rounded-full border-none bg-rose-50 text-xs text-rose-700">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {overspending.length}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            {overspending.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Nothing over budget yet. Nice work.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {overspending.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color || "#EF4444" }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{c.name}</div>
                        <div className="text-xs text-slate-500">
                          {formatINR(c.spent)} of {formatINR(c.budget)} · {c.pct.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                        +{formatINR(c.over)}
                      </span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700" onClick={goTxns} aria-label="View transactions">
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">Remaining budget forecast</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">Projected month-end vs plan</p>
          </CardHeader>
          <CardContent className="p-5">
            {!forecast ? (
              <EmptyChart message="Not enough history to forecast." />
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Projected spend</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">{formatINR(forecast.projected)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Remaining</div>
                    <div className={cn(
                      "mt-1 text-2xl font-semibold",
                      forecast.remaining === 0 ? "text-rose-600" : "text-emerald-600",
                    )}>
                      {formatINR(forecast.remaining)}
                    </div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={trendLine} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: "#64748B", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis hide />
                    <Tooltip content={<AnalyticsTooltip />} />
                    <Line type="monotone" dataKey="Spent" stroke="#6366F1" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {forecast.projected > totalBudget ? (
                    <TrendingUp className="h-3.5 w-3.5 text-rose-500" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
                  )}
                  Trailing average {formatINR(forecast.avg)} / month
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b border-slate-100 pb-3">
        <div>
          <CardTitle className="text-base font-semibold text-slate-900">{title}</CardTitle>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function DrillButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="h-8 rounded-lg text-xs text-slate-500 hover:text-slate-900">
      View transactions <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="grid h-56 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 text-sm text-slate-500">
      {message}
    </div>
  );
}

function AnalyticsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-medium text-slate-700">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.color }} />
            {p.name}
          </span>
          <span className="font-medium tabular-nums text-slate-900">{formatINR(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

function compactINR(v: number) {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)}Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)}L`;
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(0)}k`;
  return `₹${v}`;
}

export function Sparkline({ values, color = "#6366F1" }: { values: number[]; color?: string }) {
  if (!values.length) return <span className="text-xs text-slate-300">—</span>;
  const w = 72;
  const h = 24;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" points={pts} />
      <circle cx={(values.length - 1) * step} cy={h - ((values[values.length - 1] - min) / range) * (h - 4) - 2} r={2} fill={color} />
    </svg>
  );
}
