import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { resetAccountData, resetHouseholdData, type ResetScope } from "@/lib/data-reset.functions";

type ScopeDef = { key: ResetScope; label: string; hint: string };

const SCOPE_GROUPS: { title: string; items: ScopeDef[] }[] = [
  {
    title: "Money records",
    items: [
      { key: "transactions", label: "Transactions", hint: "All transactions, comments, attachments & activity" },
      { key: "accounts", label: "Accounts", hint: "Deletes every account (also removes their transactions)" },
      { key: "investments", label: "Investments", hint: "Holdings and holding transactions" },
      { key: "snapshots", label: "Net worth history", hint: "Historical net worth snapshots" },
    ],
  },
  {
    title: "Planning",
    items: [
      { key: "bills", label: "Bills & reminders", hint: "Bills, payment history and reminder logs" },
      { key: "budgets", label: "Budgets", hint: "Monthly budgets and category allocations" },
      { key: "goals", label: "Goals", hint: "Savings goals and linked accounts" },
      { key: "recurring", label: "Recurring templates", hint: "Scheduled/recurring transaction templates" },
    ],
  },
  {
    title: "Organisation",
    items: [
      { key: "payees", label: "Memorized payees", hint: "Payees, aliases and payee rules" },
      { key: "categories", label: "Categories", hint: "All categories and subcategories" },
      { key: "import_rules", label: "Import rules", hint: "Statement import mapping rules" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { key: "dashboards", label: "Dashboards & saved views", hint: "Custom dashboard layouts and table views" },
      { key: "reports", label: "Report presets & exports", hint: "Saved report presets and generated files" },
      { key: "chat", label: "Assistant chats", hint: "AI assistant threads and messages" },
    ],
  },
];

const ALL_SCOPES = SCOPE_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export function FactoryResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const resetFn = useServerFn(resetHouseholdData);
  const [selected, setSelected] = useState<ResetScope[]>([]);
  const [confirmText, setConfirmText] = useState("");

  const toggle = (k: ResetScope, v: boolean) =>
    setSelected((prev) => (v ? [...new Set([...prev, k])] : prev.filter((x) => x !== k)));

  const implied = useMemo(() => {
    const s = new Set(selected);
    if (s.has("accounts")) ["transactions", "investments", "recurring"].forEach((k) => s.add(k as ResetScope));
    return s;
  }, [selected]);

  const reset = useMutation({
    mutationFn: async () => resetFn({ data: { scopes: selected, confirm: "DELETE" as const } }),
    onSuccess: (r: any) => {
      toast.success(`Deleted: ${r.deleted?.join(", ") || "nothing"}`);
      qc.invalidateQueries();
      onOpenChange(false);
      setSelected([]);
      setConfirmText("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete data"),
  });

  const canDelete = selected.length > 0 && confirmText.trim().toUpperCase() === "DELETE" && !reset.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Delete data / factory reset
          </DialogTitle>
          <DialogDescription>
            Choose exactly what you want to erase. This permanently deletes the selected data for your household and
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
          <p className="text-sm font-medium">{selected.length} of {ALL_SCOPES.length} areas selected</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(ALL_SCOPES)}>Select everything</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          </div>
        </div>

        <div className="space-y-4">
          {SCOPE_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.items.map((item) => {
                  const checked = selected.includes(item.key);
                  const auto = !checked && implied.has(item.key);
                  return (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                    >
                      <Checkbox
                        checked={checked || auto}
                        disabled={auto}
                        onCheckedChange={(v) => toggle(item.key, !!v)}
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {auto ? "Included because accounts are being deleted" : item.hint}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Separator />

        <div className="space-y-1.5">
          <Label htmlFor="confirm-reset">Type DELETE to confirm</Label>
          <Input
            id="confirm-reset"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!canDelete} onClick={() => reset.mutate()}>
            {reset.isPending ? "Deleting…" : "Delete selected data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACCOUNT_OPTIONS = [
  { key: "transactions", label: "Transactions", hint: "Every transaction in this register" },
  { key: "bills", label: "Bills linked to this account", hint: "Bills, payments and reminder logs" },
  { key: "payees", label: "Memorized payees for this account", hint: "Payees and their rules" },
  { key: "investments", label: "Holdings", hint: "Holdings and holding transactions" },
  { key: "recurring", label: "Recurring templates", hint: "Scheduled entries for this account" },
] as const;

type AccountOptKey = (typeof ACCOUNT_OPTIONS)[number]["key"];

export function AccountResetDialog({
  open, onOpenChange, accountId, accountName, onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  accountName?: string;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const resetFn = useServerFn(resetAccountData);
  const [opts, setOpts] = useState<Record<AccountOptKey, boolean>>({
    transactions: true, bills: false, payees: false, investments: false, recurring: false,
  });
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const reset = useMutation({
    mutationFn: async () =>
      resetFn({ data: { account_id: accountId, confirm: "DELETE" as const, ...opts, deleteAccount } }),
    onSuccess: (r: any) => {
      toast.success(`Deleted: ${r.deleted?.join(", ") || "nothing"}`);
      qc.invalidateQueries();
      onOpenChange(false);
      setConfirmText("");
      if (r.accountDeleted) onDeleted?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete data"),
  });

  const anySelected = deleteAccount || Object.values(opts).some(Boolean);
  const canDelete = anySelected && confirmText.trim().toUpperCase() === "DELETE" && !reset.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Reset {accountName ?? "account"} data
          </DialogTitle>
          <DialogDescription>
            Pick what to erase for this account. Balances are reset to the opening balance unless the account itself is
            deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {ACCOUNT_OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-accent/40">
              <Checkbox
                checked={deleteAccount || opts[o.key]}
                disabled={deleteAccount}
                onCheckedChange={(v) => setOpts((p) => ({ ...p, [o.key]: !!v }))}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <Checkbox checked={deleteAccount} onCheckedChange={(v) => setDeleteAccount(!!v)} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Delete the account entirely</span>
              <span className="block text-xs text-muted-foreground">Removes the account and everything attached to it</span>
            </span>
          </label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-acct-reset">Type DELETE to confirm</Label>
          <Input
            id="confirm-acct-reset"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!canDelete} onClick={() => reset.mutate()}>
            {reset.isPending ? "Deleting…" : "Delete selected data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
