import { memo } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROW_GRID, money, type RowFilter } from "./types";
import { cn } from "@/lib/utils";

const FILTERS: Array<[RowFilter, string]> = [
  ["all", "All"],
  ["included", "Included"],
  ["excluded", "Excluded"],
  ["lowConfidence", "Low confidence"],
  ["duplicates", "Duplicates"],
];

/** Fixed KPI strip — memoized so it never rerenders while scrolling rows. */
export const ProcessingStatus = memo(function ProcessingStatus({
  included,
  excluded,
  income,
  expense,
}: {
  included: number;
  excluded: number;
  income: number;
  expense: number;
}) {
  const cards = [
    { label: "Importing", value: included.toLocaleString(), tone: "" },
    { label: "Excluded", value: excluded.toLocaleString(), tone: "text-muted-foreground" },
    { label: "Income", value: money(income), tone: "text-success" },
    { label: "Spending", value: money(expense), tone: "text-destructive" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {cards.map((s) => (
        <div key={s.label} className="rounded-[10px] border bg-card px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
          <div className={cn("text-sm font-semibold tabular-nums", s.tone)}>{s.value}</div>
        </div>
      ))}
    </div>
  );
});

/** Search + filter chips + bulk include toggle. */
export const TransactionToolbar = memo(function TransactionToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  visibleCount,
  allVisibleIncluded,
  onToggleVisible,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  filter: RowFilter;
  onFilterChange: (f: RowFilter) => void;
  visibleCount: number;
  allVisibleIncluded: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative min-w-[180px] flex-1">
        <Search
          className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search transactions"
          aria-label="Search transactions"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="flex items-center gap-px rounded-lg border bg-muted/40 p-px">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={cn(
              "rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors",
              filter === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onToggleVisible}>
        {allVisibleIncluded ? "Exclude" : "Include"} {visibleCount.toLocaleString()} shown
      </Button>
    </div>
  );
});

/** Sticky table header, aligned to the row grid. */
export const TransactionTableHeader = memo(function TransactionTableHeader() {
  return (
    <div
      className={cn(
        ROW_GRID,
        "border-b bg-muted/40 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
      )}
    >
      <span />
      <span>Date</span>
      <span>Description</span>
      <span>Payee</span>
      <span>Category</span>
      <span className="text-right">Amount</span>
      <span>Match</span>
    </div>
  );
});

/** Fixed footer with the selected count and the primary save action. */
export const TransactionFooter = memo(function TransactionFooter({
  includedCount,
  saving,
  onBack,
  onSave,
}: {
  includedCount: number;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t pt-2.5">
      <Button variant="ghost" size="sm" onClick={onBack}>
        Back to payees
      </Button>
      <div className="flex items-center gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {includedCount.toLocaleString()} selected
        </span>
        <Button size="sm" onClick={onSave} disabled={saving || includedCount === 0}>
          {saving ? "Importing…" : `Save ${includedCount.toLocaleString()} transactions`}
        </Button>
      </div>
    </div>
  );
});
