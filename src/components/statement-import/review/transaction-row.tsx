import { memo } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MatchSourceBadge } from "../badges";
import { CategoryCombobox } from "./category-combobox";
import { PayeeCombobox } from "./payee-combobox";
import { countRowRender } from "./profiler";
import { ROW_GRID, ROW_HEIGHT, fmtDate, money, type Category, type ReviewRow } from "./types";
import { cn } from "@/lib/utils";


export type RowCallbacks = {
  onToggleSelect: (id: string) => void;
  onPayeeChange: (id: string, payee: string) => void;
  onCategoryChange: (id: string, categoryId: string | null) => void;
  onOpenDetail: (id: string) => void;
};

/**
 * One transaction row. Memoized on row identity + selection so scrolling and
 * edits elsewhere in the grid never rerender it.
 */
export const TransactionRow = memo(function TransactionRow({
  row,
  selected,
  categories,
  payees,
  callbacks,
}: {
  row: ReviewRow;
  selected: boolean;
  categories: Category[];
  payees: string[];
  callbacks: RowCallbacks;
}) {
  countRowRender();
  return (

    <div
      className={cn(
        ROW_GRID,
        "h-full border-b bg-background",
        !selected && "opacity-50",
      )}
      style={{ height: ROW_HEIGHT }}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => callbacks.onToggleSelect(row.key)}
        aria-label={`Include ${row.description}`}
      />
      <span className="text-[11px] tabular-nums text-muted-foreground">{fmtDate(row.date)}</span>
      <button
        type="button"
        onClick={() => callbacks.onOpenDetail(row.key)}
        className="flex min-w-0 items-center gap-1 text-left"
        aria-label={`Open details for ${row.description}`}
      >
        <Info className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate whitespace-nowrap font-mono text-[11px]" title={row.description}>
          {row.description}
        </span>
        {row.duplicate && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-warning" aria-label="Possible duplicate" />
        )}
      </button>
      <PayeeCombobox
        value={row.payee}
        payees={payees}
        onChange={(name) => callbacks.onPayeeChange(row.key, name)}
      />
      <CategoryCombobox
        value={row.category_id}
        categories={categories}
        onChange={(id) => callbacks.onCategoryChange(row.key, id)}
      />
      <span
        className={cn(
          "text-right text-[11px] font-medium tabular-nums",
          row.type === "income" ? "text-success" : "text-foreground",
        )}
      >
        {money(row.amount)}
      </span>
      <span className="flex items-center gap-1">
        <MatchSourceBadge source={row.source} />
      </span>
    </div>
  );
});

/** Placeholder row shown while the next page of transactions materializes. */
export const SkeletonRow = memo(function SkeletonRow() {
  return (
    <div className={cn(ROW_GRID, "h-full border-b")} style={{ height: ROW_HEIGHT }}>
      <span className="h-3.5 w-3.5 rounded bg-muted" />
      <span className="h-3 w-10 rounded bg-muted" />
      <span className="h-3 w-full max-w-[220px] rounded bg-muted" />
      <span className="h-5 w-full rounded bg-muted" />
      <span className="h-5 w-full rounded bg-muted" />
      <span className="ml-auto h-3 w-16 rounded bg-muted" />
      <span className="h-4 w-12 rounded bg-muted" />
    </div>
  );
});
