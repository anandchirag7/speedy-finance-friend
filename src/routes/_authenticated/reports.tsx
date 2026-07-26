import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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

import { getReportsData } from "@/lib/reports.functions";
import { REPORTS, REPORT_CATEGORIES, type ReportDef } from "@/lib/reports-catalog";
import { exportReportToPDF } from "@/lib/reports-pdf";
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

function ReportsPage() {
  const dataFn = useServerFn(getReportsData);
  const [preset, setPreset] = useState<Preset>("ytd");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [openReport, setOpenReport] = useState<ReportDef | null>(null);

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

  const handleDownload = async (report: ReportDef) => {
    if (!data) {
      toast.error("Data still loading — try again in a moment.");
      return;
    }
    const out = report.compute(data);
    await exportReportToPDF(report, out, { from: range.from, to: range.to, owner: (data as any)?.profile?.display_name });
    toast.success(`${report.name} downloaded`);
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

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            {REPORTS.length}+ prebuilt reports across cash flow, spending, wealth, and tax — each downloadable as a
            polished PDF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
            <CalendarIcon className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" />
            {(["1m", "3m", "6m", "ytd", "1y", "all"] as Preset[]).map((p) => (
              <Button
                key={p}
                variant={preset === p && !customFrom ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 text-xs uppercase"
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
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-9 w-[140px]"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-9 w-[140px]"
          />
          <Button size="sm" onClick={handleDownloadAll} disabled={!data}>
            <Download className="mr-1.5 h-4 w-4" />
            Export {filtered.length}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search reports…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="All">All</TabsTrigger>
            {REPORT_CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c}>
                {c}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Report grid */}
      {isLoading && !data ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <Card
                    key={r.id}
                    className="group cursor-pointer transition-all hover:border-primary/40 hover:shadow-md"
                    onClick={() => setOpenReport(r)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-semibold leading-tight">{r.name}</CardTitle>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(r);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
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
        <SheetContent side="right" className="w-full sm:max-w-2xl lg:max-w-4xl">
          <SheetHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <SheetTitle>{openReport?.name}</SheetTitle>
                <SheetDescription>{openReport?.description}</SheetDescription>
                <p className="mt-1 text-xs text-muted-foreground">
                  {range.from} → {range.to}
                </p>
              </div>
              <Button size="sm" disabled={!data} onClick={() => openReport && handleDownload(openReport)}>
                <Download className="mr-1.5 h-4 w-4" /> PDF
              </Button>
            </div>
          </SheetHeader>
          <div className="mt-4">
            {!output ? (
              <Skeleton className="h-64" />
            ) : (
              <>
                {output.kpis && output.kpis.length > 0 && (
                  <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                    {output.kpis.map((k) => (
                      <div key={k.label} className="rounded-lg border bg-muted/30 p-3">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
                        <div className="mt-1 font-display text-lg font-semibold">{k.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {output.rows.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {output.emptyMessage ?? "No data for this period."}
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-260px)] rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                        <tr>
                          {output.columns.map((c, i) => (
                            <th
                              key={i}
                              className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                                output.numericColumns?.includes(i) ? "text-right" : ""
                              }`}
                            >
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {output.rows.slice(0, 500).map((r, ri) => (
                          <tr key={ri} className="border-t hover:bg-muted/30">
                            {r.map((c, ci) => (
                              <td
                                key={ci}
                                className={`px-3 py-2 ${
                                  output.numericColumns?.includes(ci) ? "text-right font-mono tabular-nums" : ""
                                }`}
                              >
                                {String(c)}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {output.footer && (
                          <tr className="border-t bg-muted/40 font-semibold">
                            {output.footer.map((c, ci) => (
                              <td
                                key={ci}
                                className={`px-3 py-2 ${
                                  output.numericColumns?.includes(ci) ? "text-right font-mono tabular-nums" : ""
                                }`}
                              >
                                {String(c)}
                              </td>
                            ))}
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {output.rows.length > 500 && (
                      <div className="border-t p-3 text-center text-xs text-muted-foreground">
                        Preview limited to 500 rows. The PDF export includes all {output.rows.length}.
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
