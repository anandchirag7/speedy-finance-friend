import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MatchSource } from "@/lib/statement-clusters";
import { MatchSourceBadge, ConfidenceMeter } from "./badges";
import { cn } from "@/lib/utils";

export type ReviewRow = {
  key: string;
  date: string;
  description: string;
  pattern: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  payee: string;
  category_id: string | null;
  source: MatchSource;
  confidence: number;
  include: boolean;
  duplicate: boolean;
};

type Category = { id: string; name: string; parent_id: string | null };

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const fmtDate = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short" });

type RowFilter = "all" | "included" | "excluded" | "lowConfidence" | "duplicates";

export function ReviewStep({
  rows,
  setRows,
  categories,
  saving,
  onBack,
  onSave,
}: {
  rows: ReviewRow[];
  setRows: (next: ReviewRow[]) => void;
  categories: Category[];
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "included" && !r.include) return false;
      if (filter === "excluded" && r.include) return false;
      if (filter === "lowConfidence" && r.confidence >= 0.7) return false;
      if (filter === "duplicates" && !r.duplicate) return false;
      if (!q) return true;
      return r.description.toLowerCase().includes(q) || r.payee.toLowerCase().includes(q);
    });
  }, [rows, filter, query]);

  const included = rows.filter((r) => r.include);
  const totals = included.reduce(
    (acc, r) => {
      if (r.type === "income") acc.income += Math.abs(r.amount);
      else if (r.type === "expense") acc.expense += Math.abs(r.amount);
      return acc;
    },
    { income: 0, expense: 0 },
  );

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 14,
  });

  const patch = (key: string, p: Partial<ReviewRow>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const allVisibleIncluded = visible.length > 0 && visible.every((r) => r.include);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[
          { label: "Importing", value: included.length.toLocaleString(), tone: "" },
          { label: "Excluded", value: (rows.length - included.length).toLocaleString(), tone: "text-muted-foreground" },
          { label: "Income", value: money(totals.income), tone: "text-success" },
          { label: "Spending", value: money(totals.expense), tone: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-[10px] border bg-card px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className={cn("text-sm font-semibold tabular-nums", s.tone)}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transactions"
            aria-label="Search transactions"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-px rounded-lg border bg-muted/40 p-px">
          {(
            [
              ["all", "All"],
              ["included", "Included"],
              ["excluded", "Excluded"],
              ["lowConfidence", "Low confidence"],
              ["duplicates", "Duplicates"],
            ] as Array<[RowFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors",
                filter === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => {
            const keys = new Set(visible.map((r) => r.key));
            setRows(rows.map((r) => (keys.has(r.key) ? { ...r, include: !allVisibleIncluded } : r)));
          }}
        >
          {allVisibleIncluded ? "Exclude" : "Include"} {visible.length.toLocaleString()} shown
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[28px_64px_minmax(0,1fr)_minmax(0,180px)_minmax(0,150px)_110px_92px] items-center gap-2 border-b bg-muted/40 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span />
          <span>Date</span>
          <span>Description</span>
          <span>Payee</span>
          <span>Category</span>
          <span className="text-right">Amount</span>
          <span>Match</span>
        </div>
        <div ref={parentRef} className="h-full max-h-[46vh] overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const r = visible[v.index]!;
              const open = openKey === r.key;
              return (
                <div
                  key={r.key}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start}px)`,
                  }}
                  className={cn("border-b bg-background", !r.include && "opacity-50")}
                >
                  <div className="grid grid-cols-[28px_64px_minmax(0,1fr)_minmax(0,180px)_minmax(0,150px)_110px_92px] items-center gap-2 px-2 py-1">
                    <Checkbox
                      checked={r.include}
                      onCheckedChange={(c) => patch(r.key, { include: !!c })}
                      aria-label={`Include ${r.description}`}
                    />
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {fmtDate(r.date)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenKey(open ? null : r.key)}
                      aria-expanded={open}
                      className="flex min-w-0 items-center gap-1 text-left"
                    >
                      {open ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="truncate text-[11px] font-mono" title={r.description}>
                        {r.description}
                      </span>
                      {r.duplicate && (
                        <AlertTriangle className="h-3 w-3 shrink-0 text-warning" aria-label="Possible duplicate" />
                      )}
                    </button>
                    <Input
                      value={r.payee}
                      onChange={(e) => patch(r.key, { payee: e.target.value, source: "manual", confidence: 1 })}
                      aria-label="Payee"
                      className="h-7 text-xs"
                    />
                    <Select
                      value={r.category_id ?? "none"}
                      onValueChange={(val) => patch(r.key, { category_id: val === "none" ? null : val })}
                    >
                      <SelectTrigger className="h-7 text-xs" aria-label="Category">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Uncategorized</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.parent_id ? `— ${c.name}` : c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span
                      className={cn(
                        "text-right text-[11px] font-medium tabular-nums",
                        r.type === "income" ? "text-success" : "text-foreground",
                      )}
                    >
                      {money(r.amount)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MatchSourceBadge source={r.source} />
                    </span>
                  </div>
                  {open && (
                    <div className="grid gap-2 border-t bg-muted/25 px-3 py-2 text-[11px] sm:grid-cols-4">
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Raw description</div>
                        <div className="break-words font-mono">{r.description}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Normalized pattern</div>
                        <div className="break-words font-mono">{r.pattern}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Match confidence</div>
                        <ConfidenceMeter value={r.confidence} />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Type / category</div>
                        <div className="capitalize">
                          {r.type} · {r.category_id ? catName.get(r.category_id) ?? "—" : "Uncategorized"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-2.5">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || included.length === 0}>
          {saving ? "Importing…" : `Import ${included.length.toLocaleString()} transactions`}
        </Button>
      </div>
    </div>
  );
}
