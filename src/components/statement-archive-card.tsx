import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Archive, Download, RefreshCw, Eraser, FileClock } from "lucide-react";
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

  const { data: settings } = useQuery({
    queryKey: ["statement-archive-settings"],
    queryFn: () => getSettings(),
  });
  const { data: uploads = [] } = useQuery<UploadRow[]>({
    queryKey: ["statement-uploads"],
    queryFn: () => listUploads() as any,
  });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => listAcc() });

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [reparseFor, setReparseFor] = useState<UploadRow | null>(null);
  const [reAccount, setReAccount] = useState("");
  const [reBank, setReBank] = useState("");

  const archiveEnabled = enabled ?? !!(settings as any)?.archive_enabled;
  const retentionDays = days ?? String((settings as any)?.retention_days ?? 90);

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

  const reparse = useMutation({
    mutationFn: async () =>
      reparseFn({ data: { uploadId: reparseFor!.id, accountId: reAccount, bank: reBank.trim() } }) as any,
    onSuccess: (res: any) => {
      setReparseFor(null);
      qc.invalidateQueries({ queryKey: ["statement-uploads"] });
      toast.success(
        `Re-parsed ${Number(res?.transactions?.length ?? 0).toLocaleString()} transactions — open Import to review and save them.`,
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Re-parse failed"),
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

        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <FileClock className="h-4 w-4" aria-hidden /> Import history
          </h3>
          {!uploads.length && <p className="text-xs text-muted-foreground">No statements imported yet.</p>}
          <ul className="divide-y divide-border rounded-[10px] border border-border">
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
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <Dialog open={!!reparseFor} onOpenChange={(v) => !v && setReparseFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-parse statement</DialogTitle>
            <DialogDescription>
              Runs the whole pipeline again on the archived copy of {reparseFor?.filename}. No transactions are saved by
              re-parsing.
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
              {reparse.isPending ? "Re-parsing…" : "Re-parse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
