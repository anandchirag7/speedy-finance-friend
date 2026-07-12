import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Plus, Pencil, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AccountFormDialog } from "@/components/account-form-dialog";
import { listAccounts, deleteAccount } from "@/lib/finance.functions";
import { formatCurrency, maskAccount } from "@/lib/format";
import { ACCOUNT_TYPE_BY_CATEGORY, GROUP_LABELS, type AccountTypeDef } from "@/lib/account-types";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Accounts — Paisa" }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const fn = useServerFn(listAccounts);
  const del = useServerFn(deleteAccount);
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ["accounts"], queryFn: fn });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Account deleted");
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const grouped: Record<string, any[]> = {};
  for (const a of accounts as any[]) {
    const def = ACCOUNT_TYPE_BY_CATEGORY[a.category as keyof typeof ACCOUNT_TYPE_BY_CATEGORY];
    const group = def?.group ?? "other";
    (grouped[group] ??= []).push(a);
  }
  const groupOrder: AccountTypeDef["group"][] = ["cash", "credit", "deposits", "retirement", "market", "post_office", "gold", "property", "loans", "insurance", "other"];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted-foreground">Every place your money lives, owes, or grows.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Add account
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium">No accounts yet</p>
              <p className="text-sm text-muted-foreground">Start with your primary bank or credit card.</p>
            </div>
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="h-4 w-4" /> Add first account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupOrder.filter((g) => grouped[g]?.length).map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{GROUP_LABELS[g]}</h2>
              <div className="grid gap-2 md:grid-cols-2">
                {grouped[g].map((a) => {
                  const def = ACCOUNT_TYPE_BY_CATEGORY[a.category as keyof typeof ACCOUNT_TYPE_BY_CATEGORY];
                  const bal = Number(a.current_balance);
                  return (
                    <Card key={a.id} className="group">
                      <CardContent className="pt-5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-medium">{a.name}</p>
                              {a.excluded_from_net_worth && (
                                <Badge variant="outline" className="text-[10px]">non-NW</Badge>
                              )}
                              {!a.is_active && <Badge variant="secondary" className="text-[10px]">archived</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {def?.label}
                              {a.subtype ? ` · ${a.subtype}` : ""}
                              {a.institution ? ` · ${a.institution}` : ""}
                              {a.account_number_last4 ? ` · ${maskAccount(a.account_number_last4)}` : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold tabular-nums ${a.is_liability ? "text-destructive" : ""}`}>
                              {a.is_liability && bal > 0 ? "-" : ""}
                              {formatCurrency(bal, a.currency)}
                            </p>
                            <div className="mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(a); setOpen(true); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                onClick={() => {
                                  if (confirm(`Delete "${a.name}"? All its transactions will also be removed.`)) {
                                    delMut.mutate(a.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <AccountFormDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}
