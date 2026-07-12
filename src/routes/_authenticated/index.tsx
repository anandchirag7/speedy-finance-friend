import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDownRight, ArrowUpRight, PiggyBank, Wallet, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDashboard } from "@/lib/finance.functions";
import { formatINR, formatLakhCrore } from "@/lib/format";
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

function Dashboard() {
  const fn = useServerFn(getDashboard);
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: fn });

  if (isLoading) {
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
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

      {/* This month */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<ArrowUpRight className="h-4 w-4" />}
          label="Income this month"
          value={formatINR(d.income)}
          tone="success"
        />
        <MetricCard
          icon={<ArrowDownRight className="h-4 w-4" />}
          label="Expenses this month"
          value={formatINR(d.expense)}
          tone="destructive"
        />
        <MetricCard
          icon={<PiggyBank className="h-4 w-4" />}
          label="Savings"
          value={formatINR(d.savings)}
          tone={d.savings >= 0 ? "success" : "destructive"}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assets by category</CardTitle>
            <CardDescription>Where your money lives</CardDescription>
          </CardHeader>
          <CardContent>
            {catData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No assets yet.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={catData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {catData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any) => formatINR(Number(v))}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {catData.map((c, i) => (
                    <div key={c.name} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-muted-foreground">{c.name}</span>
                      <span className="tabular-nums">{formatLakhCrore(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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

      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <TrendingUp className="h-3 w-3" /> Monthly net-worth snapshots and trend chart arrive in the next phase.
      </div>
    </div>
  );
}

function StatCell({ label, value, accent, isCount }: { label: string; value: number; accent?: "success" | "destructive"; isCount?: boolean }) {
  const color = accent === "success" ? "text-success" : accent === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>
        {isCount ? value : formatINR(value)}
      </p>
    </div>
  );
}

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "success" | "destructive" }) {
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
