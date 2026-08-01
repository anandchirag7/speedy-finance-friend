import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ReviewRow = {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  suggestedCategory: string;
  payee: string;
  merchant: string;
  category_id: string | null;
  include: boolean;
  pattern?: string;
};

type Category = { id: string; name: string; kind: string; parent_id: string | null };

const GRID =
  "grid grid-cols-[36px_120px_minmax(120px,1fr)_minmax(160px,2fr)_100px_112px_minmax(140px,1fr)_40px] items-center gap-2 px-2";

/**
 * Virtualized review grid — renders only the visible rows so statements with
 * thousands of transactions stay responsive.
 */
export function StatementReviewTable({
  rows,
  setRows,
  categories,
}: {
  rows: ReviewRow[];
  setRows: (r: ReviewRow[]) => void;
  categories: Category[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 12,
  });

  const patch = (i: number, p: Partial<ReviewRow>) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], ...p };
    setRows(copy);
  };

  return (
    <div className="flex-1 min-h-0 overflow-hidden rounded-md border">
      <div className={`${GRID} border-b bg-muted/50 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground`}>
        <span />
        <span>Date</span>
        <span>Payee</span>
        <span>Description</span>
        <span>Type</span>
        <span className="text-right">Amount</span>
        <span>Category</span>
        <span />
      </div>
      <div ref={scrollRef} className="h-full max-h-[52vh] overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const i = v.index;
            const r = rows[i];
            if (!r) return null;
            return (
              <div
                key={v.key}
                data-index={i}
                ref={virtualizer.measureElement}
                className={`${GRID} absolute left-0 top-0 w-full border-b py-1.5 ${r.include ? "" : "opacity-40"}`}
                style={{ transform: `translateY(${v.start}px)` }}
              >
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => patch(i, { include: e.target.checked })}
                />
                <Input
                  type="date"
                  value={r.date}
                  onChange={(e) => patch(i, { date: e.target.value })}
                  className="h-8 px-2 text-xs"
                />
                <Input
                  value={r.merchant}
                  onChange={(e) => patch(i, { merchant: e.target.value })}
                  className="h-8 px-2 text-xs font-medium"
                />
                <span className="truncate text-xs text-muted-foreground" title={r.description}>
                  {r.description}
                </span>
                <Select value={r.type} onValueChange={(val: any) => patch(i, { type: val })}>
                  <SelectTrigger className="h-8 px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  value={r.amount}
                  onChange={(e) => patch(i, { amount: Number(e.target.value) })}
                  className="h-8 px-2 text-right text-xs tabular-nums"
                />
                <Select
                  value={r.category_id ?? "none"}
                  onValueChange={(val) => patch(i, { category_id: val === "none" ? null : val })}
                >
                  <SelectTrigger className="h-8 px-2 text-xs">
                    <SelectValue placeholder={r.suggestedCategory || "Uncategorized"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Uncategorized</SelectItem>
                    {categories
                      .filter((c) => c.kind === r.type || r.type === "transfer")
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
