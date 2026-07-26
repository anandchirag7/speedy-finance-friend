import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

import { getReportsData } from "@/lib/reports.functions";
import { REPORTS, REPORT_CATEGORIES, parseChartNumber, type ReportDef, type ReportOutput } from "@/lib/reports-catalog";
import { exportReportToPDF } from "@/lib/reports-pdf";
import { exportReportToCSV } from "@/lib/reports-csv";
import { ReportChart } from "@/lib/reports-charts";

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

// ---------- Saved presets ----------
type SavedPreset = {
  id: string;
  name: string;
  query: string;
  category: string;
  preset: Preset;
  customFrom: string;
  customTo: string;
};
const PRESET_KEY = "paisa.reports.presets.v1";

function loadPresets(): SavedPreset[] {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function savePresets(list: SavedPreset[]) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(list));
}

function ReportsPage() {
  const dataFn = useServerFn(getReportsData);
  const [preset, setPreset] = useState<Preset>("ytd");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [openReport, setOpenReport] = useState<ReportDef | null>(null);
  const [drillLabel, setDrillLabel] = useState<string | null>(null);
  const [presets, setPresetsState] = useState<SavedPreset[]>([]);

  useEffect(() => setPresetsState(loadPresets()), []);
  useEffect(() => setDrillLabel(null), [openReport]);

  const range = useMemo(() => {
    if (customFrom && customTo) return { from: customFrom, to: customTo };
    return rangeFor(preset);
  }, [preset, customFrom, customTo]);

  const { data, isLoading } = useQuery({
    queryKey: ["reports-data", range.from, range.to],
    queryFn: () => dataFn({ data: range }),
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

  // Apply drill-down filter to preview output (does not affect PDF/CSV of full report unless active).
  const drilledOutput = useMemo<ReportOutput | null>(() => {
    if (!output) return null;
    if (!drillLabel || !output.chart) return output;
    const xCol = output.chart.xCol;
    const rows = output.rows.filter((r) => String(r[xCol] ?? "") === drillLabel);
    return { ...output, rows, footer: undefined };
  }, [output, drillLabel]);

  const handleDownloadPDF = async (report: ReportDef, out?: ReportOutput) => {
    if (!data) {
      toast.error("Data still loading — try again in a moment.");
      return;
    }
    const o = out ?? report.compute(data);
    await exportReportToPDF(report, o, { from: range.from, to: range.to, owner: (data as any)?.profile?.display_name });
    toast.success(`${report.name} exported to PDF`);
  };

  const handleDownloadCSV = (report: ReportDef, out?: ReportOutput) => {
    if (!data) {
      toast.error("Data still loading — try again in a moment.");
      return;
    }
    const o = out ?? report.compute(data);
    exportReportToCSV(report, o, { from: range.from, to: range.to });
    toast.success(`${report.name} exported to CSV`);
  };

  const handleDownloadAll = async () => {
    if (!data) return;
    toast.success(`Exporting ${filtered.length} reports…`);
    for (const r of filtered) {
      const out = r.compute(data);
      await exportReportToPDF(r, out, {
        from: range.from,
        to: range.to,
        owner: (data as any)?.profile?.display_name,
      });
      await new Promise((res) => setTimeout(res, 100));
    }
  };

  // ---------- Preset actions ----------
  const handleSavePreset = () => {
    const name = window.prompt("Name this preset (e.g. 'Q1 spend review')");
    if (!name?.trim()) return;
    const next: SavedPreset = {
      id: `${Date.now()}`,
      name: name.trim(),
      query,
      category,
      preset,
      customFrom,
      customTo,
    };
    const list = [next, ...presets].slice(0, 30);
    savePresets(list);
    setPresetsState(list);
    toast.success(`Saved preset "${name.trim()}"`);
  };
  const applyPreset = (p: SavedPreset) => {
    setQuery(p.query);
    setCategory(p.category);
    setPreset(p.preset);
    setCustomFrom(p.customFrom);
    setCustomTo(p.customTo);
    toast.success(`Applied "${p.name}"`);
  };
  const deletePreset = (id: string) => {
    const list = presets.filter((p) => p.id !== id);
    savePresets(list);
    setPresetsState(list);
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-3 sm:space-y-6 sm:p-4 md:p-6">
      {/* Header */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:flex-wrap sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Reports</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {REPORTS.length}+ prebuilt reports — download as PDF or CSV, save filter presets, drill into any chart.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Presets menu */}
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
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs">Saved filter presets</DropdownMenuLabel>
              <DropdownMenuItem onSelect={handleSavePreset}>
                <BookmarkPlus className="mr-2 h-4 w-4" /> Save current as preset…
              </DropdownMenuItem>
              {presets.length > 0 && <DropdownMenuSeparator />}
              {presets.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No presets yet. Save filters + date ranges to re-run in one click.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {presets.map((p) => (
                    <div
                      key={p.id}
                      className="group flex items-start gap-2 px-2 py-1.5 hover:bg-muted/60"
                    >
                      <button
                        onClick={() => applyPreset(p)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {p.category} · {p.preset}
                          {p.query ? ` · "${p.query}"` : ""}
                          {p.customFrom && p.customTo ? ` · ${p.customFrom}→${p.customTo}` : ""}
                        </div>
                      </button>
                      <button
                        onClick={() => deletePreset(p.id)}
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
          <Button size="sm" onClick={handleDownloadAll} disabled={!data}>
            <Download className="mr-1.5 h-4 w-4" />
            Export {filtered.length}
          </Button>
        </div>
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
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-2xl sm:p-6 lg:max-w-4xl">
          <SheetHeader>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <SheetTitle className="truncate">{openReport?.name}</SheetTitle>
                <SheetDescription className="line-clamp-2">{openReport?.description}</SheetDescription>
                <p className="mt-1 text-xs text-muted-foreground">
                  {range.from} → {range.to}
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
                    {output.kpis.map((k) => (
                      <div key={k.label} className="rounded-lg border bg-muted/30 p-3">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
                        <div className="mt-1 font-display text-base font-semibold sm:text-lg">{k.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {output && (output.chart || output.chart2) && (
                  <div className="mb-4 grid gap-3 lg:grid-cols-2">
                    {output.chart && (
                      <ReportChart
                        output={output}
                        hint={output.chart}
                        height={260}
                        activeLabel={drillLabel}
                        onSegmentClick={setDrillLabel}
                      />
                    )}
                    {output.chart2 && (
                      <ReportChart
                        output={output}
                        hint={output.chart2}
                        height={260}
                        activeLabel={drillLabel}
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
    </div>
  );
}

// keep import used
void parseChartNumber;
