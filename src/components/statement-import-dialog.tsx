import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Upload,
  Sparkles,
  FileSearch,
  ListChecks,
  Table2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Archive,
  X,
  Download,
  FileText,
  Undo2,
  ShieldQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { listAccounts } from "@/lib/finance.functions";
import { polishPayeeNames, bulkInsertTransactions } from "@/lib/statement-import.functions";
import { startStatementUpload, saveMerchantCorrections } from "@/lib/statement-pipeline.functions";
import { cancelStatementUpload } from "@/lib/statement-archive.functions";
import {
  explainImportDuplicates,
  notifyImportEvent,
  undoImportBatch,
} from "@/lib/statement-audit.functions";
import { exportImportToCSV, exportImportToPDF } from "@/lib/statement-export";
import { useStatementClassification } from "@/hooks/use-statement-classification";
import type { StatementDetection } from "@/lib/statement-detect";
import {
  buildClusters,
  clusterTxnCount,
  mergeClusters,
  summarize,
  type Cluster,
  type ClusterTxn,
  type ResolvedEntry,
} from "@/lib/statement-clusters";
import { ImportStep } from "./statement-import/import-step";
import {
  ProcessingTimeline,
  STAGE_ORDER,
  emptyStats,
  type ProcessingStats,
  type Stage,
  type StageKey,
} from "./statement-import/parsing-timeline";
import { ConfirmStep } from "./statement-import/confirm-step";
import { ReviewStep, type ReviewRow } from "./statement-import/review-step";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string; kind: string; parent_id: string | null };

type Step = "import" | "parsing" | "confirm" | "review";

type Activity =
  | { kind: "idle" }
  | { kind: "busy"; label: string; detail?: string }
  | { kind: "ok"; label: string; detail?: string }
  | { kind: "error"; label: string; detail?: string };

const STEPS: Array<{ key: Step; label: string; Icon: typeof FileSearch }> = [
  { key: "import", label: "Import", Icon: Upload },
  { key: "parsing", label: "Parsing", Icon: FileSearch },
  { key: "confirm", label: "Confirm payees", Icon: ListChecks },
  { key: "review", label: "Review", Icon: Table2 },
];


function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.includes(",") ? s.split(",")[1]! : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Stepper({ step }: { step: Step }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto" aria-label="Import progress">
      {STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "upcoming";
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-1.5">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                state === "current" && "border-primary/50 bg-primary/10 text-primary",
                state === "done" && "border-success/30 bg-success/10 text-success",
                state === "upcoming" && "border-border text-muted-foreground",
              )}
            >
              <s.Icon className="h-3 w-3" aria-hidden />
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function ActivityBanner({ activity, onDismiss }: { activity: Activity; onDismiss?: () => void }) {
  if (activity.kind === "idle") return null;
  const Icon =
    activity.kind === "busy" ? Loader2 : activity.kind === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-[10px] border px-2.5 py-1.5 text-[11px]",
        activity.kind === "busy" && "border-info/30 bg-info/5 text-info",
        activity.kind === "ok" && "border-success/30 bg-success/5 text-success",
        activity.kind === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
      )}
    >
      <Icon
        className={cn("mt-px h-3.5 w-3.5 shrink-0", activity.kind === "busy" && "animate-spin")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{activity.label}</p>
        {activity.detail && <p className="mt-0.5 break-words opacity-80">{activity.detail}</p>}
      </div>
      {onDismiss && activity.kind !== "busy" && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function StatementImportDialog() {
  const startFn = useServerFn(startStatementUpload);
  const correctionsFn = useServerFn(saveMerchantCorrections);
  const saveFn = useServerFn(bulkInsertTransactions);
  const polishFn = useServerFn(polishPayeeNames);
  const cancelFn = useServerFn(cancelStatementUpload);
  const explainDupFn = useServerFn(explainImportDuplicates);
  const notifyFn = useServerFn(notifyImportEvent);
  const undoFn = useServerFn(undoImportBatch);
  const qc = useQueryClient();
  const listAcc = useServerFn(listAccounts);
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => listAcc() });

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("import");
  const [accountId, setAccountId] = useState("");
  const [bank, setBank] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [detection, setDetection] = useState<StatementDetection | null>(null);
  const [seenFingerprints, setSeenFingerprints] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [activity, setActivity] = useState<Activity>({ kind: "idle" });
  const [archived, setArchived] = useState(false);

  const [rawTxns, setRawTxns] = useState<ClusterTxn[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [importToken, setImportToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReviewRow[] | null>(null);
  const [dupScanning, setDupScanning] = useState(false);
  const [lastBatch, setLastBatch] = useState<{ batchId: string; count: number } | null>(null);

  const [stageStates, setStageStates] = useState<Record<StageKey, Stage>>(() =>
    Object.fromEntries(STAGE_ORDER.map((k) => [k, { key: k, state: "pending" }])) as Record<StageKey, Stage>,
  );
  const [stats, setStats] = useState<ProcessingStats>(emptyStats);
  const [operation, setOperation] = useState("Waiting for a file");
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const uploadIdRef = useRef<string | null>(null);
  const pendingCorrections = useRef<
    Array<{ normalizedPattern: string; payeeName: string; category: string | null }>
  >([]);

  const abortInFlight = useCallback(
    (reason: string) => {
      const ctl = abortRef.current;
      abortRef.current = null;
      if (ctl && !ctl.signal.aborted) ctl.abort(new Error(reason));
      const id = uploadIdRef.current;
      if (id) void cancelFn({ data: { uploadId: id } }).catch(() => undefined);
    },
    [cancelFn],
  );




  const classification = useStatementClassification(uploadId);

  const categoryIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.name.toLowerCase(), c.id);
    return m;
  }, [categories]);

  // elapsed timer while parsing
  useEffect(() => {
    if (step !== "parsing") return;
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    return () => window.clearInterval(t);
  }, [step]);

  const setStage = (key: StageKey, patch: Partial<Stage>) =>
    setStageStates((prev) => ({ ...prev, [key]: { ...prev[key], key, ...patch } }));

  // Background AI naming streams in — fill clusters still waiting on a name.
  useEffect(() => {
    const resolved = classification.resolved;
    if (!resolved || !Object.keys(resolved).length) return;
    setClusters((prev) =>
      prev.map((c) => {
        if (!c.pendingAi) return c;
        const hit = c.patterns.map((p) => resolved[p]).find(Boolean);
        if (!hit) return c;
        return {
          ...c,
          name: hit.payee,
          originalName: hit.payee,
          pendingAi: false,
          source: "ai",
          confidence: Math.max(c.confidence, 0.72),
          status: c.status === "review" ? "suggested" : c.status,
          category_id:
            c.category_id ??
            (hit.category ? categoryIdByName.get(hit.category.toLowerCase()) ?? null : null),
        };
      }),
    );
  }, [classification.resolved, categoryIdByName]);

  const aiRemaining = clusters.filter((c) => c.pendingAi).length;

  const reset = () => {
    setStep("import");
    setAccountId("");
    setBank("");
    setFile(null);
    setDetection(null);
    setRawTxns([]);
    setCategories([]);
    setClusters([]);
    setRows([]);
    setUploadId(null);
    uploadIdRef.current = null;
    setImportToken(null);
    setPreview(null);
    setDupScanning(false);
    setArchived(false);
    setActivity({ kind: "idle" });
    setStats(emptyStats);
    setOperation("Waiting for a file");
    setElapsed(0);
    pendingCorrections.current = [];

    setStageStates(
      Object.fromEntries(STAGE_ORDER.map((k) => [k, { key: k, state: "pending" }])) as Record<StageKey, Stage>,
    );
  };


  const onParse = async () => {
    if (!accountId || !bank || !file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setParsing(true);
    setActivity({ kind: "busy", label: `Parsing ${file.name}`, detail: "No data is saved during this step." });
    setStep("parsing");
    startedAt.current = Date.now();
    setElapsed(0);
    const estimate = detection?.estimatedRows ?? 0;

    try {
      setOperation(`Reading ${file.name}`);
      setStage("read", { state: "active" });
      const base64 = await readFileAsBase64(file);
      if (controller.signal.aborted) return;
      setStage("read", { state: "done", ms: Date.now() - startedAt.current });

      setStage("table", { state: "active" });
      setStage("rows", { state: "active", processed: 0, total: estimate || undefined });
      setOperation("Extracting rows from the statement");

      const res = await startFn({
        data: {
          accountId,
          bank,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
        },
        signal: controller.signal,
      } as any);
      if (controller.signal.aborted) return;

      for (const k of ["table", "rows", "columns", "parse"] as StageKey[]) {
        setStage(k, { state: "done" });
      }
      setStage("rows", { state: "done", processed: res.transactions.length, total: res.transactions.length });


      if (!res.transactions.length) {
        setStage("parse", { state: "error", detail: "no transactions found" });
        toast.error("No transactions found in file");
        setStep("import");
        return;
      }

      setCategories(res.categories as Category[]);

      const txns: ClusterTxn[] = res.transactions.map((t, i) => ({
        key: `t${i}`,
        date: t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        pattern: t.pattern || "MISC",
      }));
      setRawTxns(txns);

      const uniqueDescriptions = new Set(txns.map((t) => t.description)).size;
      const patterns = new Set(txns.map((t) => t.pattern));

      setStage("dedupe", { state: "done", detail: `${uniqueDescriptions.toLocaleString()} unique descriptions` });
      setStage("normalize", { state: "done", detail: `${patterns.size.toLocaleString()} merchant patterns` });
      setOperation("Matching against your payees and the merchant dictionary");

      const resolved = res.resolved as Record<string, ResolvedEntry>;
      const built = buildClusters({
        transactions: txns,
        resolved,
        existingPayees: res.existingPayees,
        categoryIdByName,
      });

      const matchedPayees = built.filter((c) => c.source === "payee" || c.source === "alias").length;
      const rulesMatched = built.filter((c) => c.source === "rule").length;
      const pending = built.filter((c) => c.pendingAi).length;

      setStage("payees", { state: "done", detail: `${matchedPayees} matched` });
      setStage("rules", { state: "done", detail: `${rulesMatched} rule hits` });
      setStage("cluster", { state: "done", detail: `${built.length} clusters` });
      setStage("ai", pending ? { state: "active", detail: `${pending} unresolved` } : { state: "done", detail: "nothing to name" });
      setStage("review", { state: "done" });

      setStats({
        rowsScanned: Math.max(estimate, txns.length),
        transactions: txns.length,
        duplicatesRemoved: Math.max(0, txns.length - uniqueDescriptions),
        uniqueDescriptions,
        payeesMatched: matchedPayees,
        rulesMatched,
        clusters: built.length,
        aiRemaining: pending,
        exceptions: built.filter((c) => c.status === "review").length,
      });

      setClusters(built);
      setUploadId(res.uploadId);
      uploadIdRef.current = res.uploadId;
      setImportToken((res as any).importToken ?? null);
      setArchived(!!(res as any).archived);
      if (detection?.fingerprint) {
        setSeenFingerprints((prev) => Array.from(new Set([...prev, detection.fingerprint])));
      }
      setStep("confirm");
      setActivity({
        kind: "ok",
        label: `Parsed ${txns.length.toLocaleString()} transactions — nothing saved yet`,
        detail:
          (pending ? `Naming ${pending} payees in the background. ` : "All payees recognised. ") +
          ((res as any).archived
            ? "The original file was archived privately for audit and re-parse."
            : "The original file was not archived (archiving is off in Settings)."),
      });
      toast.success(
        `${txns.length.toLocaleString()} transactions · ${built.length} payee clusters` +
          (pending ? ` · naming ${pending} in the background` : " · all recognised"),
      );
    } catch (e: any) {
      if (controller.signal.aborted) {
        setOperation("Cancelled");
        setActivity({ kind: "ok", label: "Import cancelled — nothing was saved" });
        setStep("import");
        return;
      }
      setOperation("Failed");
      setStage("parse", { state: "error", detail: e?.message ?? "parse failed" });
      setActivity({
        kind: "error",
        label: "Parsing failed — no transactions were saved",
        detail: e?.message ?? "Unknown error",
      });
      toast.error(e?.message ?? "Failed to parse statement");
      setStep("import");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setParsing(false);
    }
  };

  const onCancelParsing = () => {
    abortInFlight("Cancelled by user");
    setParsing(false);
    setOperation("Cancelled");
    setActivity({ kind: "ok", label: "Import cancelled — nothing was saved" });
    setStep("import");
  };


  const onPolish = async () => {
    const targets = clusters.filter((c) => c.status !== "ignored" && !c.isExisting);
    if (!targets.length) return toast.info("Nothing to polish");
    setPolishing(true);
    try {
      const res: any = await polishFn({
        data: {
          clusters: targets.map((c) => ({
            name: c.name,
            sample: c.members[0]?.description.slice(0, 200) ?? "",
            count: clusterTxnCount(c),
          })),
        },
      });
      const renames: Record<string, string> = res?.renames ?? {};
      let next = clusters.map((c) => {
        const i = targets.indexOf(c);
        const rename = i >= 0 ? renames[String(i)] : undefined;
        return rename ? { ...c, name: rename, source: "ai" as const, status: "suggested" as const } : c;
      });
      const merges: number[][] = Array.isArray(res?.merges) ? res.merges : [];
      for (const group of merges) {
        const ids = group.map((i) => targets[i]?.id).filter(Boolean) as string[];
        if (ids.length > 1) next = mergeClusters(next, ids);
      }
      setClusters(next);
      toast.success("Names polished");
    } catch (e: any) {
      toast.error(e?.message ?? "AI polish failed");
    } finally {
      setPolishing(false);
    }
  };

  const onConfirmPayees = async () => {
    const byDesc = new Map<string, Cluster>();
    for (const c of clusters) for (const m of c.members) byDesc.set(m.description, c);

    const next: ReviewRow[] = rawTxns.map((t) => {
      const c = byDesc.get(t.description);
      const ignored = c?.status === "ignored";
      return {
        key: t.key,
        date: t.date,
        description: t.description,
        pattern: t.pattern,
        amount: t.amount,
        type: c?.type ?? t.type,
        payee: c?.name ?? "",
        category_id: c?.category_id ?? null,
        source: c?.pendingAi ? "pending" : (c?.source ?? "cluster"),
        confidence: c?.confidence ?? 0.5,
        include: !ignored,
        duplicate: false,
      };
    });

    // Duplicate hint 1 — the same row appears twice inside this file.
    const seen = new Map<string, number>();
    for (const r of next) {
      const k = `${r.date}|${r.amount}|${r.payee}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const r of next) {
      const k = `${r.date}|${r.amount}|${r.payee}`;
      const n = seen.get(k) ?? 0;
      if (n > 1) {
        r.duplicate = true;
        r.dup = {
          scope: "file",
          confidence: 0.9,
          matchKeys: ["date", "amount", "payee"],
          reason: `Appears ${n} times in this statement with the same date + amount + payee`,
        };
      }
    }

    // Teach the system only once the import is actually saved (see onSave).
    pendingCorrections.current = clusters
      .filter((c) => !c.pendingAi && c.status !== "ignored" && c.name.trim())
      .flatMap((c) =>
        c.patterns.map((p) => ({
          normalizedPattern: p,
          payeeName: c.name.trim(),
          category: categories.find((cat) => cat.id === c.category_id)?.name ?? null,
        })),
      );

    const enriched = await explainAccountDuplicates(next);
    setRows(enriched);
    setStep("review");
  };

  /**
   * Duplicate hint 2 — the row already exists on the account. The server
   * returns the matched fields and a confidence so the preview can say exactly
   * why a row is being flagged instead of just "duplicate".
   */
  const explainAccountDuplicates = async (candidates: ReviewRow[]): Promise<ReviewRow[]> => {
    if (!accountId || !candidates.length) return candidates;
    setDupScanning(true);
    try {
      const res: any = await explainDupFn({
        data: {
          accountId,
          transactions: candidates.slice(0, 10000).map((r) => ({
            key: r.key,
            date: r.date,
            amount: Number(r.amount),
            type: r.type,
            description: r.description,
            merchant: r.payee || null,
            category_id: r.category_id,
          })),
        },
      });
      const verdicts: Array<{
        key: string;
        confidence: number;
        matchKeys: string[];
        reason: string;
        existing: { date: string; amount: number; merchant: string | null; note: string | null };
      }> = res?.verdicts ?? [];
      if (!verdicts.length) return candidates;
      const byKey = new Map(verdicts.map((v) => [v.key, v]));
      return candidates.map((r) => {
        const v = byKey.get(r.key);
        if (!v) return r;
        // An account-level match always wins: it is the reason a row is skipped.
        return {
          ...r,
          duplicate: true,
          include: v.confidence >= 0.8 ? false : r.include,
          dup: {
            scope: "account" as const,
            confidence: v.confidence,
            matchKeys: v.matchKeys,
            reason: v.reason,
            existing: v.existing,
          },
        };
      });
    } catch {
      // Non-fatal: duplicates simply stay unexplained.
      return candidates;
    } finally {
      setDupScanning(false);
    }
  };


  const categoryName = useCallback(
    (id: string | null) => (id ? categories.find((c) => c.id === id)?.name ?? "—" : "Uncategorized"),
    [categories],
  );

  /** Fire-and-forget notification: in-app toast is primary, email is optional. */
  const notify = useCallback(
    (event: "parsed" | "imported" | "rolled_back" | "failed", ok: boolean, title: string, lines: string[]) => {
      void notifyFn({ data: { event, ok, title, lines } })
        .then((r: any) => {
          if (r?.sent) toast.message("Notification email sent", { description: title });
        })
        .catch(() => undefined);
    },
    [notifyFn],
  );

  const exportMeta = (kind: "preview" | "imported", rowsForRange: ReviewRow[]) => {
    const dates = rowsForRange.map((r) => r.date).filter(Boolean).sort();
    return {
      kind,
      fileName: file?.name ?? "statement",
      account:
        (accounts as Array<{ id: string; name: string }>).find((a) => a.id === accountId)?.name ?? "—",
      bank: bank || "—",
      from: dates[0] ?? "—",
      to: dates[dates.length - 1] ?? "—",
    } as const;
  };

  const exportSummary = (rowsForRange: ReviewRow[]): Array<[string, string]> => {
    const included = rowsForRange.filter((r) => r.include);
    return [
      ["Rows in statement", String(rowsForRange.length)],
      ["Included", String(included.length)],
      ["Excluded", String(rowsForRange.length - included.length)],
      ["Flagged duplicates", String(rowsForRange.filter((r) => r.duplicate).length)],
      ["Already on account", String(rowsForRange.filter((r) => r.dup?.scope === "account").length)],
      ["Repeated in file", String(rowsForRange.filter((r) => r.dup?.scope === "file").length)],
      ["Uncategorised", String(included.filter((r) => !r.category_id).length)],
      ["Distinct payees", String(new Set(included.map((r) => r.payee).filter(Boolean)).size)],
    ];
  };

  const doExport = (fmt: "csv" | "pdf", kind: "preview" | "imported", src: ReviewRow[]) => {
    const rowsOut = kind === "imported" ? src.filter((r) => r.include) : src;
    try {
      const meta = exportMeta(kind, src);
      if (fmt === "csv") exportImportToCSV(rowsOut, meta, exportSummary(src), categoryName);
      else exportImportToPDF(rowsOut, meta, exportSummary(src), categoryName);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  const rollback = async (batchId: string) => {
    try {
      const res: any = await undoFn({ data: { batchId } });
      qc.invalidateQueries();
      setLastBatch(null);
      toast.success(`Rolled back ${Number(res?.deleted ?? 0).toLocaleString()} imported transactions`);
      notify("rolled_back", true, "Statement import rolled back", [
        `${Number(res?.deleted ?? 0).toLocaleString()} transactions were removed.`,
        `Account balances were recalculated.`,
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not roll back this import");
    }
  };

  /** Step 1 of saving: no write happens here — just stage the preview. */
  const requestSave = (finalRows: ReviewRow[]) => {
    setRows(finalRows);
    if (!finalRows.some((r) => r.include)) {
      toast.error("Nothing to save");
      return;
    }
    setPreview(finalRows);
  };

  const previewSummary = useMemo(() => {
    const src = preview ?? [];
    const included = src.filter((r) => r.include);
    const dates = included.map((r) => r.date).sort();
    const payees = new Set(included.map((r) => r.payee).filter(Boolean));
    const uncategorized = included.filter((r) => !r.category_id).length;
    const newPayees = clusters.filter(
      (c) => c.status !== "ignored" && c.saveAsPayee && !c.isExisting && c.name.trim(),
    ).length;
    return {
      total: src.length,
      included: included.length,
      excluded: src.length - included.length,
      duplicates: included.filter((r) => r.duplicate).length,
      uncategorized,
      payees: payees.size,
      newPayees,
      from: dates[0] ?? "—",
      to: dates[dates.length - 1] ?? "—",
    };
  }, [preview, clusters]);

  const commitSave = async () => {
    const finalRows = preview ?? rows;
    const toSave = finalRows.filter((r) => r.include);
    if (!toSave.length) return toast.error("Nothing to save");
    const controller = new AbortController();
    abortRef.current = controller;
    setPreview(null);
    setSaving(true);
    setActivity({
      kind: "busy",
      label: `Importing ${toSave.length.toLocaleString()} transactions`,
      detail: "This import is idempotent — cancelling or retrying can never double-insert.",
    });
    try {
      const active = clusters.filter((c) => c.status !== "ignored");
      const newPayees = active
        .filter((c) => c.saveAsPayee && !c.isExisting && c.name.trim())
        .map((c) => ({
          merchant: c.name.trim(),
          category_id: c.category_id ?? null,
          txn_type: c.type,
        }));
      const payeeAliases: Record<string, string[]> = {};
      for (const c of active) {
        const name = c.name.trim();
        if (!name || !c.members.length) continue;
        (payeeAliases[name] ??= []).push(...c.members.map((m) => m.description));
      }
      const res: any = await saveFn({
        data: {
          accountId,
          newPayees,
          payeeAliases,
          importToken: importToken ?? undefined,
          uploadId: uploadId ?? undefined,
          transactions: toSave.map((r) => ({
            txn_date: r.date,
            amount: Number(r.amount),
            type: r.type,
            category_id: r.category_id,
            merchant: r.payee || null,
            note: r.description.slice(0, 500),
          })),
        },
        signal: controller.signal,
      } as any);

      if (res?.alreadyImported) {
        toast.info("This statement was already imported — nothing was duplicated.");
        setActivity({
          kind: "ok",
          label: "Already imported",
          detail: `${Number(res.previouslyInserted ?? 0).toLocaleString()} transactions were saved by the earlier run; nothing was duplicated.`,
        });
        qc.invalidateQueries();
        setOpen(false);
        reset();
        return;
      }

      // Learn confirmed payee names only now that the import actually landed.
      const corrections = pendingCorrections.current;
      if (corrections.length) {
        setActivity({
          kind: "busy",
          label: "Learning payee names",
          detail: `${corrections.length.toLocaleString()} confirmed names are being saved to your payee dictionary.`,
        });
        void correctionsFn({ data: { corrections: corrections.slice(0, 2000) } }).catch(() => undefined);
      }
      const batchId = (res?.batchId as string) ?? importToken ?? null;
      const snapshot = toSave;
      const meta = exportMeta("imported", snapshot);
      if (batchId) setLastBatch({ batchId, count: snapshot.length });
      toast.success(
        `Imported ${snapshot.length.toLocaleString()} transactions${newPayees.length ? ` · ${newPayees.length} new payees saved` : ""}`,
        {
          duration: 15000,
          description: batchId ? "Something wrong? You can roll this import back." : undefined,
          action: batchId
            ? { label: "Undo import", onClick: () => void rollback(batchId) }
            : undefined,
        },
      );
      toast.message("Keep a record of this import", {
        duration: 15000,
        description: `${meta.fileName} · ${meta.from} → ${meta.to}`,
        action: { label: "Download CSV", onClick: () => doExport("csv", "imported", snapshot) },
      });
      notify("imported", true, `Imported ${snapshot.length.toLocaleString()} transactions`, [
        `File: ${meta.fileName}`,
        `Account: ${meta.account} (${meta.bank})`,
        `Period: ${meta.from} → ${meta.to}`,
        `New payees saved: ${newPayees.length}`,
        `Duplicates skipped: ${rows.filter((r) => r.duplicate && !r.include).length}`,
      ]);
      qc.invalidateQueries();
      setOpen(false);
      reset();
    } catch (e: any) {
      const aborted = controller.signal.aborted;
      setActivity({
        kind: aborted ? "ok" : "error",
        label: aborted
          ? "Import aborted — the server rolled back, nothing was saved"
          : "Import failed — nothing was saved",
        detail: aborted ? undefined : (e?.message ?? "Unknown error"),
      });
      if (!aborted) {
        toast.error(e?.message ?? "Failed to save");
        notify("failed", false, "Statement import failed — nothing was saved", [
          `File: ${file?.name ?? "statement"}`,
          `Error: ${e?.message ?? "Unknown error"}`,
        ]);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSaving(false);
    }
  };


  const clusterStats = useMemo(() => summarize(clusters), [clusters]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && saving) {
          toast.info("Import in progress — it can't be cancelled once saving has started.");
          return;
        }
        if (!v && (step === "confirm" || step === "review")) {
          const ok = window.confirm("Discard this statement import? Nothing will be saved.");
          if (!ok) return;
        }
        if (!v) abortInFlight("Dialog closed");
        setOpen(v);
        if (!v) reset();
      }}
    >


      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" /> Import statement
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-6xl flex-col gap-3 overflow-hidden p-4 sm:p-5">
        <DialogHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              Import bank statement
            </DialogTitle>
            <Stepper step={step} />
          </div>
          <DialogDescription className="text-xs">
            {step === "import" && "Pick an account, drop a statement — we detect the bank, period and format before parsing."}
            {step === "parsing" && "Parsing, deduplicating and matching merchants. Naming continues in the background."}
            {step === "confirm" &&
              `${clusterStats.clusters} payee clusters from ${clusterStats.transactions.toLocaleString()} transactions. Rename, merge, split or ignore before importing.`}
            {step === "review" && "Final pass — exclude rows, fix payees and categories, then import."}
          </DialogDescription>
        </DialogHeader>

        <ActivityBanner activity={activity} onDismiss={() => setActivity({ kind: "idle" })} />

        {classification.status === "failed" && step === "confirm" && (
          <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
            Background naming failed — you can still rename payees manually before importing.
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {step === "import" && (
            <ImportStep
              accounts={accounts as Array<{ id: string; name: string }>}
              accountId={accountId}
              setAccountId={setAccountId}
              bank={bank}
              setBank={setBank}
              file={file}
              onFile={(f, d) => {
                setFile(f);
                setDetection(d);
              }}
              detection={detection}
              inspecting={false}
              seenFingerprints={seenFingerprints}
              parsing={parsing}
              onParse={onParse}
              progress={0}
            />
          )}

          {step === "parsing" && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <ProcessingTimeline
                stages={STAGE_ORDER.map((k) => stageStates[k])}
                stats={stats}
                elapsedMs={elapsed}
                currentOperation={operation}
              />
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={onCancelParsing}>
                  <X className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Cancel parsing
                </Button>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <ConfirmStep
              clusters={clusters}
              setClusters={setClusters}
              categories={categories}
              aiRemaining={aiRemaining}
              polishing={polishing}
              onPolish={onPolish}
              onBack={() => setStep("import")}
              onContinue={() => void onConfirmPayees()}
            />
          )}

          {step === "review" && (
            <ReviewStep
              rows={rows}
              categories={categories}
              saving={saving}
              onBack={() => setStep("confirm")}
              onSave={requestSave}
            />
          )}
        </div>

        <AlertDialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ready to import</AlertDialogTitle>
              <AlertDialogDescription>
                Nothing has been written yet. Review what will be saved, then confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
              {[
                ["Will be imported", previewSummary.included.toLocaleString()],
                ["Excluded", previewSummary.excluded.toLocaleString()],
                ["Possible duplicates", previewSummary.duplicates.toLocaleString()],
                ["Distinct payees", previewSummary.payees.toLocaleString()],
                ["New payees saved", previewSummary.newPayees.toLocaleString()],
                ["Uncategorised", previewSummary.uncategorized.toLocaleString()],
                ["Date range", `${previewSummary.from} → ${previewSummary.to}`],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-[10px] border border-border px-2.5 py-1.5">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Archive className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {archived
                ? "The original file is archived privately, so this import can be audited or re-parsed later."
                : "The original file is not archived — enable the statements archive in Settings to keep it for audit and re-parse."}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>Back to review</AlertDialogCancel>
              <AlertDialogAction onClick={commitSave}>
                Import {previewSummary.included.toLocaleString()} transactions
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

