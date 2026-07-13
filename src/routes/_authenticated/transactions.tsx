import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, ArrowRight, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listTransactions, deleteTransaction } from "@/lib/finance.functions";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatementImportDialog } from "@/components/statement-import-dialog";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({ meta: [{ title: "Transactions — Paisa" }] }),
  component: TransactionsPage,
});

function TransactionsPage() {
  const list = useServerFn(listTransactions);
  const del = useServerFn(deleteTransaction);
  const qc = useQueryClient();
  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => list({ data: { limit: 200 } }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries(); },
  });

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Transactions</h1>
        <p className="text-sm text-muted-foreground">Tap the + button anywhere to add a new one.</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : txns.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            No transactions yet. Use the + button to log your first expense.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {(txns as any[]).map((t) => {
              const Icon = t.type === "income" ? ArrowUpRight : t.type === "expense" ? ArrowDownRight : ArrowRight;
              const toneClass =
                t.type === "income" ? "text-success" : t.type === "expense" ? "text-destructive" : "text-muted-foreground";
              return (
                <div key={t.id} className="group flex items-center gap-3 p-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted ${toneClass}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {t.category?.name ?? (t.type === "transfer" ? "Transfer" : "Uncategorized")}
                      </p>
                      <p className={`shrink-0 font-semibold tabular-nums text-sm ${toneClass}`}>
                        {t.type === "expense" ? "-" : t.type === "income" ? "+" : ""}
                        {formatCurrency(Number(t.amount), t.account?.currency ?? "INR")}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate">
                        {t.account?.name}
                        {t.note ? ` · ${t.note}` : ""}
                      </span>
                      <span>{formatDate(t.txn_date)}</span>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-destructive"
                    onClick={() => delMut.mutate(t.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
