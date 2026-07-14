import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  PiggyBank,
  Wallet,
  CalendarClock,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDashboard } from "@/lib/finance.functions";
import { formatINR, formatLakhCrore, formatDate } from "@/lib/format";
import { ACCOUNT_TYPE_BY_CATEGORY } from "@/lib/account-types";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Paisa" }] }),
  component: Dashboard,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

function Dashboard() {
  const fn = useServerFn(getDashboard);
  const [range, setRange] = useState<"1m" | "3m" | "6m" | "1y" | "ytd">("1m");
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", range],
    queryFn: () => fn({ data: { range } }),
  });

  if (isLoading && !data) {

    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  const d = data as any;
  const empty = !d || d.accountsCount === 0;

  if (empty) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent">
          <Wallet className="h-7 w-7" />
        </div>
        <h2 className="font-display text-2xl font-semibold">Let's set up your money picture</h2>
        <p className="mt-2 text-muted-foreground">
          Add your bank accounts, investments, and loans. Paisa will tie it all into one net-worth view.
        </p>
        <Button asChild className="mt-6" size="lg">
          <Link to="/accounts">Add your first account</Link>
        </Button>
      </div>
    );
  }

  const catData = Object.entries(d.byCategory as Record<string, number>).map(([k, v]) => ({
    name: ACCOUNT_TYPE_BY_CATEGORY[k as keyof typeof ACCOUNT_TYPE_BY_CATEGORY]?.label ?? k,
    value: v,
  }));

  const topSpend = Object.entries(d.spendByCat as Record<string, number>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const trend = (d.netWorthTrend ?? []) as Array<{ label: string; netWorth: number }>;
  const trendChange =
    trend.length >= 2
      ? trend[trend.length - 1].netWorth - trend[0].netWorth
      : 0;
  const trendPct =
    trend.length >= 2 && trend[0].netWorth !== 0
      ? (trendChange / Math.abs(trend[0].netWorth)) * 100
      : 0;

  const rangeLabels: Record<typeof range, string> = {
    "1m": "this month",
    "3m": "last 3 months",
    "6m": "last 6 months",
    "1y": "last 12 months",
    ytd: "year to date",
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      {/* Range switcher */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Showing <span className="text-foreground font-medium">{rangeLabels[range]}</span>
        </p>
        <ToggleGroup
          type="single"
          size="sm"
          value={range}
          onValueChange={(v) => v && setRange(v as typeof range)}
          className="rounded-lg border bg-card p-0.5"
        >
          <ToggleGroupItem value="1m" className="h-7 px-2.5 text-xs">1M</ToggleGroupItem>
          <ToggleGroupItem value="3m" className="h-7 px-2.5 text-xs">3M</ToggleGroupItem>
          <ToggleGroupItem value="6m" className="h-7 px-2.5 text-xs">6M</ToggleGroupItem>
          <ToggleGroupItem value="1y" className="h-7 px-2.5 text-xs">1Y</ToggleGroupItem>
          <ToggleGroupItem value="ytd" className="h-7 px-2.5 text-xs">YTD</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Hero */}
      <div className="rounded-2xl border bg-card p-6 md:p-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Total Net Worth</p>
        <p className="mt-2 font-display text-4xl md:text-5xl font-semibold tabular-nums">
          {formatINR(d.netWorth)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{formatLakhCrore(d.netWorth)}</p>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCell label="Assets" value={d.assets} accent="success" />
          <StatCell label="Liabilities" value={d.liabilities} accent="destructive" />
          <StatCell label="Accounts" value={d.accountsCount} isCount />
        </div>
      </div>

      {/* Range metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<ArrowUpRight className="h-4 w-4" />}
          label={`Income · ${rangeLabels[range]}`}
          value={formatINR(d.income)}
          tone="success"
        />
        <MetricCard
          icon={<ArrowDownRight className="h-4 w-4" />}
          label={`Expenses · ${rangeLabels[range]}`}
          value={formatINR(d.expense)}
          tone="destructive"
        />
        <MetricCard
          icon={<PiggyBank className="h-4 w-4" />}
          label={`Savings · ${rangeLabels[range]}`}
          value={formatINR(d.savings)}
          tone={d.savings >= 0 ? "success" : "destructive"}
        />
      </div>



      {/* Net worth trend + Cash flow */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Net worth trend</CardTitle>
                <CardDescription>Recent snapshots</CardDescription>
              </div>
              {trend.length >= 2 && (
                <div className={`text-right text-xs ${trendChange >= 0 ? "text-success" : "text-destructive"}`}>
                  <div className="tabular-nums font-medium">
                    {trendChange >= 0 ? "+" : ""}
                    {formatLakhCrore(trendChange)}
                  </div>
                  <div className="tabular-nums opacity-80">
                    {trendPct >= 0 ? "+" : ""}
                    {trendPct.toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {trend.length < 2 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Snapshots will build up over time. Showing today's value.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer>
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatLakhCrore(v as number)}
                      width={60}
                    />
                    <Tooltip
                      formatter={(v: any) => formatINR(Number(v))}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Area
                      type="monotone"
                      dataKey="netWorth"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="url(#nwFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Income vs expenses</CardTitle>
            <CardDescription>Cash flow · {rangeLabels[range]}</CardDescription>
          </CardHeader>
          <CardContent>
            {(d.cashFlow ?? []).length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={d.cashFlow} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatLakhCrore(v as number)}
                      width={60}
                    />
                    <Tooltip
                      formatter={(v: any) => formatINR(Number(v))}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="income" name="Income" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Expenses" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming bills + Assets by category */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" /> Upcoming bills
                </CardTitle>
                <CardDescription>Next 30 days</CardDescription>
              </div>
              {(d.upcomingBills ?? []).length > 0 && (
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Total due</div>
                  <div className="text-sm font-semibold tabular-nums">
                    {formatINR(d.upcomingBillsTotal)}
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {(d.upcomingBills ?? []).length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nothing due in the next 30 days.
                <div className="mt-3">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/bills">Manage bills</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="divide-y">
                {d.upcomingBills.map((b: any) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{b.name}</p>
                        {b.overdue && (
                          <Badge variant="destructive" className="h-5 gap-1 px-1.5 text-[10px]">
                            <AlertCircle className="h-3 w-3" /> Overdue
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(b.due_date)}
                        {b.accountName ? ` · ${b.accountName}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">{formatINR(b.amount)}</div>
                      <div
                        className={`text-[11px] tabular-nums ${
                          b.overdue
                            ? "text-destructive"
                            : b.daysUntil <= 3
                            ? "text-warning"
                            : "text-muted-foreground"
                        }`}
                      >
                        {b.overdue
                          ? `${Math.abs(b.daysUntil)}d late`
                          : b.daysUntil === 0
                          ? "Today"
                          : `in ${b.daysUntil}d`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assets by category</CardTitle>
            <CardDescription>Where your money lives</CardDescription>
          </CardHeader>
          <CardContent>
            {catData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No assets yet.</p>
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={catData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {catData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: any) => formatINR(Number(v))}
                        contentStyle={TOOLTIP_STYLE}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {catData.map((c, i) => (
                    <div key={c.name} className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="text-muted-foreground">{c.name}</span>
                      <span className="tabular-nums">{formatLakhCrore(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top spending */}
      <Card>
        <CardHeader>
          <CardTitle>Top spending this month</CardTitle>
          <CardDescription>Where your outflow is going</CardDescription>
        </CardHeader>
        <CardContent>
          {topSpend.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No expenses recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {topSpend.map(([name, amt]) => {
                const pct = d.expense > 0 ? (amt / d.expense) * 100 : 0;
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between text-sm">
                      <span>{name}</span>
                      <span className="tabular-nums text-muted-foreground">{formatINR(amt)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
  isCount,
}: {
  label: string;
  value: number;
  accent?: "success" | "destructive";
  isCount?: boolean;
}) {
  const color =
    accent === "success" ? "text-success" : accent === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>
        {isCount ? value : formatINR(value)}
      </p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "success" | "destructive";
}) {
  const toneClass = tone === "success" ? "text-success" : "text-destructive";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={toneClass}>{icon}</span>
          {label}
        </div>
        <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
