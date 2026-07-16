import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Pencil, RefreshCw,
  Download, MoreHorizontal, Plus, Search, Filter, Settings2, Sparkles, Flag,
  CheckCircle2, Star, Trash2, Save, ChevronDown, Wallet, TrendingUp, TrendingDown,
  Calendar as CalendarIcon, ClipboardCheck, FileSpreadsheet, Printer, Bell,
  Zap, LayoutGrid, LineChart as LineIcon, BarChart3, PieChart as PieIcon, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatLakhCrore, maskAccount } from "@/lib/format";
import { ACCOUNT_TYPE_BY_CATEGORY } from "@/lib/account-types";
import { listAccounts, listCategories } from "@/lib/finance.functions";
import {
  listTransactionsRich, patchTransaction, bulkPatchTransactions,
  bulkDeleteTransactions, getTransactionDetail, addComment, generateAIInsights,
} from "@/lib/transactions.functions";
import { AccountFormDialog } from "@/components/account-form-dialog";
import { FastEntryDialog } from "@/components/fast-entry-dialog";

export const Route = createFileRoute("/_authenticated/accounts/$accountId")({
  head: ({ params }) => ({
    meta: [{ title: `Account · Register — Paisa` }, { name: "description", content: `Register, insights, and reconciliation for account ${params.accountId}` }],
  }),
  component: AccountRegisterPage,
});

/* --------------------------------- types -------------------------------- */
type Txn = {
  id: string; account_id: string; transfer_account_id: string | null;
  category_id: string | null; type: "income" | "expense" | "transfer";
  amount: number; txn_date: string;
  note: string | null; memo: string | null; merchant: string | null;
  payment_method: string | null; check_number: string | null;
  tags: string[] | null; tax_code: string | null;
  cleared_status: "pending" | "cleared" | "reconciled";
  is_flagged: boolean; is_favorite: boolean; is_reviewed: boolean; is_read: boolean;
  attachment_count: number; comment_count: number; created_at: string;
  category?: { id: string; name: string; kind: string; color?: string | null; icon?: string | null } | null;
  account?: { id: string; name: string; currency: string; institution?: string | null } | null;
  transfer_account?: { id: string; name: string } | null;
};
type Range = "7d" | "30d" | "mtd" | "quarter" | "ytd" | "all" | "custom";
const RANGE_LABEL: Record<Range, string> = {
  "7d": "Last 7 days", "30d": "Last 30 days", mtd: "Month to date",
  quarter: "This quarter", ytd: "Year to date", all: "All time", custom: "Custom",
};

function computeRange(r: Range, cs?: string, ce?: string) {
  const now = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = iso(now);
  if (r === "all") return { start: undefined, end: undefined };
  if (r === "7d") { const d = new Date(now); d.setDate(d.getDate() - 6); return { start: iso(d), end }; }
  if (r === "30d") { const d = new Date(now); d.setDate(d.getDate() - 29); return { start: iso(d), end }; }
  if (r === "mtd") return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end };
  if (r === "quarter") { const q = Math.floor(now.getMonth() / 3); return { start: iso(new Date(now.getFullYear(), q * 3, 1)), end }; }
  if (r === "ytd") return { start: iso(new Date(now.getFullYear(), 0, 1)), end };
  return { start: cs || undefined, end: ce || undefined };
}

/* -------------------------------- page --------------------------------- */
function AccountRegisterPage() {
  const { accountId } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();

  // ---- server fns
  const accountsFn = useServerFn(listAccounts);
  const categoriesFn = useServerFn(listCategories);
  const listFn = useServerFn(listTransactionsRich);
  const patchFn = useServerFn(patchTransaction);
  const bulkPatchFn = useServerFn(bulkPatchTransactions);
  const bulkDelFn = useServerFn(bulkDeleteTransactions);
  const aiFn = useServerFn(generateAIInsights);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => accountsFn() });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesFn() });
  const account = accounts.find((a: any) => a.id === accountId);

  // ---- filters
  const [range, setRange] = useState<Range>("ytd");
  const [customStart, setCustomStart] = useState(""); const [customEnd, setCustomEnd] = useState("");
  const dateRange = useMemo(() => computeRange(range, customStart, customEnd), [range, customStart, customEnd]);
  const [types, setTypes] = useState<("income" | "expense" | "transfer")[]>([]);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [status, setStatus] = useState<("pending" | "cleared" | "reconciled")[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 220); return () => clearTimeout(t); }, [search]);

  // ---- register
  const [sortKey, setSortKey] = useState<"date" | "amount" | "merchant">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editAccountOpen, setEditAccountOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [density, setDensity] = useState<"compact" | "comfortable" | "spacious">("comfortable");
  const [chartTab, setChartTab] = useState<"balance" | "cashflow" | "compare" | "category">("balance");

  // ---- query txns
  const listArgs = useMemo(() => ({
    data: {
      accountIds: [accountId],
      categoryIds: selectedCats.length ? selectedCats : undefined,
      types: types.length ? types : undefined,
      startDate: dateRange.start, endDate: dateRange.end,
      search: debounced || undefined,
      cleared: status.length ? status : undefined,
      flagged: flaggedOnly ? ("yes" as const) : ("any" as const),
      reviewed: unreviewedOnly ? ("no" as const) : ("any" as const),
      limit: 1000,
    },
  }), [accountId, selectedCats, types, dateRange, debounced, status, flaggedOnly, unreviewedOnly]);

  const { data: txns = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["acct-txns", accountId, listArgs],
    queryFn: () => listFn(listArgs) as Promise<Txn[]>,
    enabled: !!accountId,
  });

  // ---- sort
  const sorted = useMemo(() => {
    const arr = [...txns];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at);
      else if (sortKey === "amount") cmp = Number(a.amount) - Number(b.amount);
      else cmp = (a.merchant ?? "").localeCompare(b.merchant ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [txns, sortKey, sortDir]);

  // ---- running balance (works in date-desc order)
  const opening = Number(account?.opening_balance ?? 0);
  const withRunning = useMemo(() => {
    // Compute chronological running balance first, then map back.
    const chrono = [...sorted].sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at));
    let bal = opening;
    const map = new Map<string, number>();
    for (const t of chrono) {
      const amt = Number(t.amount);
      const sign = t.type === "income" ? 1 : t.type === "expense" ? -1 : 0;
      bal += sign * amt;
      map.set(t.id, bal);
    }
    return sorted.map((t) => ({ ...t, running: map.get(t.id) ?? 0 }));
  }, [sorted, opening]);

  // ---- KPIs
  const kpis = useMemo(() => computeKpis(txns, account), [txns, account]);
  const balanceSeries = useMemo(() => buildBalanceSeries(txns, opening), [txns, opening]);
  const flowSeries = useMemo(() => buildFlowSeries(txns), [txns]);
  const categorySeries = useMemo(() => buildCategorySeries(txns), [txns]);

  // ---- mutations
  const patchM = useMutation({
    mutationFn: (v: { id: string; patch: any }) => patchFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acct-txns"] }); qc.invalidateQueries({ queryKey: ["txn-detail"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });
  const bulkPatchM = useMutation({
    mutationFn: (v: { ids: string[]; patch: any }) => bulkPatchFn({ data: v }),
    onSuccess: (r: any) => { toast.success(`Updated ${r.count} transactions`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["acct-txns"] }); },
  });
  const bulkDelM = useMutation({
    mutationFn: (ids: string[]) => bulkDelFn({ data: { ids } }),
    onSuccess: (r: any) => { toast.success(`Deleted ${r.count} transactions`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["acct-txns"] }); },
  });

  // ---- AI insights
  const [insights, setInsights] = useState<{ severity: string; title: string; detail: string }[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const runInsights = async () => {
    setInsightsLoading(true);
    try { const r = await aiFn({ data: { window: "30d", accountIds: [accountId] } as any }); setInsights((r as any).insights); }
    catch { toast.error("Couldn't generate insights"); } finally { setInsightsLoading(false); }
  };

  const typeDef = account ? ACCOUNT_TYPE_BY_CATEGORY[account.category as keyof typeof ACCOUNT_TYPE_BY_CATEGORY] : null;
  const bal = Number(account?.current_balance ?? 0);
  const isLiability = !!account?.is_liability;
  const currency = account?.currency ?? "INR";

  if (!account && accounts.length) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center">
        <p className="text-lg font-medium">Account not found</p>
        <Button asChild variant="outline" className="mt-4"><Link to="/accounts">Back to accounts</Link></Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[oklch(0.975_0.005_240)] dark:bg-background">
      <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
        {/* ── breadcrumb ── */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button onClick={() => router.history.back()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent">
            <ArrowLeft className="h-3.5 w-3.5" /> Accounts
          </button>
          <span>/</span>
          <span className="truncate text-foreground">{account?.name}</span>
        </div>

        {/* ── account header ── */}
        <div className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4 min-w-0">
              <div className={cn(
                "flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-semibold shrink-0",
                isLiability ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
              )}>
                {account?.institution?.[0] ?? account?.name?.[0] ?? "A"}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate font-display text-2xl font-semibold tracking-tight md:text-3xl">{account?.name ?? <Skeleton className="inline-block h-8 w-40" />}</h1>
                  {account?.is_active === false && <Badge variant="secondary">Archived</Badge>}
                  {account?.excluded_from_net_worth && <Badge variant="outline">Off-NW</Badge>}
                  <Badge variant="outline" className="gap-1">
                    <span className={cn("h-1.5 w-1.5 rounded-full", isFetching ? "bg-amber-500" : "bg-emerald-500")} />
                    {isFetching ? "Syncing" : "Live"}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {typeDef?.label}
                  {account?.subtype ? ` · ${account.subtype}` : ""}
                  {account?.institution ? ` · ${account.institution}` : ""}
                  {account?.account_number_last4 ? ` · ${maskAccount(account.account_number_last4)}` : ""}
                  {` · ${currency}`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-[auto_auto] md:gap-6">
              <div className="rounded-xl border bg-background/60 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Current Balance</p>
                <p className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", isLiability && bal > 0 ? "text-red-600" : "")}>
                  {isLiability && bal > 0 ? "-" : ""}{formatCurrency(bal, currency)}
                </p>
              </div>
              <div className="rounded-xl border bg-background/60 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Opening</p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-muted-foreground">
                  {formatCurrency(opening, currency)}
                </p>
              </div>
            </div>
          </div>

          {/* actions row */}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Add transaction</Button>
            <Button size="sm" variant="outline" onClick={() => setEditAccountOpen(true)}><Pencil className="mr-1.5 h-4 w-4" />Edit account</Button>
            <Button size="sm" variant="outline"><ArrowLeftRight className="mr-1.5 h-4 w-4" />Transfer</Button>
            <Button size="sm" variant="outline"><ArrowUpRight className="mr-1.5 h-4 w-4 text-emerald-600" />Deposit</Button>
            <Button size="sm" variant="outline"><ArrowDownRight className="mr-1.5 h-4 w-4 text-red-600" />Withdraw</Button>
            <Button size="sm" variant="outline"><ClipboardCheck className="mr-1.5 h-4 w-4" />Reconcile</Button>
            <Button size="sm" variant="outline" onClick={() => exportCsv(withRunning, account?.name ?? "account")}><Download className="mr-1.5 h-4 w-4" />Export</Button>
            <Sheet open={commandOpen} onOpenChange={setCommandOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline"><MoreHorizontal className="mr-1.5 h-4 w-4" />More</Button>
              </SheetTrigger>
              <CommandPanel account={account} />
            </Sheet>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={cn("mr-1.5 h-4 w-4", isFetching && "animate-spin")} /> Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* ── KPI grid ── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <KpiCard label="Income (MTD)" value={formatCurrency(kpis.incomeMTD, currency)} trend={kpis.incomeDelta} tone="pos" spark={kpis.spark.income} />
          <KpiCard label="Expenses (MTD)" value={formatCurrency(kpis.expenseMTD, currency)} trend={kpis.expenseDelta} tone="neg" spark={kpis.spark.expense} />
          <KpiCard label="Net Cash Flow" value={formatCurrency(kpis.net, currency)} tone={kpis.net >= 0 ? "pos" : "neg"} spark={kpis.spark.net} />
          <KpiCard label="Avg Daily Balance" value={formatLakhCrore(kpis.avgDaily)} tone="neutral" spark={balanceSeries.map(p => p.v)} />
          <KpiCard label="Largest Expense" value={formatCurrency(kpis.largestExpense, currency)} tone="neg" />
          <KpiCard label="Largest Deposit" value={formatCurrency(kpis.largestDeposit, currency)} tone="pos" />
          <KpiCard label="Transactions" value={String(txns.length)} tone="neutral" />
          <KpiCard label="Pending" value={String(kpis.pending)} tone="neutral" hint={kpis.pending ? "Needs review" : "All cleared"} />
          <KpiCard label="Monthly Savings" value={formatCurrency(Math.max(0, kpis.incomeMTD - kpis.expenseMTD), currency)} tone="pos" />
          <KpiCard label="Reviewed" value={`${kpis.reviewedPct}%`} tone={kpis.reviewedPct >= 80 ? "pos" : "neutral"} />
          <KpiCard label="Attachments" value={String(kpis.withAttach)} tone="neutral" />
          <KpiCard label="Flagged" value={String(kpis.flagged)} tone={kpis.flagged ? "warn" : "neutral"} />
        </div>

        {/* ── filter toolbar ── */}
        <div className="sticky top-0 z-20 -mx-4 border-y bg-background/80 px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border md:px-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* date range */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><CalendarIcon className="mr-1.5 h-4 w-4" />{RANGE_LABEL[range]}<ChevronDown className="ml-1 h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(RANGE_LABEL) as Range[]).map((k) => (
                  <DropdownMenuItem key={k} onClick={() => setRange(k)}>{RANGE_LABEL[k]}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* type multi */}
            <MultiPopover
              label="Type"
              options={[{ v: "income", l: "Income" }, { v: "expense", l: "Expense" }, { v: "transfer", l: "Transfer" }]}
              values={types} onChange={(v) => setTypes(v as any)}
            />

            {/* category multi */}
            <CategoryMulti categories={categories} values={selectedCats} onChange={setSelectedCats} />

            {/* status */}
            <MultiPopover
              label="Status"
              options={[{ v: "pending", l: "Pending" }, { v: "cleared", l: "Cleared" }, { v: "reconciled", l: "Reconciled" }]}
              values={status} onChange={(v) => setStatus(v as any)}
            />

            <Button size="sm" variant={flaggedOnly ? "default" : "outline"} onClick={() => setFlaggedOnly(!flaggedOnly)}>
              <Flag className="mr-1.5 h-4 w-4" />Flagged
            </Button>
            <Button size="sm" variant={unreviewedOnly ? "default" : "outline"} onClick={() => setUnreviewedOnly(!unreviewedOnly)}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />Needs review
            </Button>

            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search merchant, memo, reference…" className="h-9 pl-8" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline"><Settings2 className="mr-1.5 h-4 w-4" />Density</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Row density</DropdownMenuLabel>
                {(["compact", "comfortable", "spacious"] as const).map((d) => (
                  <DropdownMenuCheckboxItem key={d} checked={density === d} onCheckedChange={() => setDensity(d)} className="capitalize">{d}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {(types.length || selectedCats.length || status.length || flaggedOnly || unreviewedOnly || search) ? (
              <Button size="sm" variant="ghost" onClick={() => { setTypes([]); setSelectedCats([]); setStatus([]); setFlaggedOnly(false); setUnreviewedOnly(false); setSearch(""); }}>
                <X className="mr-1 h-3.5 w-3.5" />Reset
              </Button>
            ) : null}
          </div>
        </div>

        {/* ── insights + chart + AI ── */}
        <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <Tabs value={chartTab} onValueChange={(v) => setChartTab(v as any)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="balance"><LineIcon className="mr-1.5 h-3.5 w-3.5" />Balance</TabsTrigger>
                  <TabsTrigger value="cashflow"><BarChart3 className="mr-1.5 h-3.5 w-3.5" />Cash Flow</TabsTrigger>
                  <TabsTrigger value="compare"><LayoutGrid className="mr-1.5 h-3.5 w-3.5" />In vs Out</TabsTrigger>
                  <TabsTrigger value="category"><PieIcon className="mr-1.5 h-3.5 w-3.5" />Categories</TabsTrigger>
                </TabsList>
                <p className="text-xs text-muted-foreground">{txns.length} txns · {dateRange.start ?? "beginning"} → {dateRange.end ?? "today"}</p>
              </div>
              <div className="mt-4 h-[280px]">
                {isLoading ? <Skeleton className="h-full w-full" /> : (
                  <>
                    <TabsContent value="balance" className="h-full mt-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={balanceSeries}>
                          <defs>
                            <linearGradient id="balGrad" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="oklch(0.6 0.14 200)" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="oklch(0.6 0.14 200)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="d" tick={{ fontSize: 11 }} minTickGap={40} />
                          <YAxis tickFormatter={(v) => formatLakhCrore(v)} tick={{ fontSize: 11 }} width={60} />
                          <RTooltip content={<ChartTip currency={currency} />} />
                          <Area type="monotone" dataKey="v" stroke="oklch(0.55 0.14 200)" fill="url(#balGrad)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="cashflow" className="h-full mt-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={flowSeries}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="d" tick={{ fontSize: 11 }} minTickGap={30} />
                          <YAxis tickFormatter={(v) => formatLakhCrore(v)} tick={{ fontSize: 11 }} width={60} />
                          <RTooltip content={<ChartTip currency={currency} />} />
                          <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                            {flowSeries.map((p, i) => <Cell key={i} fill={p.net >= 0 ? "oklch(0.55 0.14 155)" : "oklch(0.55 0.18 25)"} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="compare" className="h-full mt-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={flowSeries}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                          <XAxis dataKey="d" tick={{ fontSize: 11 }} minTickGap={30} />
                          <YAxis tickFormatter={(v) => formatLakhCrore(v)} tick={{ fontSize: 11 }} width={60} />
                          <RTooltip content={<ChartTip currency={currency} />} />
                          <Line type="monotone" dataKey="in" stroke="oklch(0.55 0.14 155)" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="out" stroke="oklch(0.55 0.18 25)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="category" className="h-full mt-0">
                      <div className="grid h-full grid-cols-[220px_1fr] gap-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={categorySeries} dataKey="v" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                              {categorySeries.map((s, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Pie>
                            <RTooltip content={<ChartTip currency={currency} />} />
                          </PieChart>
                        </ResponsiveContainer>
                        <ScrollArea className="h-[260px] pr-2">
                          <div className="space-y-1.5">
                            {categorySeries.slice(0, 12).map((s, i) => (
                              <div key={s.name} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                                  <span className="truncate">{s.name}</span>
                                </div>
                                <span className="tabular-nums">{formatCurrency(s.v, currency)}</span>
                              </div>
                            ))}
                            {categorySeries.length === 0 && <p className="p-4 text-sm text-muted-foreground">No spending in range.</p>}
                          </div>
                        </ScrollArea>
                      </div>
                    </TabsContent>
                  </>
                )}
              </div>
            </Tabs>
          </div>

          {/* AI insights */}
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="font-medium">AI Insights</p>
              </div>
              <Button size="sm" variant="outline" onClick={runInsights} disabled={insightsLoading}>
                {insightsLoading ? "Analyzing…" : "Generate"}
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {insights?.length ? insights.map((it, i) => (
                <div key={i} className={cn(
                  "rounded-lg border p-3 text-sm",
                  it.severity === "warning" && "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
                  it.severity === "success" && "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
                  it.severity === "info" && "bg-muted/30",
                )}>
                  <p className="font-medium">{it.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{it.detail}</p>
                </div>
              )) : (
                <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                  Tap Generate for personalized observations on cash flow, subscriptions, unusual spend, and savings signal.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── register ── */}
        <div className="rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <p className="font-medium">Register</p>
              <Badge variant="secondary" className="text-xs">{withRunning.length} rows</Badge>
              {selected.size > 0 && <Badge className="text-xs">{selected.size} selected</Badge>}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Sort:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    {sortKey} · {sortDir}<ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSortKey("date")}>Date</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortKey("amount")}>Amount</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortKey("merchant")}>Merchant</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}>Toggle direction</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
          ) : withRunning.length === 0 ? (
            <EmptyState onAdd={() => setAddOpen(true)} hasFilters={!!(types.length || selectedCats.length || search)} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-[57px] z-10 bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-9 px-3 py-2 text-left">
                      <Checkbox
                        checked={selected.size > 0 && selected.size === withRunning.length}
                        onCheckedChange={(v) => setSelected(v ? new Set(withRunning.map(t => t.id)) : new Set())}
                      />
                    </th>
                    <th className="w-8 px-1"></th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Merchant / Memo</th>
                    <th className="px-3 py-2 text-left font-medium">Category</th>
                    <th className="px-3 py-2 text-left font-medium">Payment</th>
                    <th className="px-3 py-2 text-right font-medium">Withdrawal</th>
                    <th className="px-3 py-2 text-right font-medium">Deposit</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {withRunning.map((t) => (
                    <RegisterRow
                      key={t.id}
                      t={t as any}
                      density={density}
                      selected={selected.has(t.id)}
                      onSelect={(v) => { const s = new Set(selected); v ? s.add(t.id) : s.delete(t.id); setSelected(s); }}
                      onOpen={() => setDetailId(t.id)}
                      onFlag={() => patchM.mutate({ id: t.id, patch: { is_flagged: !t.is_flagged } })}
                      onReview={() => patchM.mutate({ id: t.id, patch: { is_reviewed: !t.is_reviewed } })}
                      currency={currency}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── bulk toolbar ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2 text-sm">
            <span className="pl-2 font-medium">{selected.size} selected</span>
            <Separator orientation="vertical" className="h-5" />
            <Button size="sm" variant="ghost" onClick={() => bulkPatchM.mutate({ ids: [...selected], patch: { is_reviewed: true } })}>
              <CheckCircle2 className="mr-1 h-4 w-4" />Mark reviewed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => bulkPatchM.mutate({ ids: [...selected], patch: { is_flagged: true } })}>
              <Flag className="mr-1 h-4 w-4" />Flag
            </Button>
            <Button size="sm" variant="ghost" onClick={() => bulkPatchM.mutate({ ids: [...selected], patch: { cleared_status: "cleared" } })}>
              <ClipboardCheck className="mr-1 h-4 w-4" />Clear
            </Button>
            <BulkCategorySelect categories={categories} onPick={(id) => bulkPatchM.mutate({ ids: [...selected], patch: { category_id: id } })} />
            <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => { if (confirm(`Delete ${selected.size} transactions?`)) bulkDelM.mutate([...selected]); }}>
              <Trash2 className="mr-1 h-4 w-4" />Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── status bar ── */}
      <div className="sticky bottom-0 border-t bg-background/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <span>{withRunning.length} rows · Sum in: {formatCurrency(kpis.sumIn, currency)} · Sum out: {formatCurrency(kpis.sumOut, currency)}</span>
          <span>Last sync {account?.updated_at ? formatDate(account.updated_at) : "—"}</span>
        </div>
      </div>

      {/* ── detail sheet ── */}
      {detailId && <DetailSheet id={detailId} onClose={() => setDetailId(null)} />}

      {/* ── dialogs ── */}
      <FastEntryDialog open={addOpen} onOpenChange={setAddOpen} hideTrigger />
      <AccountFormDialog open={editAccountOpen} onOpenChange={setEditAccountOpen} initial={account} />
    </div>
  );
}

/* ============================== KPI card ============================== */
function KpiCard({ label, value, trend, tone, spark, hint }: {
  label: string; value: string; trend?: number; tone: "pos" | "neg" | "neutral" | "warn"; spark?: number[]; hint?: string;
}) {
  const toneCls = tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="group rounded-xl border bg-card p-3 shadow-sm transition hover:shadow-md">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-lg font-semibold tabular-nums", toneCls)}>{value}</p>
      <div className="mt-1 flex items-center justify-between">
        {trend !== undefined && isFinite(trend) ? (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px]", trend >= 0 ? "text-emerald-600" : "text-red-600")}>
            {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(Math.round(trend))}% vs last mo
          </span>
        ) : <span className="text-[11px] text-muted-foreground">{hint ?? ""}</span>}
        {spark && spark.length > 1 && <Sparkline values={spark} tone={tone} />}
      </div>
    </div>
  );
}

function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const w = 60, h = 20;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * h}`).join(" ");
  const color = tone === "pos" ? "oklch(0.6 0.14 155)" : tone === "neg" ? "oklch(0.55 0.18 25)" : "oklch(0.55 0.02 240)";
  return (
    <svg width={w} height={h} className="overflow-visible"><polyline fill="none" stroke={color} strokeWidth={1.5} points={pts} /></svg>
  );
}

/* ============================== register row ============================== */
function RegisterRow({ t, density, selected, onSelect, onOpen, onFlag, onReview, currency }: {
  t: Txn & { running: number }; density: "compact" | "comfortable" | "spacious";
  selected: boolean; onSelect: (v: boolean) => void; onOpen: () => void;
  onFlag: () => void; onReview: () => void; currency: string;
}) {
  const pad = density === "compact" ? "py-1.5" : density === "spacious" ? "py-4" : "py-2.5";
  const amt = Number(t.amount);
  const isPending = t.cleared_status === "pending";
  const typeColor = t.type === "income" ? "text-emerald-600" : t.type === "expense" ? "text-red-600" : "text-blue-600";

  return (
    <tr className={cn(
      "group border-b transition hover:bg-accent/40 cursor-pointer",
      selected && "bg-primary/5",
      isPending && "bg-amber-50/40 dark:bg-amber-950/10",
    )} onClick={onOpen}>
      <td className={cn("px-3", pad)} onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} />
      </td>
      <td className={cn("px-1", pad)} onClick={(e) => e.stopPropagation()}>
        <button onClick={onFlag} className={cn("rounded p-1 hover:bg-accent", t.is_flagged ? "text-amber-500" : "text-muted-foreground/40")}>
          <Flag className="h-3.5 w-3.5" fill={t.is_flagged ? "currentColor" : "none"} />
        </button>
      </td>
      <td className={cn("px-3 tabular-nums text-muted-foreground", pad)}>{formatDate(t.txn_date)}</td>
      <td className={cn("px-3 min-w-[240px]", pad)}>
        <div className="flex items-center gap-2">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            t.type === "income" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
              : t.type === "expense" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
              : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200")}>
            {(t.merchant ?? t.category?.name ?? "?")[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{t.merchant ?? t.memo ?? "(untitled)"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t.memo && t.merchant ? t.memo : ""}
              {t.check_number ? ` · #${t.check_number}` : ""}
              {t.tags?.length ? ` · ${t.tags.slice(0, 2).join(", ")}` : ""}
            </p>
          </div>
        </div>
      </td>
      <td className={cn("px-3", pad)}>
        {t.category ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.category.color ?? "hsl(var(--muted-foreground))" }} />
            {t.category.name}
          </span>
        ) : <span className="text-xs text-muted-foreground italic">Uncategorized</span>}
      </td>
      <td className={cn("px-3 text-xs text-muted-foreground", pad)}>{t.payment_method ?? "—"}</td>
      <td className={cn("px-3 text-right tabular-nums", pad, t.type === "expense" ? typeColor : "text-muted-foreground/50")}>
        {t.type === "expense" ? formatCurrency(amt, currency) : "—"}
      </td>
      <td className={cn("px-3 text-right tabular-nums", pad, t.type === "income" ? typeColor : "text-muted-foreground/50")}>
        {t.type === "income" ? formatCurrency(amt, currency) : "—"}
      </td>
      <td className={cn("px-3 text-right tabular-nums font-medium", pad)}>{formatCurrency(t.running, currency)}</td>
      <td className={cn("pr-2", pad)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onReview} className={cn("rounded p-1 hover:bg-accent", t.is_reviewed ? "text-emerald-600" : "text-muted-foreground/40")} title="Toggle reviewed">
            <CheckCircle2 className="h-3.5 w-3.5" />
          </button>
          {t.attachment_count > 0 && <span className="rounded p-1 text-muted-foreground">📎</span>}
        </div>
      </td>
    </tr>
  );
}

/* ============================== empty ============================== */
function EmptyState({ onAdd, hasFilters }: { onAdd: () => void; hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Wallet className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">{hasFilters ? "No transactions match" : "No transactions yet"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hasFilters ? "Try widening the date range or clearing filters." : "Add manually or import a bank statement to get started."}</p>
      </div>
      <div className="flex gap-2"><Button size="sm" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Add transaction</Button></div>
    </div>
  );
}

/* ============================== multi popover ============================== */
function MultiPopover({ label, options, values, onChange }: {
  label: string; options: { v: string; l: string }[]; values: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={values.length ? "default" : "outline"}>
          <Filter className="mr-1.5 h-4 w-4" />{label}{values.length ? ` · ${values.length}` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        {options.map(o => (
          <label key={o.v} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            <Checkbox checked={values.includes(o.v)} onCheckedChange={() => toggle(o.v)} />{o.l}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function CategoryMulti({ categories, values, onChange }: { categories: any[]; values: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) => onChange(values.includes(id) ? values.filter(x => x !== id) : [...values, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={values.length ? "default" : "outline"}>
          <Filter className="mr-1.5 h-4 w-4" />Category{values.length ? ` · ${values.length}` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search categories…" />
          <CommandList>
            <CommandEmpty>No categories</CommandEmpty>
            <CommandGroup>
              {categories.map((c: any) => (
                <CommandItem key={c.id} onSelect={() => toggle(c.id)} className="gap-2">
                  <Checkbox checked={values.includes(c.id)} />
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function BulkCategorySelect({ categories, onPick }: { categories: any[]; onPick: (id: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost"><LayoutGrid className="mr-1 h-4 w-4" />Categorize</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Assign category…" />
          <CommandList>
            <CommandEmpty>No categories</CommandEmpty>
            <CommandGroup>
              {categories.map((c: any) => (
                <CommandItem key={c.id} onSelect={() => onPick(c.id)}>{c.name}</CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ============================== chart tip ============================== */
function ChartTip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-lg">
      <p className="text-xs font-medium">{label ?? payload[0]?.name}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs tabular-nums" style={{ color: p.color ?? p.fill }}>
          {p.dataKey ?? p.name}: {formatCurrency(Number(p.value ?? 0), currency)}
        </p>
      ))}
    </div>
  );
}

/* ============================== command panel ============================== */
function CommandPanel({ account }: { account: any }) {
  const groups: { title: string; items: { icon: any; label: string; kbd?: string }[] }[] = [
    { title: "Account", items: [
      { icon: Pencil, label: "Edit account", kbd: "E" },
      { icon: ArrowLeftRight, label: "Transfer money", kbd: "T" },
      { icon: ArrowUpRight, label: "Deposit" }, { icon: ArrowDownRight, label: "Withdraw" },
      { icon: ClipboardCheck, label: "Reconcile", kbd: "R" }, { icon: X, label: "Close account" },
    ]},
    { title: "Reporting", items: [
      { icon: FileSpreadsheet, label: "Overview" }, { icon: FileSpreadsheet, label: "Statements" },
      { icon: Download, label: "Export CSV" }, { icon: Download, label: "Export Excel" },
      { icon: Printer, label: "Print register" },
    ]},
    { title: "Analytics", items: [
      { icon: LineIcon, label: "Balance trend" }, { icon: BarChart3, label: "Cash flow" },
      { icon: PieIcon, label: "Category breakdown" },
    ]},
    { title: "Preferences", items: [
      { icon: Bell, label: "Notifications" }, { icon: Zap, label: "Automation rules" },
      { icon: RefreshCw, label: "Sync settings" },
    ]},
  ];
  return (
    <SheetContent className="w-[380px] sm:w-[420px]">
      <SheetHeader>
        <SheetTitle>{account?.name}</SheetTitle>
        <SheetDescription>All account actions and preferences</SheetDescription>
      </SheetHeader>
      <ScrollArea className="mt-4 h-[calc(100vh-120px)] pr-4">
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{g.title}</p>
              <div className="space-y-0.5">
                {g.items.map((it, i) => (
                  <button key={i} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent">
                    <it.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-left">{it.label}</span>
                    {it.kbd && <kbd className="rounded border bg-muted px-1.5 text-[10px] text-muted-foreground">{it.kbd}</kbd>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </SheetContent>
  );
}

/* ============================== detail sheet ============================== */
function DetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const getDetail = useServerFn(getTransactionDetail);
  const addC = useServerFn(addComment);
  const patchFn = useServerFn(patchTransaction);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["txn-detail", id], queryFn: () => getDetail({ data: { id } }) });
  const [comment, setComment] = useState("");
  const cM = useMutation({
    mutationFn: () => addC({ data: { transactionId: id, body: comment } }),
    onSuccess: () => { setComment(""); qc.invalidateQueries({ queryKey: ["txn-detail", id] }); qc.invalidateQueries({ queryKey: ["acct-txns"] }); },
  });
  const noteM = useMutation({
    mutationFn: (note: string) => patchFn({ data: { id, patch: { note } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["txn-detail", id] }),
  });
  const txn: any = (data as any)?.txn;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>Transaction details</SheetTitle>
          <SheetDescription>Timeline, notes, attachments and activity</SheetDescription>
        </SheetHeader>
        {isLoading || !txn ? <div className="mt-4 space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div> : (
          <ScrollArea className="mt-4 h-[calc(100vh-140px)] pr-4">
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{txn.type}</p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                  {formatCurrency(Number(txn.amount), txn.account?.currency ?? "INR")}
                </p>
                <p className="mt-0.5 text-sm">{txn.merchant ?? "(untitled)"}</p>
                <p className="text-xs text-muted-foreground">{formatDate(txn.txn_date)} · {txn.account?.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Field label="Category" value={txn.category?.name ?? "—"} />
                <Field label="Status" value={txn.cleared_status} />
                <Field label="Payment" value={txn.payment_method ?? "—"} />
                <Field label="Reference" value={txn.check_number ?? "—"} />
                <Field label="Tax" value={txn.tax_code ?? "—"} />
                <Field label="Tags" value={txn.tags?.join(", ") || "—"} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea defaultValue={txn.note ?? ""} onBlur={(e) => e.target.value !== (txn.note ?? "") && noteM.mutate(e.target.value)} rows={3} className="mt-1" placeholder="Add a private note…" />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Comments</p>
                <div className="space-y-2">
                  {((data as any).comments ?? []).map((c: any) => (
                    <div key={c.id} className="rounded-lg bg-muted/40 p-2 text-sm">
                      <p className="text-xs text-muted-foreground">{formatDate(c.created_at)}</p>
                      <p>{c.body}</p>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" />
                    <Button size="sm" onClick={() => comment.trim() && cM.mutate()} disabled={!comment.trim()}>Post</Button>
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Activity</p>
                <div className="space-y-1">
                  {((data as any).activity ?? []).map((a: any) => (
                    <div key={a.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                      <div><p className="capitalize">{a.action.replace("_", " ")}</p><p className="text-muted-foreground">{formatDate(a.created_at)}</p></div>
                    </div>
                  ))}
                  {((data as any).activity ?? []).length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/30 p-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 truncate">{value}</p></div>;
}

/* ============================== compute helpers ============================== */
const CHART_COLORS = [
  "oklch(0.55 0.14 200)", "oklch(0.6 0.14 155)", "oklch(0.65 0.14 70)", "oklch(0.6 0.16 320)",
  "oklch(0.55 0.18 25)", "oklch(0.6 0.12 260)", "oklch(0.6 0.12 40)", "oklch(0.5 0.06 100)",
];

function computeKpis(txns: Txn[], account: any) {
  const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastYm = `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}-${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0")}`;
  let incomeMTD = 0, expenseMTD = 0, incLast = 0, expLast = 0, sumIn = 0, sumOut = 0;
  let largestExpense = 0, largestDeposit = 0, pending = 0, reviewed = 0, withAttach = 0, flagged = 0;
  const inMap: Record<string, number> = {}; const outMap: Record<string, number> = {};
  for (const t of txns) {
    const a = Number(t.amount);
    if (t.type === "income") { sumIn += a; largestDeposit = Math.max(largestDeposit, a); if (t.txn_date.startsWith(ym)) incomeMTD += a; if (t.txn_date.startsWith(lastYm)) incLast += a; inMap[t.txn_date] = (inMap[t.txn_date] ?? 0) + a; }
    else if (t.type === "expense") { sumOut += a; largestExpense = Math.max(largestExpense, a); if (t.txn_date.startsWith(ym)) expenseMTD += a; if (t.txn_date.startsWith(lastYm)) expLast += a; outMap[t.txn_date] = (outMap[t.txn_date] ?? 0) + a; }
    if (t.cleared_status === "pending") pending++;
    if (t.is_reviewed) reviewed++;
    if (t.attachment_count > 0) withAttach++;
    if (t.is_flagged) flagged++;
  }
  const daySet = new Set([...Object.keys(inMap), ...Object.keys(outMap)]);
  const days = Math.max(1, daySet.size);
  const opening = Number(account?.opening_balance ?? 0);
  const current = Number(account?.current_balance ?? opening);
  const avgDaily = (opening + current) / 2;
  const daysSorted = [...daySet].sort();
  const incSpark = daysSorted.slice(-10).map(d => inMap[d] ?? 0);
  const expSpark = daysSorted.slice(-10).map(d => outMap[d] ?? 0);
  const netSpark = daysSorted.slice(-10).map(d => (inMap[d] ?? 0) - (outMap[d] ?? 0));
  return {
    incomeMTD, expenseMTD, net: incomeMTD - expenseMTD, sumIn, sumOut,
    incomeDelta: incLast ? ((incomeMTD - incLast) / incLast) * 100 : undefined,
    expenseDelta: expLast ? ((expenseMTD - expLast) / expLast) * 100 : undefined,
    largestExpense, largestDeposit, pending, flagged, withAttach,
    reviewedPct: txns.length ? Math.round((reviewed / txns.length) * 100) : 100,
    avgDaily, days,
    spark: { income: incSpark.length > 1 ? incSpark : [0, 0], expense: expSpark.length > 1 ? expSpark : [0, 0], net: netSpark.length > 1 ? netSpark : [0, 0] },
  };
}

function buildBalanceSeries(txns: Txn[], opening: number) {
  const byDay: Record<string, number> = {};
  for (const t of txns) {
    const a = Number(t.amount);
    const s = t.type === "income" ? a : t.type === "expense" ? -a : 0;
    byDay[t.txn_date] = (byDay[t.txn_date] ?? 0) + s;
  }
  const days = Object.keys(byDay).sort();
  let bal = opening;
  return days.map((d) => { bal += byDay[d]; return { d: d.slice(5), v: bal }; });
}
function buildFlowSeries(txns: Txn[]) {
  const byDay: Record<string, { in: number; out: number }> = {};
  for (const t of txns) {
    const key = t.txn_date;
    if (!byDay[key]) byDay[key] = { in: 0, out: 0 };
    const a = Number(t.amount);
    if (t.type === "income") byDay[key].in += a;
    else if (t.type === "expense") byDay[key].out += a;
  }
  return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d: d.slice(5), in: v.in, out: v.out, net: v.in - v.out }));
}
function buildCategorySeries(txns: Txn[]) {
  const bucket: Record<string, number> = {};
  for (const t of txns) if (t.type === "expense") { const n = t.category?.name ?? "Uncategorized"; bucket[n] = (bucket[n] ?? 0) + Number(t.amount); }
  return Object.entries(bucket).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
}

function exportCsv(rows: (Txn & { running: number })[], name: string) {
  const header = ["date", "type", "merchant", "memo", "category", "payment", "amount", "balance"];
  const csv = [header.join(",")].concat(
    rows.map(r => [r.txn_date, r.type, `"${(r.merchant ?? "").replace(/"/g, '""')}"`, `"${(r.memo ?? "").replace(/"/g, '""')}"`, r.category?.name ?? "", r.payment_method ?? "", r.amount, r.running].join(",")),
  ).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `${name}-register.csv`; a.click(); URL.revokeObjectURL(url);
  toast.success("Exported CSV");
}
