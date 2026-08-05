import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, History, Loader2, XCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  listResetAudit,
  previewAccountReset,
  previewHouseholdReset,
  resetAccountData,
  resetHouseholdData,
  type ResetScope,
} from "@/lib/data-reset.functions";

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

/** Safe execution order — child data first, accounts last. */
const RUN_ORDER: ResetScope[] = [
  "chat", "reports", "dashboards", "import_rules", "snapshots", "goals", "budgets",
  "bills", "payees", "categories", "recurring", "investments", "transactions", "accounts",
];

const SCOPE_LABEL = Object.fromEntries(
  SCOPE_GROUPS.flatMap((g) => g.items).map((i) => [i.key, i.label]),
) as Record<ResetScope, string>;

const nf = new Intl.NumberFormat();

type JobState = {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  deleted: string[];
  failed: string | null;
};

const IDLE_JOB: JobState = { running: false, done: 0, total: 0, current: null, deleted: [], failed: null };

function ProgressPanel({ job }: { job: JobState }) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {job.running ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Deleting {job.current ?? "data"}…</>
        ) : job.failed ? (
          <><XCircle className="h-4 w-4 text-destructive" /> Deletion failed</>
        ) : (
          <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Deletion complete</>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{job.done} / {job.total}</span>
      </div>
      <Progress value={pct} />
      {job.failed ? <p className="text-xs text-destructive">{job.failed}</p> : null}
      {job.deleted.length ? (
        <p className="text-xs text-muted-foreground">Removed: {job.deleted.join(", ")}</p>
      ) : null}
    </div>
  );
}

function ResetHistory({ open }: { open: boolean }) {
  const listFn = useServerFn(listResetAudit);
  const { data } = useQuery({
    queryKey: ["reset-audit"],
    queryFn: () => listFn({}),
    enabled: open,
  });
  const rows = (data as any[]) ?? [];
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Deletion history
      </p>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-start gap-2 text-xs">
            {r.status === "success" ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            ) : r.status === "failed" ? (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            )}
            <span className="flex-1">
              <span className="font-medium">
                {r.kind === "household" ? "Factory reset" : r.account_name ? `Account · ${r.account_name}` : "Account reset"}
              </span>{" "}
              <span className="text-muted-foreground">
                {(r.deleted?.length ? r.deleted : r.scopes ?? []).join(", ") || "nothing"}
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {new Date(r.created_at).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FactoryResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const resetFn = useServerFn(resetHouseholdData);
  const previewFn = useServerFn(previewHouseholdReset);
  const [selected, setSelected] = useState<ResetScope[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [job, setJob] = useState<JobState>(IDLE_JOB);
  const [showJob, setShowJob] = useState(false);

  useEffect(() => {
    if (!open) { setJob(IDLE_JOB); setShowJob(false); }
  }, [open]);

  const toggle = (k: ResetScope, v: boolean) =>
    setSelected((prev) => (v ? [...new Set([...prev, k])] : prev.filter((x) => x !== k)));

  const implied = useMemo(() => {
    const s = new Set(selected);
    if (s.has("accounts")) ["transactions", "investments", "recurring"].forEach((k) => s.add(k as ResetScope));
    return s;
  }, [selected]);

  const preview = useQuery({
    queryKey: ["reset-preview", [...selected].sort().join(",")],
    queryFn: () => previewFn({ data: { scopes: selected } }),
    enabled: open && selected.length > 0,
  });
  const previewData = preview.data as
    | { items: { key: string; label: string; count: number }[]; extras: { label: string; count: number }[]; total: number }
    | undefined;

  const reset = useMutation({
    mutationFn: async () => {
      const queue = RUN_ORDER.filter((s) => implied.has(s));
      const counts = Object.fromEntries((previewData?.items ?? []).map((i) => [i.key, i.count]));
      setJob({ running: true, done: 0, total: queue.length, current: SCOPE_LABEL[queue[0]!], deleted: [], failed: null });
      setShowJob(true);
      const deleted: string[] = [];
      for (let i = 0; i < queue.length; i++) {
        const scope = queue[i]!;
        setJob((p) => ({ ...p, current: SCOPE_LABEL[scope], done: i }));
        const r: any = await resetFn({ data: { scopes: [scope], confirm: "DELETE" as const, counts } });
        if (r?.deleted?.length) deleted.push(...r.deleted);
        setJob((p) => ({ ...p, done: i + 1, deleted: [...new Set(deleted)] }));
      }
      return { deleted: [...new Set(deleted)] };
    },
    onSuccess: (r) => {
      setJob((p) => ({ ...p, running: false, current: null }));
      toast.success(`Deleted: ${r.deleted.join(", ") || "nothing"}`);
      qc.invalidateQueries();
      setSelected([]);
      setConfirmText("");
    },
    onError: (e: any) => {
      setJob((p) => ({ ...p, running: false, failed: e?.message ?? "Failed to delete data" }));
      toast.error(e?.message ?? "Failed to delete data");
    },
  });

  const canDelete = selected.length > 0 && confirmText.trim().toUpperCase() === "DELETE" && !reset.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!reset.isPending) onOpenChange(v); }}>
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
                  const n = previewData?.items.find((i) => i.key === item.key)?.count;
                  return (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                    >
                      <Checkbox
                        checked={checked || auto}
                        disabled={auto || reset.isPending}
                        onCheckedChange={(v) => toggle(item.key, !!v)}
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {item.label}
                          {typeof n === "number" ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              {nf.format(n)}
                            </span>
                          ) : null}
                        </span>
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

        {selected.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-semibold">What will be deleted</p>
            {preview.isPending ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting records…
              </p>
            ) : previewData ? (
              <>
                <div className="grid gap-1 text-xs sm:grid-cols-2">
                  {[...previewData.items, ...previewData.extras.map((e) => ({ key: e.label, ...e }))].map((i) => (
                    <div key={i.key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{i.label}</span>
                      <span className="font-semibold tabular-nums">{nf.format(i.count)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs font-semibold">{nf.format(previewData.total)} records in total</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Preview unavailable.</p>
            )}
          </div>
        ) : null}

        {showJob ? <ProgressPanel job={job} /> : null}

        <Separator />

        <div className="space-y-1.5">
          <Label htmlFor="confirm-reset">Type DELETE to confirm</Label>
          <Input
            id="confirm-reset"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            disabled={reset.isPending}
          />
        </div>

        <ResetHistory open={open} />

        <DialogFooter>
          <Button variant="outline" disabled={reset.isPending} onClick={() => onOpenChange(false)}>
            {job.done > 0 && !job.running ? "Close" : "Cancel"}
          </Button>
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
  const previewFn = useServerFn(previewAccountReset);
  const [opts, setOpts] = useState<Record<AccountOptKey, boolean>>({
    transactions: true, bills: false, payees: false, investments: false, recurring: false,
  });
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [job, setJob] = useState<JobState>(IDLE_JOB);
  const [showJob, setShowJob] = useState(false);

  useEffect(() => {
    if (!open) { setJob(IDLE_JOB); setShowJob(false); }
  }, [open]);

  const payload = { account_id: accountId, ...opts, deleteAccount };

  const preview = useQuery({
    queryKey: ["account-reset-preview", accountId, JSON.stringify(payload)],
    queryFn: () => previewFn({ data: payload }),
    enabled: open,
  });
  const previewData = preview.data as { items: { label: string; count: number }[]; total: number } | undefined;

  const reset = useMutation({
    mutationFn: async () => {
      setJob({ running: true, done: 0, total: 1, current: accountName ?? "account data", deleted: [], failed: null });
      setShowJob(true);
      const r: any = await resetFn({ data: { ...payload, confirm: "DELETE" as const } });
      setJob((p) => ({ ...p, done: 1, deleted: r?.deleted ?? [] }));
      return r;
    },
    onSuccess: (r: any) => {
      setJob((p) => ({ ...p, running: false, current: null }));
      toast.success(`Deleted: ${r.deleted?.join(", ") || "nothing"}`);
      qc.invalidateQueries();
      setConfirmText("");
      if (r.accountDeleted) { onOpenChange(false); onDeleted?.(); }
    },
    onError: (e: any) => {
      setJob((p) => ({ ...p, running: false, failed: e?.message ?? "Failed to delete data" }));
      toast.error(e?.message ?? "Failed to delete data");
    },
  });

  const anySelected = deleteAccount || Object.values(opts).some(Boolean);
  const canDelete = anySelected && confirmText.trim().toUpperCase() === "DELETE" && !reset.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!reset.isPending) onOpenChange(v); }}>
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
                disabled={deleteAccount || reset.isPending}
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
            <Checkbox
              checked={deleteAccount}
              disabled={reset.isPending}
              onCheckedChange={(v) => setDeleteAccount(!!v)}
              className="mt-0.5"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Delete the account entirely</span>
              <span className="block text-xs text-muted-foreground">Removes the account and everything attached to it</span>
            </span>
          </label>
        </div>

        {anySelected ? (
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-semibold">What will be deleted</p>
            {preview.isPending ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting records…
              </p>
            ) : previewData ? (
              <>
                <div className="grid gap-1 text-xs">
                  {previewData.items.map((i) => (
                    <div key={i.label} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{i.label}</span>
                      <span className="font-semibold tabular-nums">{nf.format(i.count)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs font-semibold">{nf.format(previewData.total)} records in total</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Preview unavailable.</p>
            )}
          </div>
        ) : null}

        {showJob ? <ProgressPanel job={job} /> : null}

        <div className="space-y-1.5">
          <Label htmlFor="confirm-acct-reset">Type DELETE to confirm</Label>
          <Input
            id="confirm-acct-reset"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            disabled={reset.isPending}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={reset.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!canDelete} onClick={() => reset.mutate()}>
            {reset.isPending ? "Deleting…" : "Delete selected data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
