import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightIcon,
  Copy,
  Download,
  FileBarChart,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  copyPreviousMonth,
  deleteBudgetCategory,
  getBudgetForMonth,
  upsertBudgetCategory,
} from "@/lib/budgets.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/budgets")({
  head: () => ({
    meta: [
      { title: "Budget Planning — Paisa" },
      { name: "description", content: "Plan, track and forecast your monthly budget by category." },
    ],
  }),
  component: BudgetsPage,
});

// ---------- helpers ----------
function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function daysInfo(month: string) {
  const [y, m] = month.split("-").map(Number);
  const now = new Date();
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isThisMonth = now.getUTCFullYear() === y && now.getUTCMonth() + 1 === m;
  const isPast = now > new Date(Date.UTC(y, m, 1));
  const elapsed = isThisMonth ? now.getUTCDate() : isPast ? total : 0;
  const remaining = Math.max(0, total - elapsed);
  return { total, elapsed, remaining, isThisMonth };
}

type Row = Awaited<ReturnType<typeof getBudgetForMonth>>["categories"][number];
type Tree = Row & { children: Tree[]; totalBudget: number; totalSpent: number; totalPrev: number };

function buildTree(rows: Row[]): Tree[] {
  const byId = new Map<string, Tree>();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [], totalBudget: 0, totalSpent: 0, totalPrev: 0 }));
  const roots: Tree[] = [];
  byId.forEach((n) => {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children.push(n);
    else roots.push(n);
  });
  const roll = (n: Tree): { b: number; s: number; p: number } => {
    let b = Number(n.budget) || 0;
    let s = Number(n.spent) || 0;
    let p = Number(n.spent_last_month) || 0;
    for (const c of n.children) {
      const r = roll(c);
      b += r.b;
      s += r.s;
      p += r.p;
    }
    n.totalBudget = b;
    n.totalSpent = s;
    n.totalPrev = p;
    return { b, s, p };
  };
  roots.forEach(roll);
  roots.sort((a, b) => a.name.localeCompare(b.name));
  return roots;
}

function statusFor(spent: number, budget: number): { label: string; tone: "green" | "yellow" | "red" | "muted" } {
  if (budget <= 0) return { label: "No cap", tone: "muted" };
  const pct = spent / budget;
  if (pct >= 1) return { label: "Over", tone: "red" };
  if (pct >= 0.75) return { label: "Near", tone: "yellow" };
  return { label: "On track", tone: "green" };
}

// ---------- page ----------
function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth);
  const [period, setPeriod] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();
  const getFn = useServerFn(getBudgetForMonth);
  const upsertFn = useServerFn(upsertBudgetCategory);
  const deleteFn = useServerFn(deleteBudgetCategory);
  const copyFn = useServerFn(copyPreviousMonth);

  const q = useQuery({
    queryKey: ["budget", month],
    queryFn: () => getFn({ data: { month } }),
    staleTime: 30_000,
  });

  const upsertMut = useMutation({
    mutationFn: (v: { budget_id: string; category_id: string; amount: number }) => upsertFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget", month] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget", month] }),
  });
  const copyMut = useMutation({
    mutationFn: () => copyFn({ data: { month } }),
    onSuccess: (res) => {
      toast.success(res.copied ? `Copied ${res.copied} caps from last month` : "No previous month found");
      qc.invalidateQueries({ queryKey: ["budget", month] });
    },
  });

  const data = q.data;
  const tree = useMemo(() => (data ? buildTree(data.categories) : []), [data]);
  const anyBudgetSet = useMemo(
    () => (data?.categories ?? []).some((c) => Number(c.budget) > 0),
    [data],
  );

  const totals = useMemo(() => {
    let b = 0,
      s = 0,
      p = 0;
    for (const r of tree) {
      b += r.totalBudget;
      s += r.totalSpent;
      p += r.totalPrev;
    }
    return { budget: b, spent: s, prev: p };
  }, [tree]);

  const days = daysInfo(month);
  const projected =
    days.elapsed > 0 && days.isThisMonth ? (totals.spent / days.elapsed) * days.total : totals.spent;
  const utilization = totals.budget > 0 ? (totals.spent / totals.budget) * 100 : 0;
  const remaining = Math.max(0, totals.budget - totals.spent);
  const dailyRemaining = days.remaining > 0 ? remaining / days.remaining : 0;
  const momDelta = totals.prev > 0 ? ((totals.spent - totals.prev) / totals.prev) * 100 : 0;

  const filteredTree = useMemo(() => {
    if (!search.trim()) return tree;
    const q = search.trim().toLowerCase();
    const filter = (nodes: Tree[]): Tree[] =>
      nodes
        .map((n) => ({ ...n, children: filter(n.children) }))
        .filter((n) => n.name.toLowerCase().includes(q) || n.children.length > 0);
    return filter(tree);
  }, [tree, search]);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <StickyHeader
        month={month}
        setMonth={setMonth}
        period={period}
        setPeriod={setPeriod}
        onCopyPrev={() => copyMut.mutate()}
        copyPending={copyMut.isPending}
      />

      <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8 space-y-6">
        {q.isLoading ? (
          <LoadingState />
        ) : !anyBudgetSet && (data?.categories ?? []).every((c) => c.spent === 0) ? (
          <EmptyState
            month={month}
            onCopy={() => copyMut.mutate()}
            onCreate={() => {
              // scroll to table below
              document.getElementById("budget-table")?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        ) : (
          <>
            <KpiRow
              totalBudget={totals.budget}
              totalSpent={totals.spent}
              remaining={remaining}
              dailyRemaining={dailyRemaining}
              utilization={utilization}
              projected={projected}
              momDelta={momDelta}
            />

            <ProgressCard
              totalBudget={totals.budget}
              totalSpent={totals.spent}
              projected={projected}
              daysRemaining={days.remaining}
              daysTotal={days.total}
            />

            <Card id="budget-table" className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-3 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Category budgets</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {(data?.categories ?? []).length} categories · Click a budget cell to edit
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search categories"
                      className="h-9 w-56 rounded-xl border-slate-200 pl-8 text-sm"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl border-slate-200"
                    onClick={() => {
                      const all: Record<string, boolean> = {};
                      tree.forEach((r) => (all[r.id] = true));
                      setExpanded(all);
                    }}
                  >
                    Expand all
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <BudgetTable
                  rows={filteredTree}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  budgetId={data!.budget.id}
                  onSave={(row, amount) =>
                    upsertMut.mutate({ budget_id: data!.budget.id, category_id: row.id, amount })
                  }
                  onClear={(row) => {
                    if (row.budget_category_id) deleteMut.mutate(row.budget_category_id);
                  }}
                />
              </CardContent>
            </Card>

            <AnalyticsPlaceholder />
            <AiInsightsPlaceholder />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- header ----------
function StickyHeader({
  month,
  setMonth,
  period,
  setPeriod,
  onCopyPrev,
  copyPending,
}: {
  month: string;
  setMonth: (m: string) => void;
  period: "monthly" | "quarterly" | "annual";
  setPeriod: (p: "monthly" | "quarterly" | "annual") => void;
  onCopyPrev: () => void;
  copyPending: boolean;
}) {
  return (
    <div className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:px-8 md:py-4 lg:flex lg:flex-wrap lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <FileBarChart className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-slate-900">Monthly Budget</h1>
              <Badge variant="secondary" className="rounded-md bg-slate-100 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                {period}
              </Badge>
            </div>
            <p className="text-xs text-slate-500">Plan, track and forecast your spending</p>
          </div>
        </div>

        <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 lg:col-span-1">
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <Button variant="ghost" size="icon" aria-label="Previous month" className="h-8 w-8" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[8rem] px-2 text-center text-sm font-medium text-slate-800">{monthLabel(month)}</span>
            <Button variant="ghost" size="icon" aria-label="Next month" className="h-8 w-8" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
            <SelectTrigger className="h-9 w-[130px] rounded-xl border-slate-200 bg-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="annual">Annual</SelectItem>
            </SelectContent>
          </Select>

          <div className="hidden items-center gap-2 md:flex">
            <Button variant="outline" size="sm" className="h-9 rounded-xl border-slate-200" onClick={() => toast.message("Import coming in Phase 3")}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-xl border-slate-200" onClick={() => toast.message("Export coming in Phase 3")}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-xl border-slate-200" onClick={() => toast.message("AI Suggestions coming in Phase 3")}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> AI
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-xl border-slate-200" onClick={() => toast.message("Reports coming in Phase 2")}>
              <FileBarChart className="mr-1.5 h-3.5 w-3.5" /> Reports
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 rounded-xl bg-slate-900 text-white hover:bg-slate-800">
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Budget actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={onCopyPrev} disabled={copyPending}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Copy previous month
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.message("Duplicate coming in Phase 3")}>
                Duplicate budget
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.message("Rollover coming in Phase 3")}>
                Enable rollover
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => toast.message("Archive coming in Phase 3")} className="text-slate-500">
                Archive budget
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ---------- KPIs ----------
function KpiRow(props: {
  totalBudget: number;
  totalSpent: number;
  remaining: number;
  dailyRemaining: number;
  utilization: number;
  projected: number;
  momDelta: number;
}) {
  const items = [
    { label: "Total Budget", value: formatINR(props.totalBudget), sub: "Planned this month" },
    {
      label: "Total Spent",
      value: formatINR(props.totalSpent),
      sub:
        props.momDelta === 0
          ? "No last-month data"
          : `${props.momDelta > 0 ? "+" : ""}${props.momDelta.toFixed(1)}% vs last month`,
      trend: props.momDelta,
    },
    { label: "Remaining", value: formatINR(props.remaining), sub: "Left to spend" },
    { label: "Daily Remaining", value: formatINR(props.dailyRemaining), sub: "Per remaining day" },
    { label: "Utilization", value: `${props.utilization.toFixed(1)}%`, sub: "Of total budget" },
    { label: "Projected Spend", value: formatINR(props.projected), sub: "Month-end forecast" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <Card key={it.label} className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{it.label}</div>
            <div className="mt-1.5 truncate text-xl font-semibold text-slate-900">{it.value}</div>
            <div
              className={cn(
                "mt-1 flex items-center gap-1 text-[11px] text-slate-500",
                it.trend !== undefined && it.trend > 0 && "text-rose-600",
                it.trend !== undefined && it.trend < 0 && "text-emerald-600",
              )}
            >
              {it.trend !== undefined && it.trend !== 0 && (
                it.trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />
              )}
              <span className="truncate">{it.sub}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- progress ----------
function ProgressCard({
  totalBudget,
  totalSpent,
  projected,
  daysRemaining,
  daysTotal,
}: {
  totalBudget: number;
  totalSpent: number;
  projected: number;
  daysRemaining: number;
  daysTotal: number;
}) {
  const pct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
  const projectedPct = totalBudget > 0 ? Math.min(150, (projected / totalBudget) * 100) : 0;
  const health =
    pct >= 100 || projectedPct >= 110
      ? { label: "Over budget", tone: "bg-rose-500", text: "text-rose-600", chip: "bg-rose-50 text-rose-700" }
      : pct >= 75
        ? { label: "Approaching limit", tone: "bg-amber-500", text: "text-amber-600", chip: "bg-amber-50 text-amber-700" }
        : { label: "On track", tone: "bg-emerald-500", text: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700" };
  return (
    <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-slate-500">Overall progress</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-slate-900">{formatINR(totalSpent)}</span>
              <span className="text-sm text-slate-500">of {formatINR(totalBudget)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("rounded-full border-none px-2.5 py-1 text-xs font-medium", health.chip)}>{health.label}</Badge>
            <span className="text-xs text-slate-500">
              {daysRemaining} of {daysTotal} days left
            </span>
          </div>
        </div>

        <div className="relative mt-5 h-3 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all", health.tone)} style={{ width: `${pct}%` }} />
          {projectedPct > pct && (
            <div
              className="absolute inset-y-0 rounded-full bg-slate-900/10"
              style={{ left: `${pct}%`, width: `${Math.min(100, projectedPct) - pct}%` }}
              title="Projected"
            />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", health.tone)} /> Spent {pct.toFixed(1)}%</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" /> Forecast {projectedPct.toFixed(1)}%</span>
          <span className={cn("flex items-center gap-1.5 font-medium", health.text)}>Forecast {formatINR(projected)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- table ----------
function BudgetTable({
  rows,
  expanded,
  setExpanded,
  onSave,
  onClear,
}: {
  rows: Tree[];
  expanded: Record<string, boolean>;
  setExpanded: (v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  budgetId: string;
  onSave: (row: Tree, amount: number) => void;
  onClear: (row: Tree) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur">
          <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3 text-right">Budget</th>
            <th className="px-4 py-3 text-right">Spent</th>
            <th className="px-4 py-3 text-right">Remaining</th>
            <th className="px-4 py-3">Utilization</th>
            <th className="px-4 py-3 text-right">Last month</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                No categories match your search.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <RowGroup
              key={r.id}
              row={r}
              depth={0}
              expanded={expanded}
              setExpanded={setExpanded}
              onSave={onSave}
              onClear={onClear}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({
  row,
  depth,
  expanded,
  setExpanded,
  onSave,
  onClear,
}: {
  row: Tree;
  depth: number;
  expanded: Record<string, boolean>;
  setExpanded: (v: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onSave: (row: Tree, amount: number) => void;
  onClear: (row: Tree) => void;
}) {
  const isOpen = !!expanded[row.id];
  const hasChildren = row.children.length > 0;
  const displayBudget = hasChildren ? row.totalBudget : row.budget;
  const displaySpent = hasChildren ? row.totalSpent : row.spent;
  const displayPrev = hasChildren ? row.totalPrev : row.spent_last_month;
  const remaining = Math.max(0, displayBudget - displaySpent);
  const st = statusFor(displaySpent, displayBudget);
  const pct = displayBudget > 0 ? Math.min(100, (displaySpent / displayBudget) * 100) : 0;
  return (
    <>
      <tr className={cn("group border-t border-slate-100 hover:bg-slate-50/60", depth === 0 && "bg-white")}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
            {hasChildren ? (
              <button
                aria-label={isOpen ? "Collapse" : "Expand"}
                className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setExpanded((p) => ({ ...p, [row.id]: !p[row.id] }))}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
              </button>
            ) : (
              <span className="h-5 w-5" />
            )}
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: row.color ?? "#CBD5E1" }}
            />
            <span className={cn("truncate", depth === 0 ? "font-medium text-slate-900" : "text-slate-700")}>
              {row.name}
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          {hasChildren ? (
            <span className="font-medium text-slate-900">{formatINR(displayBudget)}</span>
          ) : (
            <BudgetCell value={row.budget} onSave={(n) => onSave(row, n)} onClear={() => onClear(row)} />
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-800">{formatINR(displaySpent)}</td>
        <td className={cn("px-4 py-3 text-right tabular-nums", remaining === 0 && displayBudget > 0 ? "text-rose-600" : "text-slate-800")}>
          {formatINR(remaining)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full",
                  st.tone === "green" && "bg-emerald-500",
                  st.tone === "yellow" && "bg-amber-500",
                  st.tone === "red" && "bg-rose-500",
                  st.tone === "muted" && "bg-slate-300",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs tabular-nums text-slate-500">{pct.toFixed(0)}%</span>
          </div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatINR(displayPrev)}</td>
        <td className="px-4 py-3">
          <StatusBadge tone={st.tone} label={st.label} />
        </td>
        <td className="px-4 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Row actions" className="h-7 w-7 text-slate-400 hover:text-slate-700">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => toast.message("Transactions view coming soon")}>
                View transactions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.message("Move budget coming in Phase 3")}>
                Move budget
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.message("Notes coming in Phase 3")}>
                Add notes
              </DropdownMenuItem>
              {!hasChildren && row.budget_category_id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onClear(row)} className="text-rose-600">
                    Clear budget
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      {isOpen &&
        row.children.map((c) => (
          <RowGroup key={c.id} row={c} depth={depth + 1} expanded={expanded} setExpanded={setExpanded} onSave={onSave} onClear={onClear} />
        ))}
    </>
  );
}

function StatusBadge({ tone, label }: { tone: "green" | "yellow" | "red" | "muted"; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "yellow" && "bg-amber-50 text-amber-700",
        tone === "red" && "bg-rose-50 text-rose-700",
        tone === "muted" && "bg-slate-100 text-slate-500",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "green" && "bg-emerald-500",
          tone === "yellow" && "bg-amber-500",
          tone === "red" && "bg-rose-500",
          tone === "muted" && "bg-slate-400",
        )}
      />
      {label}
    </span>
  );
}

function BudgetCell({ value, onSave, onClear }: { value: number; onSave: (n: number) => void; onClear: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value || ""));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  useEffect(() => setDraft(String(value || "")), [value]);

  const commit = () => {
    const n = Number(draft.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      setDraft(String(value || ""));
      setEditing(false);
      return;
    }
    if (n !== value) {
      if (n === 0) onClear();
      else onSave(n);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(String(value || ""));
            setEditing(false);
          }
        }}
        inputMode="decimal"
        className="w-28 rounded-md border border-indigo-300 bg-white px-2 py-1 text-right text-sm text-slate-900 outline-none ring-2 ring-indigo-100"
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className={cn(
        "inline-flex w-28 items-center justify-end rounded-md px-2 py-1 text-right tabular-nums",
        value > 0 ? "text-slate-900 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100",
      )}
    >
      {value > 0 ? formatINR(value) : "Set budget"}
    </button>
  );
}

// ---------- placeholders / empty / loading ----------
function AnalyticsPlaceholder() {
  return (
    <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-900">Analytics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
          <p>Charts (Budget vs Actual, Spending by Category, Monthly Trend, Top Overspending) arrive in Phase 2.</p>
        </div>
      </CardContent>
    </Card>
  );
}
function AiInsightsPlaceholder() {
  return (
    <Card className="rounded-2xl border-slate-200/70 bg-gradient-to-br from-indigo-50 via-white to-violet-50 shadow-sm">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Sparkles className="h-4 w-4 text-indigo-600" />
        <CardTitle className="text-base font-semibold text-slate-900">AI budget insights</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-600">
          Personalized suggestions (overspend alerts, savings capacity, subscription changes) arrive in Phase 3 with one-click actions.
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ month, onCopy, onCreate }: { month: string; onCopy: () => void; onCreate: () => void }) {
  return (
    <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
      <CardContent className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <FileBarChart className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">No budget for {monthLabel(month)}</h2>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Create your first monthly plan by setting caps per category, or copy last month to keep going where you left off.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onCreate} className="rounded-xl bg-slate-900 hover:bg-slate-800">
            <Plus className="mr-1.5 h-4 w-4" /> Set category budgets
          </Button>
          <Button onClick={onCopy} variant="outline" className="rounded-xl border-slate-200">
            <Copy className="mr-1.5 h-4 w-4" /> Copy previous month
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
            <CardContent className="p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-24" />
              <Skeleton className="mt-2 h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-slate-200/70 bg-white shadow-sm">
        <CardContent className="space-y-3 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    </>
  );
}
