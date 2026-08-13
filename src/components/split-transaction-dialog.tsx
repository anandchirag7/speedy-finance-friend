import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Split, Calculator, AlertCircle, CheckCircle2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategorySelectPopover, CategoryItem } from "@/components/category-select-popover";
import { saveTransactionSplits } from "@/lib/transactions.functions";
import { cn } from "@/lib/utils";

type SplitRow = {
  id: string;
  category_id: string | null;
  amount: string;
  memo: string;
};

interface SplitTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: {
    id: string;
    merchant?: string | null;
    amount: number | string;
    txn_date: string;
    note?: string | null;
    memo?: string | null;
    category_id?: string | null;
  } | null;
  existingSplits?: Array<{
    id?: string;
    category_id?: string | null;
    amount: number | string;
    memo?: string | null;
  }>;
  categories: CategoryItem[];
  onSuccess?: () => void;
}

export function SplitTransactionDialog({
  open,
  onOpenChange,
  transaction,
  existingSplits,
  categories,
  onSuccess,
}: SplitTransactionDialogProps) {
  const qc = useQueryClient();
  const saveSplitsFn = useServerFn(saveTransactionSplits);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rows, setRows] = useState<SplitRow[]>([]);

  const parentTotal = useMemo(() => {
    if (!transaction) return 0;
    return typeof transaction.amount === "number"
      ? transaction.amount
      : parseFloat(transaction.amount || "0");
  }, [transaction]);

  useEffect(() => {
    if (open && transaction) {
      if (existingSplits && existingSplits.length > 0) {
        setRows(
          existingSplits.map((s, idx) => ({
            id: s.id || `split-${idx}-${Date.now()}`,
            category_id: s.category_id ?? null,
            amount: (typeof s.amount === "number" ? s.amount : parseFloat(s.amount || "0")).toString(),
            memo: s.memo ?? "",
          }))
        );
      } else {
        // Default to 2 empty split lines
        setRows([
          {
            id: `split-0-${Date.now()}`,
            category_id: transaction.category_id ?? null,
            amount: "",
            memo: "",
          },
          {
            id: `split-1-${Date.now()}`,
            category_id: null,
            amount: "",
            memo: "",
          },
        ]);
      }
    }
  }, [open, transaction, existingSplits]);

  const allocatedSum = useMemo(() => {
    return rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  }, [rows]);

  const remaining = useMemo(() => {
    return parentTotal - allocatedSum;
  }, [parentTotal, allocatedSum]);

  const isBalanced = Math.abs(remaining) < 0.01;

  const handleAddLine = () => {
    const autoAmount = remaining > 0 ? remaining.toFixed(2) : "";
    setRows((prev) => [
      ...prev,
      {
        id: `split-${prev.length}-${Date.now()}`,
        category_id: null,
        amount: autoAmount,
        memo: "",
      },
    ]);
  };

  const handleRemoveLine = (index: number) => {
    if (rows.length <= 1) {
      toast.error("A split transaction must have at least 1 category line.");
      return;
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAutoFillRemaining = (index: number) => {
    const currentVal = parseFloat(rows[index].amount) || 0;
    const target = currentVal + remaining;
    if (target < 0) return;
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, amount: target.toFixed(2) } : r))
    );
  };

  const handleSave = async () => {
    if (!transaction) return;
    if (!isBalanced) {
      toast.error(`Allocated amounts must equal total transaction amount (₹${parentTotal.toLocaleString("en-IN")})`);
      return;
    }

    const validSplits = rows.map((r) => ({
      category_id: r.category_id,
      amount: parseFloat(r.amount) || 0,
      memo: r.memo.trim() || undefined,
    }));

    if (validSplits.some((s) => s.amount <= 0)) {
      toast.error("All split lines must have an amount greater than 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      await saveSplitsFn({
        data: {
          transactionId: transaction.id,
          splits: validSplits,
        },
      });
      toast.success("Transaction split successfully!");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["account-txns"] });
      if (onSuccess) onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save split transaction");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-primary" />
            Split Transaction Categories
          </DialogTitle>
          <DialogDescription>
            Divide this transaction into multiple categories. Total split amounts must match the transaction total.
          </DialogDescription>
        </DialogHeader>

        {/* Transaction Summary Card */}
        <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between text-xs">
          <div>
            <div className="font-semibold text-foreground text-sm">
              {transaction.merchant || transaction.note || "Transaction"}
            </div>
            <div className="text-muted-foreground">{transaction.txn_date}</div>
          </div>
          <div className="text-right">
            <div className="text-muted-foreground">Total Amount</div>
            <div className="text-base font-bold text-foreground">
              ₹{parentTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Allocation Summary Bar */}
        <div
          className={cn(
            "rounded-md border p-2.5 flex items-center justify-between text-xs transition-colors",
            isBalanced
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300"
          )}
        >
          <div className="flex items-center gap-2">
            {isBalanced ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            )}
            <div>
              <span className="font-medium">
                Allocated: ₹{allocatedSum.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
              <span className="mx-1.5 opacity-40">|</span>
              <span>
                {isBalanced ? (
                  "Fully Allocated!"
                ) : remaining > 0 ? (
                  `Remaining: ₹${remaining.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                ) : (
                  `Overallocated by ₹${Math.abs(remaining).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                )}
              </span>
            </div>
          </div>
          {!isBalanced && remaining > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2 border-warning/40 bg-background hover:bg-warning/20"
              onClick={() => handleAutoFillRemaining(rows.length - 1)}
            >
              <Calculator className="mr-1 h-3 w-3" /> Auto-fill line {rows.length}
            </Button>
          )}
        </div>

        {/* Split Lines Form */}
        <div className="flex-1 overflow-y-auto space-y-3 py-1 pr-1">
          {rows.map((row, idx) => (
            <div
              key={row.id}
              className="grid grid-cols-12 gap-2 items-start p-2.5 rounded-lg border bg-card hover:border-primary/30 transition-colors"
            >
              <div className="col-span-12 sm:col-span-5 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Category {idx + 1}</Label>
                <CategorySelectPopover
                  categories={categories}
                  value={row.category_id}
                  onChange={(val) =>
                    setRows((prev) =>
                      prev.map((r, i) => (i === idx ? { ...r, category_id: val } : r))
                    )
                  }
                  placeholder="Select category..."
                  className="h-8 text-xs bg-background"
                />
              </div>

              <div className="col-span-6 sm:col-span-3 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Amount (₹)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={row.amount}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r))
                      )
                    }
                    className="h-8 text-xs pl-5 bg-background font-mono"
                  />
                  <span className="absolute left-2 top-2 text-[11px] text-muted-foreground">₹</span>
                </div>
              </div>

              <div className="col-span-5 sm:col-span-3 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Memo / Note</Label>
                <Input
                  type="text"
                  placeholder="Optional memo..."
                  value={row.memo}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) => (i === idx ? { ...r, memo: e.target.value } : r))
                    )
                  }
                  className="h-8 text-xs bg-background"
                />
              </div>

              <div className="col-span-1 sm:col-span-1 flex items-end justify-center pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveLine(idx)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs border-dashed"
            onClick={handleAddLine}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Split Line
          </Button>
        </div>

        <DialogFooter className="pt-2 border-t flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!isBalanced || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
