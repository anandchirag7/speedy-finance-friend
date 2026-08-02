import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Sparkles, FileSearch, ListChecks, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export function StatementImportDialog() {
  const startFn = useServerFn(startStatementUpload);
  const correctionsFn = useServerFn(saveMerchantCorrections);
  const saveFn = useServerFn(bulkInsertTransactions);
  const polishFn = useServerFn(polishPayeeNames);
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

  const [rawTxns, setRawTxns] = useState<ClusterTxn[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);

  const [stageStates, setStageStates] = useState<Record<StageKey, Stage>>(() =>
    Object.fromEntries(STAGE_ORDER.map((k) => [k, { key: k, state: "pending" }])) as Record<StageKey, Stage>,
  );
  const [stats, setStats] = useState<ProcessingStats>(emptyStats);
  const [operation, setOperation] = useState("Waiting for a file");
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

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
    setStats(emptyStats);
    setOperation("Waiting for a file");
    setElapsed(0);
    setStageStates(
      Object.fromEntries(STAGE_ORDER.map((k) => [k, { key: k, state: "pending" }])) as Record<StageKey, Stage>,
    );
  };

  const onParse = async () => {
    if (!accountId || !bank || !file) return;
    setParsing(true);
    setStep("parsing");
    startedAt.current = Date.now();
    setElapsed(0);
    const estimate = detection?.estimatedRows ?? 0;

    try {
      setOperation(`Reading ${file.name}`);
      setStage("read", { state: "active" });
      const base64 = await readFileAsBase64(file);
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
      });

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
      if (detection?.fingerprint) {
        setSeenFingerprints((prev) => Array.from(new Set([...prev, detection.fingerprint])));
      }
      setStep("confirm");
      toast.success(
        `${txns.length.toLocaleString()} transactions · ${built.length} payee clusters` +
          (pending ? ` · naming ${pending} in the background` : " · all recognised"),
      );
    } catch (e: any) {
      setOperation("Failed");
      setStage("parse", { state: "error", detail: e?.message ?? "parse failed" });
      toast.error(e?.message ?? "Failed to parse statement");
      setStep("import");
    } finally {
      setParsing(false);
    }
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

  const onConfirmPayees = () => {
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

    // Duplicate hint: same date + amount + payee appearing more than once.
    const seen = new Map<string, number>();
    for (const r of next) {
      const k = `${r.date}|${r.amount}|${r.payee}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const r of next) {
      if ((seen.get(`${r.date}|${r.amount}|${r.payee}`) ?? 0) > 1) r.duplicate = true;
    }

    // Teach the system: confirmed names become overrides + dictionary entries.
    const corrections = clusters
      .filter((c) => !c.pendingAi && c.status !== "ignored" && c.name.trim())
      .flatMap((c) =>
        c.patterns.map((p) => ({
          normalizedPattern: p,
          payeeName: c.name.trim(),
          category: categories.find((cat) => cat.id === c.category_id)?.name ?? null,
        })),
      );
    if (corrections.length) {
      void correctionsFn({ data: { corrections: corrections.slice(0, 2000) } }).catch(() => undefined);
    }

    setRows(next);
    setStep("review");
  };

  const onSave = async (finalRows: ReviewRow[]) => {
    setRows(finalRows);
    const toSave = finalRows.filter((r) => r.include);
    if (!toSave.length) return toast.error("Nothing to save");
    setSaving(true);
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
      await saveFn({
        data: {
          accountId,
          newPayees,
          payeeAliases,
          transactions: toSave.map((r) => ({
            txn_date: r.date,
            amount: Number(r.amount),
            type: r.type,
            category_id: r.category_id,
            merchant: r.payee || null,
            note: r.description.slice(0, 500),
          })),
        },
      });
      toast.success(
        `Imported ${toSave.length.toLocaleString()} transactions${newPayees.length ? ` · ${newPayees.length} new payees saved` : ""}`,
      );
      qc.invalidateQueries();
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const clusterStats = useMemo(() => summarize(clusters), [clusters]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
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
            <ProcessingTimeline
              stages={STAGE_ORDER.map((k) => stageStates[k])}
              stats={stats}
              elapsedMs={elapsed}
              currentOperation={operation}
            />
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
              onContinue={onConfirmPayees}
            />
          )}

          {step === "review" && (
            <ReviewStep
              rows={rows}
              categories={categories}
              saving={saving}
              onBack={() => setStep("confirm")}
              onSave={onSave}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
