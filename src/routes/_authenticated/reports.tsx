import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Download,
  Search,
  FileText,
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  Bell,
  Users,
  ArrowLeftRight,
  Receipt,
  BarChart3,
  Landmark,
  Calendar as CalendarIcon,
  Bookmark,
  BookmarkPlus,
  Trash2,
  FileSpreadsheet,
  GitCompareArrows,
  Loader2,
  Server,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import { getReportsData } from "@/lib/reports.functions";
import { REPORTS, REPORT_CATEGORIES, parseChartNumber, type ReportDef, type ReportOutput } from "@/lib/reports-catalog";
import { exportReportToPDF } from "@/lib/reports-pdf";
import { exportReportToCSV } from "@/lib/reports-csv";
import { ReportChart } from "@/lib/reports-charts";
import {
  listReportPresets,
  saveReportPreset,
  deleteReportPreset,
} from "@/lib/report-presets.functions";
import {
  startReportExport,
  getReportJob,
  signReportFile,
} from "@/lib/report-exports.functions";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Paisa" },
      { name: "description", content: "30+ downloadable financial reports for your household." },
    ],
  }),
  component: ReportsPage,
});

type Preset = "1m" | "3m" | "6m" | "ytd" | "1y" | "all";
type CompareLayout = "overlay" | "side-by-side";

const CATEGORY_ICONS: Record<string, any> = {
  "Cash Flow": TrendingUp,
  Spending: TrendingDown,
  Income: PiggyBank,
  "Net Worth": Landmark,
  Accounts: Wallet,
  Budgets: BarChart3,
  Bills: Bell,
  Payees: Users,
  Transactions: ArrowLeftRight,
  "Tax & Investments": Receipt,
};

function rangeFor(preset: Preset): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const d = new Date(today);
  if (preset === "1m") d.setMonth(d.getMonth() - 1);
  else if (preset === "3m") d.setMonth(d.getMonth() - 3);
  else if (preset === "6m") d.setMonth(d.getMonth() - 6);
  else if (preset === "1y") d.setFullYear(d.getFullYear() - 1);
  else if (preset === "ytd") return { from: `${today.getFullYear()}-01-01`, to };
  else if (preset === "all") return { from: "2000-01-01", to };
  return { from: d.toISOString().slice(0, 10), to };
}

// Given a range, return the immediately-preceding range of the same length.
function previousRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(from);
  const t = new Date(to);
  const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  const prevTo = new Date(f);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days + 1);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

// Percentage / signed delta helper for KPI compare
function deltaStr(current: string, previous: string): { text: string; positive: boolean } | null {
  const n = (s: string) => {
    const m = s.replace(/[^0-9.\-]/g, "");
    const v = parseFloat(m);
    return Number.isFinite(v) ? v : null;
  };
  const a = n(current);
  const b = n(previous);
  if (a == null || b == null) return null;
  const diff = a - b;
  if (b === 0) return { text: diff === 0 ? "±0" : (diff > 0 ? "▲ new" : "▼"), positive: diff >= 0 };
  const pct = (diff / Math.abs(b)) * 100;
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "±";
  return { text: `${arrow} ${Math.abs(pct).toFixed(1)}%`, positive: diff >= 0 };
}

function ReportsPage() {
  const qc = useQueryClient();
  const dataFn = useServerFn(getReportsData);
  const listPresetsFn = useServerFn(listReportPresets);
  const savePresetFn = useServerFn(saveReportPreset);
  const deletePresetFn = useServerFn(deleteReportPreset);
  const startExportFn = useServerFn(startReportExport);
  const getJobFn = useServerFn(getReportJob);
  const signFileFn = useServerFn(signReportFile);

  const [preset, setPreset] = useState<Preset>("ytd");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [openReport, setOpenReport] = useState<ReportDef | null>(null);
  const [drillLabel, setDrillLabel] = useState<string | null>(null);

  // ---- Compare mode ----
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareLayout, setCompareLayout] = useState<CompareLayout>("overlay");
  const [compareFrom, setCompareFrom] = useState<string>("");
  const [compareTo, setCompareTo] = useState<string>("");

  useEffect(() => setDrillLabel(null), [openReport]);

  const range = useMemo(() => {
    if (customFrom && customTo) return { from: customFrom, to: customTo };
    return rangeFor(preset);
  }, [preset, customFrom, customTo]);

  const compareRange = useMemo(() => {
    if (!compareEnabled) return null;
    if (compareFrom && compareTo) return { from: compareFrom, to: compareTo };
    return previousRange(range.from, range.to);
  }, [compareEnabled, compareFrom, compareTo, range.from, range.to]);

  const { data, isLoading } = useQuery({
    queryKey: ["reports-data", range.from, range.to],
    queryFn: () => dataFn({ data: range }),
  });
  const { data: compareData } = useQuery({
    queryKey: ["reports-data", compareRange?.from, compareRange?.to, "compare"],
    queryFn: () => dataFn({ data: compareRange! }),
    enabled: !!compareRange,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return REPORTS.filter(
      (r) =>
        (category === "All" || r.category === category) &&
        (!q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)),
    );
  }, [query, category]);

  const grouped = useMemo(() => {
    const g: Record<string, ReportDef[]> = {};
    for (const r of filtered) (g[r.category] ??= []).push(r);
    return g;
  }, [filtered]);

  const output = useMemo(() => (openReport && data ? openReport.compute(data) : null), [openReport, data]);
  const compareOutput = useMemo(
    () => (openReport && compareData ? openReport.compute(compareData) : null),
    [openReport, compareData],
  );

  const drilledOutput = useMemo<ReportOutput | null>(() => {
    if (!output) return null;
    if (!drillLabel || !output.chart) return output;
    const xCol = output.chart.xCol;
    const rows = output.rows.filter((r) => String(r[xCol] ?? "") === drillLabel);
    return { ...output, rows, footer: undefined };
  }, [output, drillLabel]);

  const handleDownloadPDF = async (report: ReportDef, out?: ReportOutput) => {
    if (!data) return toast.error("Data still loading — try again in a moment.");
    const o = out ?? report.compute(data);
    await exportReportToPDF(report, o, {
      from: range.from,
      to: range.to,
      owner: (data as any)?.profile?.display_name,
    });
    toast.success(`${report.name} exported to PDF`);
  };

  const handleDownloadCSV = (report: ReportDef, out?: ReportOutput) => {
    if (!data) return toast.error("Data still loading — try again in a moment.");
    const o = out ?? report.compute(data);
    exportReportToCSV(report, o, { from: range.from, to: range.to });
    toast.success(`${report.name} exported to CSV`);
  };

  // ---------- DB-backed presets ----------
  const { data: presets = [] } = useQuery({
    queryKey: ["report-presets"],
    queryFn: () => listPresetsFn(),
  });

  const handleSavePreset = async () => {
    const name = window.prompt("Name this preset (e.g. 'Q1 spend review')");
    if (!name?.trim()) return;
    try {
      await savePresetFn({
        data: {
          name: name.trim(),
          config: {
            query,
            category,
            preset,
            customFrom,
            customTo,
            compareEnabled,
            compareFrom,
            compareTo,
            compareLayout,
          },
        },
      });
      qc.invalidateQueries({ queryKey: ["report-presets"] });
      toast.success(`Saved preset "${name.trim()}"`);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save preset");
    }
  };
  const applyPreset = (p: any) => {
    const c = p.config ?? {};
    setQuery(c.query ?? "");
    setCategory(c.category ?? "All");
    setPreset(c.preset ?? "ytd");
    setCustomFrom(c.customFrom ?? "");
    setCustomTo(c.customTo ?? "");
    setCompareEnabled(!!c.compareEnabled);
    setCompareFrom(c.compareFrom ?? "");
    setCompareTo(c.compareTo ?? "");
    setCompareLayout(c.compareLayout ?? "overlay");
    toast.success(`Applied "${p.name}"`);
  };
  const removePreset = async (id: string) => {
    try {
      await deletePresetFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["report-presets"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Could not delete preset");
    }
  };

  // ---------- Server-side export job ----------
  const [jobOpen, setJobOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobFormat, setJobFormat] = useState<"csv" | "pdf">("pdf");
  const [jobStarting, setJobStarting] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const { data: job } = useQuery({
    queryKey: ["report-job", jobId],
    queryFn: () => getJobFn({ data: { id: jobId! } }),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const j: any = q.state.data;
      if (!j) return 1000;
      return j.status === "running" ? 1500 : false;
    },
  });

  const startServerExport = async (format: "csv" | "pdf") => {
    if (!filtered.length) return;
    setJobFormat(format);
    setJobStarting(true);
    setSignedUrls({});
    setJobOpen(true);
    try {
      const res = await startExportFn({
        data: {
          format,
          report_ids: filtered.map((r) => r.id),
          from: range.from,
          to: range.to,
        },
      });
      setJobId(res.id);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to start export");
      setJobOpen(false);
    } finally {
      setJobStarting(false);
    }
  };

  const openSignedFile = async (path: string) => {
    if (signedUrls[path]) {
      window.open(signedUrls[path], "_blank");
      return;
    }
    try {
      const { url } = await signFileFn({ data: { path } });
      if (!url) throw new Error("Could not generate a download link.");
      setSignedUrls((s) => ({ ...s, [path]: url }));
      window.open(url, "_blank");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to open file");
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:space-y-6 sm:p-4 md:p-6">
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:flex-wrap sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Reports</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {REPORTS.length}+ prebuilt reports — compare periods, save presets to your account, run server-side exports.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Presets */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Bookmark className="mr-1.5 h-4 w-4" />
                Presets
                {presets.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {presets.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="text-xs">Cloud-synced filter presets</DropdownMenuLabel>
              <DropdownMenuItem onSelect={handleSavePreset}>
                <BookmarkPlus className="mr-2 h-4 w-4" /> Save current as preset…
              </DropdownMenuItem>
              {presets.length > 0 && <DropdownMenuSeparator />}
              {presets.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No presets yet. Presets sync to your account.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {presets.map((p: any) => (
                    <div key={p.id} className="group flex items-start gap-2 px-2 py-1.5 hover:bg-muted/60">
                      <button onClick={() => applyPreset(p)} className="flex-1 min-w-0 text-left">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {p.config?.category ?? "All"} · {p.config?.preset ?? "ytd"}
                          {p.config?.compareEnabled ? " · compare" : ""}
                          {p.config?.query ? ` · "${p.config.query}"` : ""}
                        </div>
                      </button>
                      <button
                        onClick={() => removePreset(p.id)}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        title="Delete preset"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Date range */}
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
            <CalendarIcon className="ml-1.5 hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
            {(["1m", "3m", "6m", "ytd", "1y", "all"] as Preset[]).map((p) => (
              <Button
                key={p}
                variant={preset === p && !customFrom ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-[11px] uppercase sm:px-2.5 sm:text-xs"
                onClick={() => {
                  setPreset(p);
                  setCustomFrom("");
                  setCustomTo("");
                }}
              >
                {p}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-9 w-[130px] text-xs sm:w-[140px] sm:text-sm"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-9 w-[130px] text-xs sm:w-[140px] sm:text-sm"
            />
          </div>

          {/* Server export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Server className="mr-1.5 h-4 w-4" />
                Export {filtered.length}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Server-side export</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => startServerExport("pdf")}>
                <Download className="mr-2 h-4 w-4" /> PDF (progress tracked)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => startServerExport("csv")}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> CSV (progress tracked)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Compare mode bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-primary" />
          <Label htmlFor="compare-toggle" className="text-sm font-medium">
            Compare mode
          </Label>
          <Switch id="compare-toggle" checked={compareEnabled} onCheckedChange={setCompareEnabled} />
        </div>
        {compareEnabled && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Previous</span>
              <Input
                type="date"
                value={compareFrom}
                onChange={(e) => setCompareFrom(e.target.value)}
                placeholder="auto"
                className="h-8 w-[130px] text-xs"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={compareTo}
                onChange={(e) => setCompareTo(e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
              {(compareFrom || compareTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    setCompareFrom("");
                    setCompareTo("");
                  }}
                >
                  Auto
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
              {(["overlay", "side-by-side"] as CompareLayout[]).map((l) => (
                <Button
                  key={l}
                  variant={compareLayout === l ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setCompareLayout(l)}
                >
                  {l === "overlay" ? "Overlay" : "Side-by-side"}
                </Button>
              ))}
            </div>
            {compareRange && (
              <span className="text-[11px] text-muted-foreground">
                vs {compareRange.from} → {compareRange.to}
              </span>
            )}
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search reports…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <ScrollArea className="max-w-full">
          <Tabs value={category} onValueChange={setCategory}>
            <TabsList className="flex flex-nowrap">
              <TabsTrigger value="All">All</TabsTrigger>
              {REPORT_CATEGORIES.map((c) => (
                <TabsTrigger key={c} value={c} className="whitespace-nowrap">
                  {c}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </ScrollArea>
      </div>

      {/* Report grid */}
      {isLoading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        Object.entries(grouped).map(([cat, list]) => {
          const Icon = CATEGORY_ICONS[cat] ?? FileText;
          return (
            <section key={cat} className="space-y-3">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h2>
                <Badge variant="secondary" className="text-[10px]">
                  {list.length}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <Card
                    key={r.id}
                    className="group cursor-pointer transition-all hover:border-primary/40 hover:shadow-md"
                    onClick={() => setOpenReport(r)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-semibold leading-tight">{r.name}</CardTitle>
                        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Download CSV"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadCSV(r);
                            }}
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Download PDF"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadPDF(r);
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="line-clamp-2 text-xs">{r.description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })
      )}

      {filtered.length === 0 && !isLoading && (
        <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          No reports match your filters.
        </div>
      )}

      {/* Preview sheet */}
      <Sheet open={!!openReport} onOpenChange={(o) => !o && setOpenReport(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-2xl sm:p-6 lg:max-w-5xl">
          <SheetHeader>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <SheetTitle className="truncate">{openReport?.name}</SheetTitle>
                <SheetDescription className="line-clamp-2">{openReport?.description}</SheetDescription>
                <p className="mt-1 text-xs text-muted-foreground">
                  {range.from} → {range.to}
                  {compareRange && (
                    <>
                      {" · vs "}
                      <span className="font-medium">{compareRange.from} → {compareRange.to}</span>
                    </>
                  )}
                  {drillLabel && (
                    <>
                      {" · filtered by "}
                      <span className="font-medium text-primary">{drillLabel}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!data}
                  onClick={() => openReport && drilledOutput && handleDownloadCSV(openReport, drilledOutput)}
                >
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" /> CSV
                </Button>
                <Button
                  size="sm"
                  disabled={!data}
                  onClick={() => openReport && drilledOutput && handleDownloadPDF(openReport, drilledOutput)}
                >
                  <Download className="mr-1.5 h-4 w-4" /> PDF
                </Button>
              </div>
            </div>
          </SheetHeader>
          <div className="mt-4">
            {!drilledOutput ? (
              <Skeleton className="h-64" />
            ) : (
              <>
                {output?.kpis && output.kpis.length > 0 && (
                  <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                    {output.kpis.map((k, idx) => {
                      const prev = compareOutput?.kpis?.[idx];
                      const d = prev ? deltaStr(k.value, prev.value) : null;
                      return (
                        <div key={k.label} className="rounded-lg border bg-muted/30 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
                          <div className="mt-1 font-display text-base font-semibold sm:text-lg">{k.value}</div>
                          {prev && (
                            <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                              <span className="text-muted-foreground">was {prev.value}</span>
                              {d && (
                                <span className={d.positive ? "text-emerald-600" : "text-rose-600"}>{d.text}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {output && (output.chart || output.chart2) && (
                  <div className="mb-4 grid gap-3 lg:grid-cols-2">
                    {output.chart && (
                      compareOutput && compareLayout === "side-by-side" ? (
                        <>
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Current
                            </div>
                            <ReportChart
                              output={output}
                              hint={output.chart}
                              height={240}
                              activeLabel={drillLabel}
                              onSegmentClick={setDrillLabel}
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Previous
                            </div>
                            <ReportChart output={compareOutput} hint={output.chart} height={240} />
                          </div>
                        </>
                      ) : (
                        <ReportChart
                          output={output}
                          hint={output.chart}
                          height={260}
                          activeLabel={drillLabel}
                          onSegmentClick={setDrillLabel}
                          compareOutput={compareOutput}
                        />
                      )
                    )}
                    {output.chart2 && (
                      <ReportChart
                        output={output}
                        hint={output.chart2}
                        height={260}
                        activeLabel={drillLabel}
                        compareOutput={compareLayout === "overlay" ? compareOutput : null}
                      />
                    )}
                  </div>
                )}
                {drilledOutput.rows.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {drillLabel
                      ? `No rows match "${drillLabel}". Clear the filter to see the full report.`
                      : (drilledOutput.emptyMessage ?? "No data for this period.")}
                  </div>
                ) : (
                  <ScrollArea className="max-h-[calc(100vh-320px)] rounded-lg border">
                    <div className="min-w-[520px]">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                          <tr>
                            {drilledOutput.columns.map((c, i) => (
                              <th
                                key={i}
                                className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                                  drilledOutput.numericColumns?.includes(i) ? "text-right" : ""
                                }`}
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {drilledOutput.rows.slice(0, 500).map((r, ri) => (
                            <tr key={ri} className="border-t hover:bg-muted/30">
                              {r.map((c, ci) => (
                                <td
                                  key={ci}
                                  className={`px-3 py-2 ${
                                    drilledOutput.numericColumns?.includes(ci)
                                      ? "text-right font-mono tabular-nums"
                                      : ""
                                  }`}
                                >
                                  {String(c)}
                                </td>
                              ))}
                            </tr>
                          ))}
                          {drilledOutput.footer && (
                            <tr className="border-t bg-muted/40 font-semibold">
                              {drilledOutput.footer.map((c, ci) => (
                                <td
                                  key={ci}
                                  className={`px-3 py-2 ${
                                    drilledOutput.numericColumns?.includes(ci)
                                      ? "text-right font-mono tabular-nums"
                                      : ""
                                  }`}
                                >
                                  {String(c)}
                                </td>
                              ))}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {drilledOutput.rows.length > 500 && (
                      <div className="border-t p-3 text-center text-xs text-muted-foreground">
                        Preview limited to 500 rows. The export includes all {drilledOutput.rows.length}.
                      </div>
                    )}
                  </ScrollArea>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Server export dialog */}
      <Dialog open={jobOpen} onOpenChange={setJobOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {job?.status === "done" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : job?.status === "failed" ? (
                <XCircle className="h-5 w-5 text-rose-600" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              Server export · {jobFormat.toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              {job?.progress_message ??
                (jobStarting ? "Starting export…" : "Preparing your reports on the server.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Progress value={job?.progress ?? (jobStarting ? 2 : 0)} className="h-2" />
            <div className="text-xs text-muted-foreground">
              {range.from} → {range.to} · {filtered.length} report(s)
            </div>
            {job?.status === "failed" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {job.error ?? "Export failed."}
              </div>
            )}
            {Array.isArray(job?.files) && job!.files.length > 0 && (
              <ScrollArea className="max-h-64 rounded-md border">
                <div className="divide-y">
                  {(job!.files as any[]).map((f) => (
                    <button
                      key={f.storage_path}
                      onClick={() => openSignedFile(f.storage_path)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{f.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {(f.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <Download className="h-4 w-4 shrink-0 text-primary" />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJobOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// keep import used
void parseChartNumber;
