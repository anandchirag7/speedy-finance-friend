import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus, Upload, Download, RefreshCw, Search, Settings2, Filter, Save, X, ChevronDown,
  ChevronRight, ChevronUp, Flag, Star, Paperclip, MessageSquare, Trash2, Split, Copy,
  MoreHorizontal, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Calendar as CalendarIcon,
  Sparkles, TrendingUp, TrendingDown, Wallet, Receipt, CheckCircle2, AlertTriangle,
  Info, Eye, EyeOff, PieChart as PieIcon, BarChart3, ChevronsUpDown, FileText, Clock,
} from "lucide-react";
import { toast } from "sonner";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, LineChart, Line,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription,
} from "@/components/ui/sheet";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatLakhCrore } from "@/lib/format";
import {
  listTransactionsRich, patchTransaction, bulkPatchTransactions, bulkDeleteTransactions,
  getTransactionDetail, addComment, listAttachmentUrls, registerAttachment,
  listSavedViews, saveView, deleteView, generateAIInsights,
} from "@/lib/transactions.functions";
import {
  listAccounts, listCategories, deleteTransaction,
} from "@/lib/finance.functions";
import { supabase } from "@/integrations/supabase/client";
import { StatementImportDialog } from "@/components/statement-import-dialog";
import { FastEntryDialog } from "@/components/fast-entry-dialog";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions — Paisa" },
      { name: "description", content: "Review, edit, categorize, and reconcile every financial transaction." },
    ],
  }),
  component: TransactionsWorkspace,
});

/* ------------------------------- types --------------------------------- */

type Txn = {
  id: string; account_id: string; transfer_account_id: string | null; category_id: string | null;
  type: "income" | "expense" | "transfer"; amount: number | string; txn_date: string;
  note: string | null; memo: string | null; merchant: string | null; payment_method: string | null;
  check_number: string | null; tags: string[]; tax_code: string | null;
  cleared_status: "pending" | "cleared" | "reconciled";
  is_flagged: boolean; is_favorite: boolean; is_reviewed: boolean; is_read: boolean;
  attachment_count: number; comment_count: number; created_at: string;
  category?: { id: string; name: string; kind: string; color: string | null; icon: string | null } | null;
  account?: { id: string; name: string; currency: string; institution: string | null } | null;
  transfer_account?: { id: string; name: string } | null;
};

type RangePreset = "today" | "7d" | "30d" | "month" | "quarter" | "ytd" | "custom";

const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today", "7d": "Last 7 days", "30d": "Last 30 days",
  month: "This month", quarter: "This quarter", ytd: "Year to date", custom: "Custom",
};

const CHART_COLORS = [
  "oklch(0.55 0.14 155)", "oklch(0.7 0.14 70)", "oklch(0.6 0.12 40)", "oklch(0.5 0.12 260)",
  "oklch(0.65 0.14 200)", "oklch(0.55 0.16 320)", "oklch(0.5 0.06 100)", "oklch(0.62 0.14 25)",
];

const COL_DEFS = [
  { key: "status", label: "Status", default: true, width: 60 },
  { key: "date", label: "Date", default: true, width: 100 },
  { key: "merchant", label: "Merchant", default: true, width: 220 },
  { key: "category", label: "Category", default: true, width: 180 },
  { key: "account", label: "Account", default: true, width: 140 },
  { key: "payment", label: "Payment", default: false, width: 120 },
  { key: "tags", label: "Tags", default: false, width: 140 },
  { key: "memo", label: "Memo", default: false, width: 200 },
  { key: "amount", label: "Amount", default: true, width: 130 },
] as const;
type ColKey = (typeof COL_DEFS)[number]["key"];

/* ------------------------------- root --------------------------------- */

function TransactionsWorkspace() {
  const qc = useQueryClient();

  // ---- data
  const listFn = useServerFn(listTransactionsRich);
  const accountsFn = useServerFn(listAccounts);
  const categoriesFn = useServerFn(listCategories);
  const viewsFn = useServerFn(listSavedViews);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => accountsFn() });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => categoriesFn() });
  const { data: savedViews = [] } = useQuery({ queryKey: ["txn-views"], queryFn: () => viewsFn() });

  // ---- filters
  const [range, setRange] = useState<RangePreset>("ytd");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [types, setTypes] = useState<("income" | "expense" | "transfer")[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cleared, setCleared] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<"any" | "yes" | "no">("any");
  const [flagged, setFlagged] = useState<"any" | "yes" | "no">("any");
  const [hasAttachment, setHasAttachment] = useState<"any" | "yes" | "no">("any");
  const [minAmt, setMinAmt] = useState<string>("");
  const [maxAmt, setMaxAmt] = useState<string>("");
  const [dimension, setDimension] = useState<"category" | "merchant" | "tag" | "account">("category");
  const [chartMode, setChartMode] = useState<"donut" | "bar" | "trend">("donut");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  const dateRange = useMemo(() => computeDateRange(range, customStart, customEnd), [range, customStart, customEnd]);

  const listArgs = useMemo(
    () => ({
      data: {
        accountIds: selectedAccounts.length ? selectedAccounts : undefined,
        categoryIds: selectedCategories.length ? selectedCategories : undefined,
        types: types.length ? types : undefined,
        startDate: dateRange.start,
        endDate: dateRange.end,
        search: debouncedSearch || undefined,
        cleared: cleared.length ? cleared : undefined,
        reviewed,
        flagged,
        hasAttachment,
        minAmount: minAmt ? Number(minAmt) : undefined,
        maxAmount: maxAmt ? Number(maxAmt) : undefined,
        limit: 500,
      },
    }),
    [selectedAccounts, selectedCategories, types, dateRange, debouncedSearch, cleared, reviewed, flagged, hasAttachment, minAmt, maxAmt],
  );

  const { data: txns = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["txn-rich", listArgs.data],
    queryFn: () => listFn(listArgs),
  });

  // ---- view / layout state
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(
    () => new Set(COL_DEFS.filter((c) => c.default).map((c) => c.key as ColKey)),
  );
  const [density, setDensity] = useState<"compact" | "comfortable" | "spacious">("comfortable");
  const [colWidths, setColWidths] = useState<Record<string, number>>(
    () => Object.fromEntries(COL_DEFS.map((c) => [c.key, c.width])),
  );
  const [colOrder, setColOrder] = useState<ColKey[]>(() => COL_DEFS.map((c) => c.key as ColKey));

  const [sortKey, setSortKey] = useState<"date" | "amount" | "merchant" | "category">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ---- selection & expansion
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const list = (txns as Txn[]) ?? [];

  const sorted = useMemo(() => {
    const arr = [...list];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === "date") return (a.txn_date.localeCompare(b.txn_date)) * dir;
      if (sortKey === "amount") return (Number(a.amount) - Number(b.amount)) * dir;
      if (sortKey === "merchant") return (a.merchant ?? "").localeCompare(b.merchant ?? "") * dir;
      if (sortKey === "category") return (a.category?.name ?? "").localeCompare(b.category?.name ?? "") * dir;
      return 0;
    });
    return arr;
  }, [list, sortKey, sortDir]);

  // ---- analytics
  const analytics = useMemo(() => computeAnalytics(list, dimension), [list, dimension]);

  // ---- mutations
  const patchFn = useServerFn(patchTransaction);
  const patchMut = useMutation({
    mutationFn: (v: { id: string; patch: any }) => patchFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["txn-rich"] }),
  });
  const bulkPatchFn = useServerFn(bulkPatchTransactions);
  const bulkPatchMut = useMutation({
    mutationFn: (v: { ids: string[]; patch: any }) => bulkPatchFn({ data: v }),
    onSuccess: (_, v) => {
      toast.success(`Updated ${v.ids.length} transaction${v.ids.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["txn-rich"] });
      setSelected(new Set());
    },
  });
  const bulkDelFn = useServerFn(bulkDeleteTransactions);
  const bulkDelMut = useMutation({
    mutationFn: (ids: string[]) => bulkDelFn({ data: { ids } }),
    onSuccess: (_, ids) => {
      toast.success(`Deleted ${ids.length} transaction${ids.length > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["txn-rich"] });
      setSelected(new Set());
    },
  });
  const delFn = useServerFn(deleteTransaction);
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["txn-rich"] }); },
  });

  const saveViewFn = useServerFn(saveView);
  const saveViewMut = useMutation({
    mutationFn: (v: any) => saveViewFn({ data: v }),
    onSuccess: () => { toast.success("View saved"); qc.invalidateQueries({ queryKey: ["txn-views"] }); },
  });
  const delViewFn = useServerFn(deleteView);
  const delViewMut = useMutation({
    mutationFn: (id: string) => delViewFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["txn-views"] }),
  });

  // ---- panels
  const [advOpen, setAdvOpen] = useState(false);
  const [colDrawerOpen, setColDrawerOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // ---- export
  const exportCsv = () => {
    const header = ["Date", "Merchant", "Category", "Account", "Type", "Amount", "Cleared", "Note"];
    const rows = sorted.map((t) => [
      t.txn_date, t.merchant ?? "", t.category?.name ?? "", t.account?.name ?? "",
      t.type, String(t.amount), t.cleared_status, (t.note ?? "").replace(/[\r\n,]/g, " "),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyView = (v: any) => {
    const f = v.filters ?? {};
    if (f.range) setRange(f.range);
    if (f.accountIds) setSelectedAccounts(f.accountIds);
    if (f.categoryIds) setSelectedCategories(f.categoryIds);
    if (f.types) setTypes(f.types);
    if (f.dimension) setDimension(f.dimension);
    const layout = v.layout ?? {};
    if (layout.visible) setVisibleCols(new Set(layout.visible));
    if (layout.density) setDensity(layout.density);
    if (layout.widths) setColWidths((w) => ({ ...w, ...layout.widths }));
    if (layout.order) setColOrder(layout.order);
    toast.success(`Loaded "${v.name}"`);
  };

  const doSaveView = async () => {
    const name = window.prompt("View name?");
    if (!name) return;
    saveViewMut.mutate({
      name,
      filters: {
        range, accountIds: selectedAccounts, categoryIds: selectedCategories,
        types, dimension,
      },
      layout: {
        visible: Array.from(visibleCols), density, widths: colWidths, order: colOrder,
      },
    });
  };

  const rowH = density === "compact" ? "h-11" : density === "spacious" ? "h-16" : "h-14";

  return (
    <div className="precision-workspace min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[1600px] space-y-4 p-3 sm:p-4 md:space-y-6 md:p-6 lg:p-8">


        {/* --------- Page header --------- */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Transactions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              View, edit, categorize, and reconcile all financial activity across every connected account.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setAddOpen(true)} className="shadow-sm">
              <Plus className="mr-1.5 h-4 w-4" /> Add Transaction
            </Button>
            <StatementImportDialog />
            <Button variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
            <Button variant="outline" onClick={() => setInsightsOpen(true)}>
              <Sparkles className="mr-1.5 h-4 w-4" /> AI Insights
            </Button>
            <Button variant="outline" onClick={() => setColDrawerOpen(true)}><Settings2 className="mr-1.5 h-4 w-4" /> Customize</Button>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>

        {/* --------- Filter toolbar --------- */}
        <div className="sticky top-0 z-30 rounded-2xl border bg-card/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <AccountPicker accounts={accounts as any} value={selectedAccounts} onChange={setSelectedAccounts} />
            <DateRangePicker
              range={range} setRange={setRange}
              customStart={customStart} setCustomStart={setCustomStart}
              customEnd={customEnd} setCustomEnd={setCustomEnd}
            />
            <Select value={dimension} onValueChange={(v) => setDimension(v as any)}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="category">By Category</SelectItem>
                <SelectItem value="merchant">By Merchant</SelectItem>
                <SelectItem value="tag">By Tag</SelectItem>
                <SelectItem value="account">By Account</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9" onClick={() => setAdvOpen(true)}>
              <Filter className="mr-1.5 h-3.5 w-3.5" /> Advanced
            </Button>
            {savedViews.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <Eye className="mr-1.5 h-3.5 w-3.5" /> Views
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                  {(savedViews as any[]).map((v) => (
                    <DropdownMenuItem key={v.id} onClick={() => applyView(v)} className="flex items-center justify-between">
                      <span>{v.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); delViewMut.mutate(v.id); }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="ghost" size="sm" className="h-9" onClick={doSaveView}>
              <Save className="mr-1.5 h-3.5 w-3.5" /> Save view
            </Button>
            <div className="relative ml-auto min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search merchant, memo, notes, check #…"
                className="h-9 pl-9"
              />
            </div>
          </div>
        </div>

        {/* --------- Analytics dashboard --------- */}
        <div className="grid gap-4 lg:grid-cols-12">
          <SummaryCard txns={sorted} loading={isLoading} range={RANGE_LABELS[range]} className="lg:col-span-4" />
          <VizCard
            data={analytics.breakdown} total={analytics.spendTotal}
            mode={chartMode} setMode={setChartMode} dimension={dimension}
            loading={isLoading}
            onSliceClick={(id) => {
              if (dimension === "category" && id) {
                setSelectedCategories((prev) => (prev.includes(id) ? prev : [...prev, id]));
              }
            }}
            className="lg:col-span-5"
          />
          <BreakdownList data={analytics.breakdown} loading={isLoading} className="lg:col-span-3" />
        </div>

        {/* --------- Data grid --------- */}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {/* header bar */}
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>{sorted.length.toLocaleString("en-IN")} transactions</span>
            <div className="flex items-center gap-1">
              <span>Density</span>
              <Select value={density} onValueChange={(v) => setDensity(v as any)}>
                <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="spacious">Spacious</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr className="text-left">
                  <th className="w-10 border-b px-3 py-2">
                    <Checkbox
                      checked={sorted.length > 0 && sorted.every((t) => selected.has(t.id))}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) sorted.forEach((t) => next.add(t.id));
                        else sorted.forEach((t) => next.delete(t.id));
                        setSelected(next);
                      }}
                    />
                  </th>
                  {colOrder.filter((k) => visibleCols.has(k)).map((key) => {
                    const def = COL_DEFS.find((c) => c.key === key)!;
                    const sortable = key === "date" || key === "amount" || key === "merchant" || key === "category";
                    return (
                      <th
                        key={key}
                        style={{ width: colWidths[key] }}
                        className={cn(
                          "border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                          key === "amount" && "text-right",
                        )}
                      >
                        {sortable ? (
                          <button
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => {
                              if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                              else { setSortKey(key as any); setSortDir("desc"); }
                            }}
                          >
                            {def.label}
                            {sortKey === key ? (
                              sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                            ) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                          </button>
                        ) : def.label}
                      </th>
                    );
                  })}
                  <th className="w-16 border-b px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 12 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={visibleCols.size + 2} className="border-b p-2">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={visibleCols.size + 2}>
                      <EmptyGrid onAdd={() => setAddOpen(true)} />
                    </td>
                  </tr>
                ) : (
                  sorted.map((t) => (
                    <TxnRow
                      key={t.id}
                      txn={t}
                      rowH={rowH}
                      cols={colOrder.filter((k) => visibleCols.has(k))}
                      colWidths={colWidths}
                      selected={selected.has(t.id)}
                      expanded={expanded.has(t.id)}
                      categories={categories as any[]}
                      onSelect={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(t.id); else next.delete(t.id);
                        setSelected(next);
                      }}
                      onToggleExpand={() => {
                        const next = new Set(expanded);
                        if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                        setExpanded(next);
                      }}
                      onOpenDetail={() => setDetailId(t.id)}
                      onPatch={(patch) => patchMut.mutate({ id: t.id, patch })}
                      onDelete={() => delMut.mutate(t.id)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* --------- Advanced filter drawer --------- */}
        <Sheet open={advOpen} onOpenChange={setAdvOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Advanced filters</SheetTitle>
              <SheetDescription>Refine transactions with precise conditions.</SheetDescription>
            </SheetHeader>
            <ScrollArea className="mt-4 h-[calc(100vh-120px)] pr-3">
              <div className="space-y-5">
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <MultiPicker
                    label="Any category"
                    options={(categories as any[]).map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
                    value={selectedCategories}
                    onChange={setSelectedCategories}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <div className="flex flex-wrap gap-2">
                    {(["income", "expense", "transfer"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs capitalize",
                          types.includes(t) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                        )}
                      >{t}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Min amount</Label>
                    <Input type="number" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} placeholder="0" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Max amount</Label>
                    <Input type="number" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} placeholder="No limit" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Cleared status</Label>
                  <div className="flex flex-wrap gap-2">
                    {["pending", "cleared", "reconciled"].map((s) => (
                      <button
                        key={s}
                        onClick={() => setCleared((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs capitalize",
                          cleared.includes(s) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                        )}
                      >{s}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <TriToggle label="Reviewed" value={reviewed} onChange={setReviewed} />
                  <TriToggle label="Flagged" value={flagged} onChange={setFlagged} />
                  <TriToggle label="Attachment" value={hasAttachment} onChange={setHasAttachment} />
                </div>
                <Button variant="outline" className="w-full" onClick={() => {
                  setSelectedAccounts([]); setSelectedCategories([]); setTypes([]);
                  setSearch(""); setMinAmt(""); setMaxAmt(""); setCleared([]);
                  setReviewed("any"); setFlagged("any"); setHasAttachment("any");
                }}>Reset all filters</Button>
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* --------- Column customization drawer --------- */}
        <Sheet open={colDrawerOpen} onOpenChange={setColDrawerOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Customize view</SheetTitle>
              <SheetDescription>Show, hide, reorder, and size columns.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="grid gap-2">
                <Label>Density</Label>
                <div className="flex rounded-lg border bg-muted/40 p-0.5">
                  {(["compact", "comfortable", "spacious"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDensity(d)}
                      className={cn(
                        "flex-1 rounded-md px-3 py-1.5 text-xs capitalize",
                        density === d ? "bg-card shadow-sm" : "text-muted-foreground",
                      )}
                    >{d}</button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Columns</Label>
                <div className="space-y-1 rounded-lg border p-2">
                  {colOrder.map((key, idx) => {
                    const def = COL_DEFS.find((c) => c.key === key)!;
                    return (
                      <div key={key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                        <Checkbox
                          checked={visibleCols.has(key)}
                          onCheckedChange={(v) => {
                            const next = new Set(visibleCols);
                            if (v) next.add(key); else next.delete(key);
                            setVisibleCols(next);
                          }}
                        />
                        <span className="flex-1 text-sm">{def.label}</span>
                        <button
                          onClick={() => {
                            if (idx === 0) return;
                            const next = [...colOrder];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            setColOrder(next);
                          }}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={idx === 0}
                          aria-label="Move up"
                        ><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button
                          onClick={() => {
                            if (idx === colOrder.length - 1) return;
                            const next = [...colOrder];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            setColOrder(next);
                          }}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={idx === colOrder.length - 1}
                          aria-label="Move down"
                        ><ChevronDown className="h-3.5 w-3.5" /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={() => {
                setVisibleCols(new Set(COL_DEFS.filter((c) => c.default).map((c) => c.key as ColKey)));
                setColOrder(COL_DEFS.map((c) => c.key as ColKey));
                setColWidths(Object.fromEntries(COL_DEFS.map((c) => [c.key, c.width])));
                setDensity("comfortable");
              }}>Reset layout</Button>
            </div>
          </SheetContent>
        </Sheet>

        {/* --------- Detail panel --------- */}
        <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
          <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
            {detailId && <DetailPanel id={detailId} onClose={() => setDetailId(null)} />}
          </SheetContent>
        </Sheet>

        {/* --------- AI Insights --------- */}
        <Sheet open={insightsOpen} onOpenChange={setInsightsOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI Insights</SheetTitle>
              <SheetDescription>Patterns, anomalies, and recommendations across your spending.</SheetDescription>
            </SheetHeader>
            <InsightsPanel />
          </SheetContent>
        </Sheet>

        {/* --------- Bulk floating toolbar --------- */}
        {selected.size > 0 && (
          <div className="fixed inset-x-0 bottom-6 z-40 mx-auto w-fit animate-in slide-in-from-bottom-4 rounded-2xl border bg-card px-4 py-2 shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <span className="mx-2 h-4 w-px bg-border" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">Categorize</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
                  {(categories as any[]).map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => bulkPatchMut.mutate({ ids: Array.from(selected), patch: { category_id: c.id } })}
                    >{c.name}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() =>
                bulkPatchMut.mutate({ ids: Array.from(selected), patch: { is_reviewed: true } })
              }><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Mark reviewed</Button>
              <Button size="sm" variant="outline" onClick={() =>
                bulkPatchMut.mutate({ ids: Array.from(selected), patch: { cleared_status: "cleared" } })
              }>Clear</Button>
              <Button size="sm" variant="outline" onClick={() =>
                bulkPatchMut.mutate({ ids: Array.from(selected), patch: { is_flagged: true } })
              }><Flag className="mr-1.5 h-3.5 w-3.5" />Flag</Button>
              <Button
                size="sm" variant="outline" className="text-destructive"
                onClick={() => {
                  if (window.confirm(`Delete ${selected.size} transaction(s)?`)) {
                    bulkDelMut.mutate(Array.from(selected));
                  }
                }}
              ><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Mobile FAB */}
        <Button
          size="icon"
          className="fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full shadow-xl md:hidden"
          onClick={() => setAddOpen(true)}
        ><Plus className="h-6 w-6" /></Button>

        <FastEntryDialog open={addOpen} onOpenChange={setAddOpen} hideTrigger />
      </div>
    </div>
  );
}

/* ------------------------- helpers & subcomponents ------------------------ */

function computeDateRange(range: RangePreset, cs: string, ce: string) {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = iso(now);
  if (range === "today") return { start: end, end };
  if (range === "7d") { const d = new Date(now); d.setDate(d.getDate() - 6); return { start: iso(d), end }; }
  if (range === "30d") { const d = new Date(now); d.setDate(d.getDate() - 29); return { start: iso(d), end }; }
  if (range === "month") { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { start: iso(d), end }; }
  if (range === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const d = new Date(now.getFullYear(), q * 3, 1);
    return { start: iso(d), end };
  }
  if (range === "ytd") return { start: iso(new Date(now.getFullYear(), 0, 1)), end };
  return { start: cs || undefined, end: ce || undefined };
}

function computeAnalytics(txns: Txn[], dim: "category" | "merchant" | "tag" | "account") {
  let income = 0, expense = 0, count = txns.length, biggestExp = 0, biggestInc = 0;
  const bucket: Record<string, { id: string; name: string; amount: number; count: number; color: string }> = {};
  const dates: Record<string, number> = {};
  const colors = CHART_COLORS;
  let idx = 0;
  const put = (id: string, name: string, amt: number) => {
    if (!bucket[id]) bucket[id] = { id, name, amount: 0, count: 0, color: colors[idx++ % colors.length] };
    bucket[id].amount += amt;
    bucket[id].count += 1;
  };
  for (const t of txns) {
    const a = Number(t.amount);
    if (t.type === "income") { income += a; biggestInc = Math.max(biggestInc, a); }
    else if (t.type === "expense") {
      expense += a; biggestExp = Math.max(biggestExp, a);
      if (dim === "category") put(t.category?.id ?? "uncat", t.category?.name ?? "Uncategorized", a);
      else if (dim === "merchant") put(t.merchant ?? "unknown", t.merchant ?? "Unknown merchant", a);
      else if (dim === "account") put(t.account?.id ?? "unk", t.account?.name ?? "—", a);
      else if (dim === "tag") {
        if (t.tags?.length) for (const tag of t.tags) put(tag, tag, a);
        else put("_untagged", "Untagged", a);
      }
      const k = t.txn_date;
      dates[k] = (dates[k] ?? 0) + a;
    }
  }
  const breakdown = Object.values(bucket).sort((a, b) => b.amount - a.amount);
  const trend = Object.entries(dates).sort().map(([d, v]) => ({ date: d, value: v }));
  return { income, expense, savings: income - expense, count, biggestExp, biggestInc, breakdown, trend, spendTotal: expense };
}

/* -------- Account picker -------- */
function AccountPicker({ accounts, value, onChange }: { accounts: any[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const label = value.length === 0 ? "All accounts" : value.length === 1
    ? accounts.find((a) => a.id === value[0])?.name ?? "Account"
    : `${value.length} accounts`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Wallet className="mr-1.5 h-3.5 w-3.5" /> {label} <ChevronDown className="ml-1.5 h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No accounts.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onChange([])}>
                <Checkbox checked={value.length === 0} className="mr-2" />All accounts
              </CommandItem>
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  onSelect={() => {
                    if (value.includes(a.id)) onChange(value.filter((x) => x !== a.id));
                    else onChange([...value, a.id]);
                  }}
                >
                  <Checkbox checked={value.includes(a.id)} className="mr-2" />
                  <span className="flex-1">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.institution ?? ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* -------- Date range picker -------- */
function DateRangePicker({
  range, setRange, customStart, setCustomStart, customEnd, setCustomEnd,
}: {
  range: RangePreset; setRange: (r: RangePreset) => void;
  customStart: string; setCustomStart: (s: string) => void;
  customEnd: string; setCustomEnd: (s: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
          {RANGE_LABELS[range]}
          <ChevronDown className="ml-1.5 h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="grid gap-1">
          {(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                range === k && "bg-primary/10 text-primary",
              )}
            >{RANGE_LABELS[k]}{range === k && <CheckCircle2 className="h-3.5 w-3.5" />}</button>
          ))}
          {range === "custom" && (
            <div className="mt-2 grid gap-2 border-t pt-2">
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* -------- Multi-picker -------- */
function MultiPicker({
  label, options, value, onChange,
}: { label: string; options: { id: string; name: string; kind?: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="max-h-56 space-y-0.5 overflow-auto rounded-md border p-1.5">
      {options.length === 0 && <div className="p-2 text-xs text-muted-foreground">{label}</div>}
      {options.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/60">
          <Checkbox
            checked={value.includes(o.id)}
            onCheckedChange={(v) => {
              if (v) onChange([...value, o.id]);
              else onChange(value.filter((x) => x !== o.id));
            }}
          />
          <span className="flex-1 text-sm">{o.name}</span>
          {o.kind && <span className="text-[10px] uppercase text-muted-foreground">{o.kind}</span>}
        </label>
      ))}
    </div>
  );
}

function TriToggle({ label, value, onChange }: { label: string; value: "any" | "yes" | "no"; onChange: (v: any) => void }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex rounded-md border p-0.5">
        {(["any", "yes", "no"] as const).map((k) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={cn(
              "flex-1 rounded-sm px-1 py-1 text-xs capitalize",
              value === k ? "bg-primary/10 text-primary" : "text-muted-foreground",
            )}
          >{k}</button>
        ))}
      </div>
    </div>
  );
}

/* -------- Summary card -------- */
function SummaryCard({ txns, loading, range, className }: { txns: Txn[]; loading: boolean; range: string; className?: string }) {
  const s = useMemo(() => {
    let income = 0, expense = 0, big = 0, bigInc = 0;
    for (const t of txns) {
      const a = Number(t.amount);
      if (t.type === "income") { income += a; if (a > bigInc) bigInc = a; }
      else if (t.type === "expense") { expense += a; if (a > big) big = a; }
    }
    return { income, expense, net: income - expense, count: txns.length, avg: txns.length ? (income + expense) / txns.length : 0, big, bigInc };
  }, [txns]);

  return (
    <div className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Overview
        </p>
        <span className="truncate text-[11px] text-muted-foreground">{range}</span>
      </div>

      {/* Hero: Net */}
      <div className="mt-4">
        <div className="text-[11px] font-medium text-muted-foreground">Net cash flow</div>
        <div
          className={cn(
            "mt-1 truncate text-3xl font-semibold tabular-nums tracking-tight",
            s.net >= 0 ? "text-success" : "text-destructive",
          )}
          title={formatLakhCrore(s.net)}
        >
          {s.net >= 0 ? "+" : "−"}{formatLakhCrore(Math.abs(s.net))}
        </div>
      </div>

      {/* Income / Spending split */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <SplitStat label="Income" value={formatLakhCrore(s.income)} tone="success" icon={TrendingUp} />
        <SplitStat label="Spending" value={formatLakhCrore(s.expense)} tone="destructive" icon={TrendingDown} />
      </div>

      {/* Meta row */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm">
        <MetaRow label="Transactions" value={s.count.toLocaleString("en-IN")} />
        <MetaRow label="Average" value={formatLakhCrore(s.avg)} />
        <MetaRow label="Largest exp." value={formatLakhCrore(s.big)} />
        <MetaRow label="Largest inc." value={formatLakhCrore(s.bigInc)} />
      </div>

      {loading && (
        <div className="absolute right-4 top-3">
          <Skeleton className="h-3 w-14" />
        </div>
      )}
    </div>
  );
}

function SplitStat({ label, value, tone, icon: Icon }: { label: string; value: string; tone: "success" | "destructive"; icon: any }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className={cn("h-3 w-3", tone === "success" ? "text-success" : "text-destructive")} />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate text-base font-semibold tabular-nums",
          tone === "success" ? "text-success" : "text-destructive",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-xs font-medium tabular-nums" title={value}>{value}</span>
    </div>
  );
}



/* -------- Viz card -------- */
function VizCard({
  data, total, mode, setMode, dimension, loading, onSliceClick, className,
}: {
  data: { id: string; name: string; amount: number; count: number; color: string }[];
  total: number;
  mode: "donut" | "bar" | "trend";
  setMode: (m: "donut" | "bar" | "trend") => void;
  dimension: string;
  loading: boolean;
  onSliceClick: (id: string) => void;
  className?: string;
}) {
  const top = data.slice(0, 8);
  return (
    <div className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">By {dimension}</p>
          <p className="font-display text-lg font-semibold">{formatLakhCrore(total)}</p>
        </div>
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {[
            { k: "donut", i: PieIcon }, { k: "bar", i: BarChart3 }, { k: "trend", i: TrendingUp },
          ].map(({ k, i: I }) => (
            <button
              key={k}
              onClick={() => setMode(k as any)}
              className={cn(
                "rounded-md px-2.5 py-1",
                mode === k ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
              aria-label={k}
            ><I className="h-3.5 w-3.5" /></button>
          ))}
        </div>
      </div>
      <div className="mt-3 h-64">
        {loading ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : data.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">No data for this range.</div>
        ) : mode === "donut" ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={top} dataKey="amount" nameKey="name" innerRadius={60} outerRadius={95}
                paddingAngle={2}
                onClick={(_, i) => onSliceClick(top[i]?.id)}
              >
                {top.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <RTooltip
                formatter={(v: any) => formatCurrency(Number(v))}
                contentStyle={{ borderRadius: 8, border: "1px solid oklch(0.9 0.015 95)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : mode === "bar" ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.015 95)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tickFormatter={(v) => formatLakhCrore(v)} tick={{ fontSize: 10 }} />
              <RTooltip formatter={(v: any) => formatCurrency(Number(v))} />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {top.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <TrendChart data={top} />
        )}
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: { name: string; amount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.015 95)" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis tickFormatter={(v) => formatLakhCrore(v)} tick={{ fontSize: 10 }} />
        <RTooltip formatter={(v: any) => formatCurrency(Number(v))} />
        <Line type="monotone" dataKey="amount" stroke="oklch(0.55 0.14 155)" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* -------- Breakdown list -------- */
function BreakdownList({
  data, loading, className,
}: {
  data: { id: string; name: string; amount: number; count: number; color: string }[];
  loading: boolean; className?: string;
}) {
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className={cn("rounded-2xl border bg-card p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top categories</p>
        <span className="text-xs text-muted-foreground">{data.length}</span>
      </div>
      <div className="mt-3 space-y-2 max-h-64 overflow-auto pr-1">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to show.</p>
        ) : (
          data.slice(0, 10).map((d) => (
            <div key={d.id} className="group">
              <div className="flex items-center justify-between text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                  <span className="truncate">{d.name}</span>
                </div>
                <span className="tabular-nums text-muted-foreground">{formatLakhCrore(d.amount)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{
                  width: `${total ? (d.amount / total) * 100 : 0}%`,
                  background: d.color,
                }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* -------- Row -------- */
function TxnRow({
  txn, rowH, cols, colWidths, selected, expanded, categories, onSelect, onToggleExpand, onOpenDetail, onPatch, onDelete,
}: {
  txn: Txn; rowH: string; cols: ColKey[]; colWidths: Record<string, number>;
  selected: boolean; expanded: boolean; categories: any[];
  onSelect: (v: boolean) => void; onToggleExpand: () => void;
  onOpenDetail: () => void; onPatch: (patch: any) => void; onDelete: () => void;
}) {
  const amtTone =
    txn.type === "income" ? "text-success" :
    txn.type === "expense" ? "text-destructive" : "text-muted-foreground";
  const arrow =
    txn.type === "income" ? ArrowUpRight : txn.type === "expense" ? ArrowDownRight : ArrowLeftRight;
  const Arrow = arrow;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <tr
            className={cn(
              "group border-b transition-colors hover:bg-muted/40",
              selected && "bg-primary/5",
              rowH,
            )}
          >
            <td className="px-3 align-middle">
              <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} />
            </td>
            {cols.map((k) => {
              const w = colWidths[k];
              if (k === "status") return (
                <td key={k} style={{ width: w }} className="px-2 align-middle">
                  <div className="flex items-center gap-1">
                    <button onClick={onToggleExpand} className="grid h-6 w-6 place-items-center rounded hover:bg-muted">
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <ClearedDot status={txn.cleared_status} />
                    {txn.is_flagged && <Flag className="h-3 w-3 text-warning-foreground" fill="currentColor" />}
                    {txn.attachment_count > 0 && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                    {txn.comment_count > 0 && <MessageSquare className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </td>
              );
              if (k === "date") return (
                <td key={k} style={{ width: w }} className="px-3 align-middle text-muted-foreground">
                  <div className="text-xs">{formatDate(txn.txn_date)}</div>
                </td>
              );
              if (k === "merchant") return (
                <td key={k} style={{ width: w }} className="px-3 align-middle">
                  <div className="flex items-center gap-2 min-w-0">
                    <MerchantAvatar name={txn.merchant ?? txn.category?.name ?? "?"} color={txn.category?.color} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{txn.merchant ?? txn.note ?? (txn.type === "transfer" ? "Transfer" : "Uncategorized")}</div>
                      {txn.memo && <div className="truncate text-[11px] text-muted-foreground">{txn.memo}</div>}
                    </div>
                  </div>
                </td>
              );
              if (k === "category") return (
                <td key={k} style={{ width: w }} className="px-3 align-middle">
                  <CategoryInline
                    txnId={txn.id}
                    category={txn.category}
                    categories={categories}
                    onPatch={onPatch}
                  />
                </td>
              );
              if (k === "account") return (
                <td key={k} style={{ width: w }} className="px-3 align-middle">
                  <div className="truncate text-xs">
                    <div className="truncate">{txn.account?.name ?? "—"}</div>
                    <div className="truncate text-muted-foreground">{txn.account?.institution ?? ""}</div>
                  </div>
                </td>
              );
              if (k === "payment") return (
                <td key={k} style={{ width: w }} className="px-3 align-middle text-xs text-muted-foreground">
                  {txn.payment_method ?? "—"}
                </td>
              );
              if (k === "tags") return (
                <td key={k} style={{ width: w }} className="px-3 align-middle">
                  <div className="flex flex-wrap gap-1">
                    {(txn.tags ?? []).slice(0, 3).map((t) => (
                      <Badge key={t} variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">{t}</Badge>
                    ))}
                    {(txn.tags?.length ?? 0) > 3 && (
                      <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">+{txn.tags.length - 3}</Badge>
                    )}
                  </div>
                </td>
              );
              if (k === "memo") return (
                <td key={k} style={{ width: w }} className="px-3 align-middle">
                  <span className="text-xs text-muted-foreground truncate block">{txn.note ?? "—"}</span>
                </td>
              );
              if (k === "amount") return (
                <td key={k} style={{ width: w }} className={cn("px-3 text-right align-middle font-semibold tabular-nums", amtTone)}>
                  <div className="flex items-center justify-end gap-1">
                    <Arrow className="h-3 w-3" />
                    {txn.type === "expense" ? "-" : txn.type === "income" ? "+" : ""}
                    {formatCurrency(Number(txn.amount), txn.account?.currency ?? "INR")}
                  </div>
                </td>
              );
              return null;
            })}
            <td className="px-2 align-middle">
              <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <IconBtn label="Flag" onClick={() => onPatch({ is_flagged: !txn.is_flagged })}><Flag className="h-3.5 w-3.5" /></IconBtn>
                <IconBtn label="Favorite" onClick={() => onPatch({ is_favorite: !txn.is_favorite })}>
                  <Star className={cn("h-3.5 w-3.5", txn.is_favorite && "fill-warning text-warning")} />
                </IconBtn>
                <IconBtn label="Details" onClick={onOpenDetail}><MoreHorizontal className="h-3.5 w-3.5" /></IconBtn>
              </div>
            </td>
          </tr>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={onOpenDetail}>Open details</ContextMenuItem>
          <ContextMenuItem onClick={() => onPatch({ is_reviewed: !txn.is_reviewed })}>
            {txn.is_reviewed ? "Mark as unreviewed" : "Mark as reviewed"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onPatch({ cleared_status: txn.cleared_status === "cleared" ? "pending" : "cleared" })}>
            {txn.cleared_status === "cleared" ? "Mark pending" : "Clear"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onPatch({ is_flagged: !txn.is_flagged })}>
            {txn.is_flagged ? "Unflag" : "Flag"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onDelete} className="text-destructive">Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {expanded && (
        <tr>
          <td colSpan={cols.length + 2} className="border-b bg-muted/20 p-0">
            <InlineExpand txn={txn} onOpenDetail={onOpenDetail} onPatch={onPatch} />
          </td>
        </tr>
      )}
    </>
  );
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="grid h-7 w-7 place-items-center rounded hover:bg-muted"
      aria-label={label}
    >{children}</button>
  );
}

function ClearedDot({ status }: { status: string }) {
  const cls =
    status === "reconciled" ? "bg-primary" :
    status === "cleared" ? "bg-success" : "bg-muted-foreground/40";
  return <span className={cn("inline-block h-2 w-2 rounded-full", cls)} title={status} />;
}

function MerchantAvatar({ name, color }: { name: string; color?: string | null }) {
  const initials = name.split(" ").slice(0, 2).map((s) => s[0] ?? "").join("").toUpperCase() || "?";
  return (
    <div
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold"
      style={{ background: color ?? "oklch(0.94 0.02 90)", color: "oklch(0.25 0.04 155)" }}
    >{initials}</div>
  );
}

/* -------- Inline category editor -------- */
function CategoryInline({
  category, categories, onPatch,
}: { txnId: string; category: Txn["category"]; categories: any[]; onPatch: (p: any) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-xs hover:bg-muted">
          {category ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: category.color ?? "oklch(0.9 0.02 95)" }} />
              <span className="truncate">{category.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Uncategorized</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search category…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => { onPatch({ category_id: null }); setOpen(false); }}>
                Uncategorized
              </CommandItem>
              {categories.map((c) => (
                <CommandItem key={c.id} onSelect={() => { onPatch({ category_id: c.id }); setOpen(false); }}>
                  <span className="mr-2 h-2 w-2 rounded-full" style={{ background: c.color ?? "oklch(0.9 0.02 95)" }} />
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* -------- Inline expand -------- */
function InlineExpand({ txn, onOpenDetail, onPatch }: { txn: Txn; onOpenDetail: () => void; onPatch: (p: any) => void }) {
  const [note, setNote] = useState(txn.note ?? "");
  const [memo, setMemo] = useState(txn.memo ?? "");
  const [merchant, setMerchant] = useState(txn.merchant ?? "");
  useEffect(() => { setNote(txn.note ?? ""); setMemo(txn.memo ?? ""); setMerchant(txn.merchant ?? ""); }, [txn.id]);
  return (
    <div className="animate-in fade-in-50 slide-in-from-top-1 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="grid gap-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Merchant</Label>
          <Input
            value={merchant} onChange={(e) => setMerchant(e.target.value)}
            onBlur={() => merchant !== (txn.merchant ?? "") && onPatch({ merchant })}
            placeholder="e.g. Blue Tokai"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Memo</Label>
          <Input
            value={memo} onChange={(e) => setMemo(e.target.value)}
            onBlur={() => memo !== (txn.memo ?? "") && onPatch({ memo })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Payment method</Label>
          <Select
            value={txn.payment_method ?? "_none"}
            onValueChange={(v) => onPatch({ payment_method: v === "_none" ? null : v })}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">—</SelectItem>
              <SelectItem value="UPI">UPI</SelectItem>
              <SelectItem value="Card">Card</SelectItem>
              <SelectItem value="Cash">Cash</SelectItem>
              <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
              <SelectItem value="Cheque">Cheque</SelectItem>
              <SelectItem value="Auto-debit">Auto-debit</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-3 grid gap-1">
          <Label className="text-[11px] uppercase text-muted-foreground">Note</Label>
          <Textarea
            rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (txn.note ?? "") && onPatch({ note })}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onPatch({ is_reviewed: !txn.is_reviewed })}>
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
          {txn.is_reviewed ? "Reviewed" : "Mark reviewed"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onPatch({ cleared_status: txn.cleared_status === "cleared" ? "pending" : "cleared" })}>
          {txn.cleared_status === "cleared" ? "Mark pending" : "Clear"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpenDetail} className="ml-auto">
          Open full details <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* -------- Empty -------- */
function EmptyGrid({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/5 text-primary">
        <Receipt className="h-7 w-7" />
      </div>
      <div>
        <h3 className="font-display text-lg font-semibold">No transactions match</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Try adjusting filters, changing the date range, or import a statement.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onAdd}><Plus className="mr-1.5 h-4 w-4" /> Add transaction</Button>
        <StatementImportDialog />
      </div>
    </div>
  );
}

/* -------- Detail panel -------- */
function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getTransactionDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["txn-detail", id],
    queryFn: () => detailFn({ data: { id } }),
  });
  const commentFn = useServerFn(addComment);
  const commentMut = useMutation({
    mutationFn: (v: { transactionId: string; body: string }) => commentFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["txn-detail", id] }); qc.invalidateQueries({ queryKey: ["txn-rich"] }); setBody(""); },
  });

  const registerFn = useServerFn(registerAttachment);
  const signFn = useServerFn(listAttachmentUrls);
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const paths = (data?.attachments ?? []).map((a: any) => a.storage_path);
    if (paths.length === 0) return;
    signFn({ data: { paths } }).then((r: any) => {
      const map: Record<string, string> = {};
      for (const item of r as any[]) if (item.url) map[item.path] = item.url;
      setUrls(map);
    });
  }, [data?.attachments]);

  const uploadFile = async (file: File) => {
    if (!data?.txn) return;
    try {
      const householdId = (data.txn as any).household_id as string;
      const path = `${householdId}/${data.txn.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: false });
      if (error) throw error;
      await registerFn({
        data: {
          transactionId: data.txn.id,
          storagePath: path,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      });
      toast.success("Receipt attached");
      qc.invalidateQueries({ queryKey: ["txn-detail", id] });
      qc.invalidateQueries({ queryKey: ["txn-rich"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    }
  };

  if (isLoading || !data?.txn) return <div className="p-4"><Skeleton className="h-24 w-full" /></div>;
  const t = data.txn as any;

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b pb-3">
        <SheetTitle className="flex items-center gap-2">
          <MerchantAvatar name={t.merchant ?? t.category?.name ?? "?"} color={t.category?.color} />
          <span className="min-w-0 truncate">{t.merchant ?? "Transaction"}</span>
        </SheetTitle>
        <SheetDescription>{formatDate(t.txn_date)} · {t.account?.name}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto py-4">
        <div className={cn(
          "rounded-xl border p-4",
          t.type === "income" ? "bg-success/5" : t.type === "expense" ? "bg-destructive/5" : "bg-muted/40",
        )}>
          <div className="text-xs text-muted-foreground">Amount</div>
          <div className={cn(
            "font-display text-3xl font-semibold tabular-nums",
            t.type === "income" ? "text-success" : t.type === "expense" ? "text-destructive" : "",
          )}>
            {t.type === "expense" ? "-" : t.type === "income" ? "+" : ""}
            {formatCurrency(Number(t.amount), t.account?.currency ?? "INR")}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{t.cleared_status}</Badge>
            {t.is_reviewed && <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Reviewed</Badge>}
            {t.is_flagged && <Badge variant="secondary" className="gap-1 text-warning-foreground"><Flag className="h-3 w-3" /> Flagged</Badge>}
          </div>
        </div>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="receipts">Files</TabsTrigger>
            <TabsTrigger value="comments">Notes</TabsTrigger>
            <TabsTrigger value="activity">Log</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-2 pt-3">
            <DetailRow label="Category" value={t.category?.name ?? "Uncategorized"} />
            <DetailRow label="Account" value={t.account?.name ?? "—"} />
            <DetailRow label="Payment method" value={t.payment_method ?? "—"} />
            <DetailRow label="Tax code" value={t.tax_code ?? "—"} />
            <DetailRow label="Check #" value={t.check_number ?? "—"} />
            <DetailRow label="Memo" value={t.memo ?? "—"} />
            <DetailRow label="Note" value={t.note ?? "—"} />
            <DetailRow label="Tags" value={(t.tags ?? []).join(", ") || "—"} />
          </TabsContent>
          <TabsContent value="receipts" className="space-y-2 pt-3">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload receipt
            </Button>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(data.attachments ?? []).length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground">No attachments yet.</p>
              )}
              {(data.attachments ?? []).map((a: any) => (
                <a
                  key={a.id} href={urls[a.storage_path] ?? "#"} target="_blank" rel="noreferrer"
                  className="group flex flex-col overflow-hidden rounded-lg border hover:shadow-sm"
                >
                  {a.mime_type?.startsWith("image/") && urls[a.storage_path] ? (
                    <img src={urls[a.storage_path]} alt={a.file_name} className="h-28 w-full object-cover" />
                  ) : (
                    <div className="grid h-28 place-items-center bg-muted"><FileText className="h-8 w-8 text-muted-foreground" /></div>
                  )}
                  <div className="p-2 text-xs">
                    <div className="truncate font-medium">{a.file_name}</div>
                    <div className="text-muted-foreground">{Math.round((a.size_bytes ?? 0) / 1024)} KB</div>
                  </div>
                </a>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="comments" className="space-y-3 pt-3">
            {(data.comments ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            )}
            {(data.comments ?? []).map((c: any) => (
              <div key={c.id} className="rounded-lg border p-2 text-sm">
                <div className="text-xs text-muted-foreground">{formatDate(c.created_at)}</div>
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
            <div className="grid gap-2">
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Add a note…" />
              <Button size="sm" disabled={!body.trim() || commentMut.isPending} onClick={() => commentMut.mutate({ transactionId: id, body })}>
                Post note
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="activity" className="space-y-2 pt-3">
            {(data.activity ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            ) : (
              <ol className="relative ml-3 border-l pl-4">
                {(data.activity ?? []).map((a: any) => (
                  <li key={a.id} className="mb-3">
                    <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-primary" />
                    <div className="text-xs uppercase text-muted-foreground">{a.action}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(a.created_at)}</div>
                    <pre className="mt-1 max-w-full overflow-auto rounded bg-muted/40 p-2 text-[10px]">{JSON.stringify(a.details, null, 0)}</pre>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 last:border-none">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span className="max-w-[65%] text-right text-sm">{value}</span>
    </div>
  );
}

/* -------- Insights panel -------- */
function InsightsPanel() {
  const fn = useServerFn(generateAIInsights);
  const [window, setWindow] = useState<"30d" | "90d" | "6m" | "1y">("30d");
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ai-insights", window],
    queryFn: () => fn({ data: { window } }),
  });
  const items = ((data as any)?.insights ?? []) as { severity: "info" | "warning" | "success"; title: string; detail: string }[];

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <Select value={window} onValueChange={(v) => setWindow(v as any)}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="6m">Last 6 months</SelectItem>
            <SelectItem value="1y">Last year</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No insights available yet.</p>
      ) : (
        items.map((i, idx) => (
          <div
            key={idx}
            className={cn(
              "rounded-xl border p-3",
              i.severity === "warning" ? "border-warning/40 bg-warning/5" :
              i.severity === "success" ? "border-success/40 bg-success/5" :
              "bg-card",
            )}
          >
            <div className="flex items-start gap-2">
              {i.severity === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 text-warning-foreground" /> :
               i.severity === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> :
               <Info className="mt-0.5 h-4 w-4 text-primary" />}
              <div className="min-w-0">
                <div className="text-sm font-medium">{i.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{i.detail}</div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
