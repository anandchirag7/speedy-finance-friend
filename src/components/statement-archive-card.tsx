import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Archive,
  Download,
  RefreshCw,
  Eraser,
  FileClock,
  Undo2,
  Mail,
  GitCompare,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getStatementArchiveSettings,
  saveStatementArchiveSettings,
  listStatementUploads,
  getStatementDownloadUrl,
  reparseArchivedStatement,
  pruneStatementArchive,
} from "@/lib/statement-archive.functions";
import {
  diffReparsedStatement,
  undoImportBatch,
  getImportNotifyPrefs,
  saveImportNotifyPrefs,
} from "@/lib/statement-audit.functions";
import { listAccounts } from "@/lib/finance.functions";

type UploadRow = {
  id: string;
  filename: string;
  status: string;
  error: string | null;
  total_transactions: number | null;
  inserted_count: number | null;
  imported_at: string | null;
  created_at: string;
  has_file: boolean;
  size_bytes: number | null;
  archive_expires_at: string | null;
};

type DiffRow = {
  key: string;
  date: string;
  amount: number;
  type: string;
  description: string;
  status: "added" | "changed" | "unchanged";
  changes: Array<{ field: string; before: string; after: string }>;
};

type Diff = {
  added: DiffRow[];
  changed: DiffRow[];
  unchanged: DiffRow[];
  missing: Array<{ id: string; date: string; amount: number; merchant: string | null; note: string | null }>;
  counts: { added: number; changed: number; unchanged: number; missing: number; total: number };
};

function fmtBytes(n: number | null) {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function StatementArchiveCard() {
  const qc = useQueryClient();
  const getSettings = useServerFn(getStatementArchiveSettings);
  const saveSettings = useServerFn(saveStatementArchiveSettings);
  const listUploads = useServerFn(listStatementUploads);
  const downloadFn = useServerFn(getStatementDownloadUrl);
  const reparseFn = useServerFn(reparseArchivedStatement);
  const pruneFn = useServerFn(pruneStatementArchive);
  const listAcc = useServerFn(listAccounts);
  const diffFn = useServerFn(diffReparsedStatement);
  const undoFn = useServerFn(undoImportBatch);
  const getPrefs = useServerFn(getImportNotifyPrefs);
  const savePrefs = useServerFn(saveImportNotifyPrefs);

  const { data: settings } = useQuery({
    queryKey: ["statement-archive-settings"],
    queryFn: () => getSettings(),
  });
  const { data: uploads = [] } = useQuery<UploadRow[]>({
    queryKey: ["statement-uploads"],
    queryFn: () => listUploads() as any,
  });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => listAcc() });
  const { data: prefs } = useQuery({ queryKey: ["import-notify-prefs"], queryFn: () => getPrefs() as any });

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [reparseFor, setReparseFor] = useState<UploadRow | null>(null);
  const [reAccount, setReAccount] = useState("");
  const [reBank, setReBank] = useState("");
  const [diff, setDiff] = useState<{ upload: UploadRow; diff: Diff } | null>(null);
  const [emailOn, setEmailOn] = useState<boolean | null>(null);
  const [emailTo, setEmailTo] = useState<string | null>(null);

  const archiveEnabled = enabled ?? !!(settings as any)?.archive_enabled;
  const retentionDays = days ?? String((settings as any)?.retention_days ?? 90);
  const notifyOn = emailOn ?? !!prefs?.import_email_notifications;
  const notifyTo = emailTo ?? prefs?.notification_email ?? prefs?.account_email ?? "";

  const save = useMutation({
    mutationFn: async () =>
      saveSettings({
        data: {
          archive_enabled: archiveEnabled,
          retention_days: Math.max(1, Math.min(3650, Number(retentionDays) || 90)),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statement-archive-settings"] });
      toast.success("Archive settings saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const saveNotify = useMutation({
    mutationFn: async () =>
      savePrefs({
        data: {
          import_email_notifications: notifyOn,
          notification_email: notifyTo.trim() ? notifyTo.trim() : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["import-notify-prefs"] });
      toast.success("Notification preferences saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const prune = useMutation({
    mutationFn: async () => pruneFn({}) as any,
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["statement-uploads"] });
      toast.success(`Removed ${Number(res?.deleted ?? 0)} expired file(s)`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Cleanup failed"),
  });

  const download = useMutation({
    mutationFn: async (uploadId: string) => downloadFn({ data: { uploadId } }) as any,
    onSuccess: (res: any) => {
      window.open(res.url, "_blank", "noopener,noreferrer");
    },
    onError: (e: any) => toast.error(e?.message ?? "Download failed"),
  });

  /** Re-parse, then diff the result against what is already stored. */
  const reparse = useMutation({
    mutationFn: async () => {
      const upload = reparseFor!;
      const res: any = await reparseFn({
        data: { uploadId: upload.id, accountId: reAccount, bank: reBank.trim() },
      });
      const txns = (res?.transactions ?? []) as Array<{
        date: string;
        description: string;
        amount: number;
        type: "income" | "expense" | "transfer";
      }>;
      if (!txns.length) throw new Error("The re-parse produced no transactions.");
      const d: any = await diffFn({
        data: {
          accountId: reAccount,
          uploadId: upload.id,
          transactions: txns.slice(0, 10000).map((t, i) => ({
            key: `r${i}`,
            date: t.date,
            amount: Number(t.amount),
            type: t.type,
            description: t.description ?? "",
          })),
        },
      });
      return { upload, diff: d as Diff };
    },
    onSuccess: (res) => {
      setReparseFor(null);
      qc.invalidateQueries({ queryKey: ["statement-uploads"] });
      setDiff(res);
    },
    onError: (e: any) => toast.error(e?.message ?? "Re-parse failed"),
  });

  const undo = useMutation({
    mutationFn: async (uploadId: string) => undoFn({ data: { uploadId } }) as any,
    onSuccess: (res: any) => {
      qc.invalidateQueries();
      toast.success(`Rolled back ${Number(res?.deleted ?? 0).toLocaleString()} imported transactions`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Rollback failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-4 w-4" aria-hidden /> Statement archive
        </CardTitle>
        <CardDescription>
          Keep the original uploaded statement files in private storage so imports can be audited, downloaded or
          re-parsed without uploading again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="archive-enabled">Archive uploaded statements</Label>
            <p className="text-xs text-muted-foreground">Files are private — only you and your household can access them.</p>
          </div>
          <Switch id="archive-enabled" checked={archiveEnabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="retention">Retention (days)</Label>
          <Input
            id="retention"
            type="number"
            min={1}
            max={3650}
            value={retentionDays}
            onChange={(e) => setDays(e.target.value)}
            className="max-w-[140px]"
          />
          <p className="text-xs text-muted-foreground">
            Archived files are deleted automatically after this many days. Import history is kept either way.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => prune.mutate()} disabled={prune.isPending}>
            <Eraser className="mr-1.5 h-4 w-4" aria-hidden />
            {prune.isPending ? "Cleaning…" : "Delete expired now"}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>

        <div className="space-y-3 rounded-[10px] border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="import-email" className="flex items-center gap-1.5">
                <Mail className="h-4 w-4" aria-hidden /> Email me import updates
              </Label>
              <p className="text-xs text-muted-foreground">
                In addition to in-app alerts, get an email when parsing, archiving or importing finishes or fails.
              </p>
            </div>
            <Switch id="import-email" checked={notifyOn} onCheckedChange={setEmailOn} />
          </div>
          {notifyOn && (
            <div className="space-y-1.5">
              <Label htmlFor="notify-email">Send to</Label>
              <Input
                id="notify-email"
                type="email"
                value={notifyTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="you@example.com"
                className="max-w-sm"
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => saveNotify.mutate()} disabled={saveNotify.isPending}>
              {saveNotify.isPending ? "Saving…" : "Save notifications"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <FileClock className="h-4 w-4" aria-hidden /> Import history
          </h3>
          {!!uploads.length && (
            <div className="max-h-[380px] overflow-y-auto rounded-[10px] border border-border bg-card">
              <ul className="divide-y divide-border">
                {uploads.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.filename}</p>
                      <p className="text-muted-foreground">
                        {fmtDate(u.created_at)} ·{" "}
                        {u.imported_at
                          ? `${Number(u.inserted_count ?? 0).toLocaleString()} imported`
                          : `${Number(u.total_transactions ?? 0).toLocaleString()} parsed, not imported`}
                        {u.has_file ? ` · ${fmtBytes(u.size_bytes)}` : ""}
                        {u.archive_expires_at && u.has_file ? ` · expires ${fmtDate(u.archive_expires_at)}` : ""}
                      </p>
                      {u.error && <p className="text-destructive">{u.error}</p>}
                    </div>
                    <Badge variant={u.status === "failed" ? "destructive" : "secondary"}>{u.status}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!u.has_file || download.isPending}
                      onClick={() => download.mutate(u.id)}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Download
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!u.has_file}
                      onClick={() => {
                        setReparseFor(u);
                        setReAccount("");
                        setReBank("");
                      }}
                    >
                      <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Re-parse
                    </Button>
                    {u.imported_at && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={undo.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Roll back this import? ${Number(u.inserted_count ?? 0).toLocaleString()} transactions inserted by it will be deleted.`,
                            )
                          )
                            return;
                          undo.mutate(u.id);
                        }}
                      >
                        <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Undo import
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={!!reparseFor} onOpenChange={(v) => !v && setReparseFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-parse statement</DialogTitle>
            <DialogDescription>
              Runs the whole pipeline again on the archived copy of {reparseFor?.filename}, then shows a before/after
              diff. No transactions are saved by re-parsing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select value={reAccount} onValueChange={setReAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick an account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts as Array<{ id: string; name: string }>).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="re-bank">Bank</Label>
              <Input id="re-bank" value={reBank} onChange={(e) => setReBank(e.target.value)} placeholder="HDFC Bank" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReparseFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => reparse.mutate()}
              disabled={!reAccount || !reBank.trim() || reparse.isPending}
            >
              {reparse.isPending ? "Re-parsing…" : "Re-parse & diff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!diff} onOpenChange={(v) => !v && setDiff(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-4 w-4" aria-hidden /> Re-parse diff
            </DialogTitle>
            <DialogDescription>
              How the freshly parsed {diff?.upload.filename} compares with the transactions already stored on this
              account. Nothing has been written.
            </DialogDescription>
          </DialogHeader>

          {diff && (
            <div className="space-y-3 text-xs">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Parsed rows", diff.diff.counts.total],
                  ["Would be added", diff.diff.counts.added],
                  ["Field changes", diff.diff.counts.changed],
                  ["Unchanged", diff.diff.counts.unchanged],
                  ["Only in app", diff.diff.counts.missing],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-[10px] border border-border px-2.5 py-1.5">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{Number(value).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>

              <DiffSection title="New — would be added" rows={diff.diff.added} tone="text-emerald-600" />
              <DiffSection title="Changed fields" rows={diff.diff.changed} tone="text-amber-600" showChanges />
              {!!diff.diff.missing.length && (
                <section className="space-y-1">
                  <h4 className="font-medium text-muted-foreground">
                    In the app but not in this file ({diff.diff.counts.missing.toLocaleString()})
                  </h4>
                  <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-[10px] border border-border">
                    {diff.diff.missing.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                        <span className="truncate">{m.merchant || m.note || "—"}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {m.date} · {m.amount.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="text-muted-foreground">
                To apply these rows, import the statement again from the Transactions page — duplicates are detected and
                explained there.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDiff(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DiffSection({
  title,
  rows,
  tone,
  showChanges,
}: {
  title: string;
  rows: DiffRow[];
  tone: string;
  showChanges?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <section className="space-y-1">
      <h4 className={`font-medium ${tone}`}>
        {title} ({rows.length.toLocaleString()})
      </h4>
      <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-[10px] border border-border">
        {rows.map((r) => (
          <li key={r.key} className="space-y-0.5 px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{r.description || "—"}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.date} · {r.amount.toFixed(2)} · {r.type}
              </span>
            </div>
            {showChanges &&
              r.changes.map((c) => (
                <p key={c.field} className="text-muted-foreground">
                  {c.field}: <span className="line-through">{c.before}</span> → {c.after}
                </p>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
