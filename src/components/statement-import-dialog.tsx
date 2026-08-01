import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Loader2, Trash2, Sparkles, Users, ChevronDown, ChevronRight, Search, Split, GitMerge, ArrowRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAccounts } from "@/lib/finance.functions";
import { StatementReviewTable } from "@/components/statement-review-table";
import {
  polishPayeeNames,
  bulkInsertTransactions,
} from "@/lib/statement-import.functions";
import {
  startStatementUpload,
  saveMerchantCorrections,
} from "@/lib/statement-pipeline.functions";
import { titleCase } from "@/lib/statement-normalize";
import { useStatementClassification } from "@/hooks/use-statement-classification";


type ParsedTxn = {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  suggestedCategory: string;
  payee: string;
  pattern: string;
};

type Category = { id: string; name: string; kind: string; parent_id: string | null };
type ExistingPayee = { id: string; merchant: string; category_id: string | null };

type PayeeCluster = {
  pattern: string; // normalized merchant pattern this cluster came from
  pendingAi: boolean; // waiting on background AI naming
  originalName: string; // AI-suggested name (used to remap rows)
  name: string; // user-editable final name
  descriptions: string[];
  category_id: string | null;
  type: "expense" | "income" | "transfer";
  saveAsPayee: boolean; // create memorized payee?
  isExisting: boolean; // already exists in db
};

const BANKS = [
  "HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank", "Kotak Mahindra",
  "IDFC First", "Yes Bank", "IndusInd", "Punjab National Bank", "Bank of Baroda",
  "American Express", "Citibank", "HSBC", "Standard Chartered", "Other",
];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function StatementImportDialog() {
  const startFn = useServerFn(startStatementUpload);
  const correctionsFn = useServerFn(saveMerchantCorrections);
  const saveFn = useServerFn(bulkInsertTransactions);
  const qc = useQueryClient();
  const listAcc = useServerFn(listAccounts);
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAcc(),
  });

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"upload" | "payees" | "mapping">("upload");
  const [accountId, setAccountId] = useState<string>("");
  const [bank, setBank] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rawTxns, setRawTxns] = useState<ParsedTxn[]>([]);
  const [rows, setRows] = useState<Array<ParsedTxn & { category_id: string | null; include: boolean; merchant: string }>>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [existingPayees, setExistingPayees] = useState<ExistingPayee[]>([]);
  const [clusters, setClusters] = useState<PayeeCluster[]>([]);
  const [phase, setPhase] = useState<"idle" | "parsing" | "clustering">("idle");
  const [phaseStats, setPhaseStats] = useState<{ rows: number; unique: number } | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const classification = useStatementClassification(uploadId);

  const categoryIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.name.toLowerCase(), c.id);
    return m;
  }, [categories]);

  // Background AI naming streams in — fill any cluster still waiting on a name.
  useEffect(() => {
    const resolved = classification.resolved;
    if (!resolved || !Object.keys(resolved).length) return;
    setClusters((prev) =>
      prev.map((c) => {
        const hit = resolved[c.pattern];
        if (!c.pendingAi || !hit) return c;
        return {
          ...c,
          name: hit.payee,
          originalName: hit.payee,
          pendingAi: false,
          category_id:
            c.category_id ??
            (hit.category ? categoryIdByName.get(hit.category.toLowerCase()) ?? null : null),
        };
      }),
    );
  }, [classification.resolved, categoryIdByName]);

  const reset = () => {
    setStep("upload");
    setAccountId("");
    setBank("");
    setFile(null);
    setRawTxns([]);
    setRows([]);
    setCategories([]);
    setExistingPayees([]);
    setClusters([]);
    setPhase("idle");
    setPhaseStats(null);
    setUploadId(null);
  };

  const onUpload = async () => {
    if (!accountId) return toast.error("Choose an account");
    if (!bank) return toast.error("Choose a bank");
    if (!file) return toast.error("Choose a file");
    setParsing(true);
    setPhase("parsing");
    setPhaseStats(null);
    setUploadId(null);
    try {
      const base64 = await readFileAsBase64(file);

      // Fast path: parse -> normalize -> dedupe -> dictionary lookup.
      // Unknown patterns are named by AI in the background.
      const res = await startFn({
        data: {
          accountId,
          bank,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
        },
      });

      if (!res.transactions.length) {
        toast.error("No transactions found in file");
        setPhase("idle");
        return;
      }

      setCategories(res.categories);
      setExistingPayees(res.existingPayees);

      const resolved = res.resolved as Record<
        string,
        { payee: string; category: string | null; source: string }
      >;
      const catByName = new Map<string, string>();
      for (const c of res.categories) catByName.set(c.name.toLowerCase(), c.id);

      const rawParsed: ParsedTxn[] = res.transactions.map((t) => ({
        date: t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        pattern: t.pattern,
        suggestedCategory: resolved[t.pattern]?.category ?? "",
        payee: resolved[t.pattern]?.payee ?? titleCase(t.pattern),
      }));
      setRawTxns(rawParsed);

      // One cluster per normalized pattern
      const grouped = new Map<string, { descriptions: string[]; type: ParsedTxn["type"] }>();
      for (const t of rawParsed) {
        const g = grouped.get(t.pattern);
        if (g) {
          if (!g.descriptions.includes(t.description)) g.descriptions.push(t.description);
        } else {
          grouped.set(t.pattern, { descriptions: [t.description], type: t.type });
        }
      }
      setPhaseStats({ rows: rawParsed.length, unique: grouped.size });

      const initialClusters: PayeeCluster[] = Array.from(grouped.entries()).map(
        ([pattern, group]) => {
          const hit = resolved[pattern];
          const name = hit?.payee ?? titleCase(pattern);
          const existing = res.existingPayees.find(
            (e) => e.merchant.toLowerCase() === name.toLowerCase(),
          );
          return {
            pattern,
            pendingAi: !hit,
            originalName: name,
            name,
            descriptions: group.descriptions,
            category_id:
              existing?.category_id ??
              (hit?.category ? catByName.get(hit.category.toLowerCase()) ?? null : null),
            type: group.type,
            saveAsPayee: !existing,
            isExisting: !!existing,
          };
        },
      );

      setClusters(initialClusters);
      setUploadId(res.uploadId);
      setStep("payees");
      const unknown = initialClusters.filter((c) => c.pendingAi).length;
      toast.success(
        `${rawParsed.length} transactions · ${initialClusters.length} payees` +
          (unknown ? ` · naming ${unknown} new merchants in the background` : " · all recognised"),
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to parse statement");
    } finally {
      setParsing(false);
      setPhase("idle");
    }
  };

  const onConfirmPayees = () => {
    // Map each txn to its cluster by description (handles moves between clusters)
    const byDesc = new Map<string, PayeeCluster>();
    for (const c of clusters) for (const d of c.descriptions) byDesc.set(d, c);
    const mapped = rawTxns.map((t) => {
      const cluster = byDesc.get(t.description);
      const merchant = cluster?.name ?? t.payee ?? "";
      const category_id = cluster?.category_id ?? null;
      return { ...t, merchant, category_id, include: true };
    });

    // Teach the system: confirmed names become personal overrides + dictionary entries
    const corrections = clusters
      .filter((c) => c.pattern && c.name.trim() && !c.pendingAi)
      .map((c) => ({
        normalizedPattern: c.pattern,
        payeeName: c.name.trim(),
        category: categories.find((cat) => cat.id === c.category_id)?.name ?? null,
      }));
    if (corrections.length) {
      void correctionsFn({ data: { corrections: corrections.slice(0, 2000) } }).catch(() => undefined);
    }

    setRows(mapped);
    setStep("mapping");
  };


  const onSave = async () => {
    const toSave = rows.filter((r) => r.include);
    if (!toSave.length) return toast.error("Nothing to save");
    setSaving(true);
    try {
      const newPayees = clusters
        .filter((c) => c.saveAsPayee && !c.isExisting && c.name.trim())
        .map((c) => ({
          merchant: c.name.trim(),
          category_id: c.category_id ?? null,
          txn_type: c.type,
        }));
      // Every cluster (new + pre-existing) teaches the system its raw descriptions
      // so the next import auto-snaps similar rows to the same payee.
      const payeeAliases: Record<string, string[]> = {};
      for (const c of clusters) {
        const name = c.name.trim();
        if (!name || !c.descriptions.length) continue;
        (payeeAliases[name] ??= []).push(...c.descriptions);
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
            merchant: r.merchant || null,
            note: r.description.slice(0, 500),
          })),
        },
      });
      toast.success(`Imported ${toSave.length} transactions${newPayees.length ? ` · ${newPayees.length} new payees saved` : ""}`);
      qc.invalidateQueries();
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };


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
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" && "Import bank statement"}
            {step === "payees" && (
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Confirm payee clusters
              </span>
            )}
            {step === "mapping" && "Review & save transactions"}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Pick account" /></SelectTrigger>
                <SelectContent>
                  {(accounts as any[]).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Bank</Label>
              <Select value={bank} onValueChange={setBank}>
                <SelectTrigger><SelectValue placeholder="Pick bank" /></SelectTrigger>
                <SelectContent>
                  {BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Statement file (CSV, Excel or PDF)</Label>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && <p className="text-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
            </div>
            {phase !== "idle" && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <PhaseRow
                  active={phase === "parsing"}
                  done={phase === "clustering"}
                  label="Parsing statement"
                  detail={phase === "clustering" && phaseStats ? `${phaseStats.rows} transactions found` : "Reading rows from the file…"}
                />
                <PhaseRow
                  active={phase === "clustering"}
                  done={false}
                  label="Smart-clustering payees"
                  detail={phase === "clustering" && phaseStats ? `Grouping ${phaseStats.unique} unique descriptions locally…` : "Waiting…"}
                />
              </div>
            )}
            <DialogFooter>
              <Button onClick={onUpload} disabled={parsing}>
                {parsing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {phase === "parsing" ? "Parsing…" : phase === "clustering" ? "Clustering…" : "Parse statement"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "payees" && (
          <PayeesStep
            clusters={clusters}
            setClusters={setClusters}
            categories={categories}
            onBack={() => setStep("upload")}
            onContinue={onConfirmPayees}
          />
        )}

        {step === "mapping" && (
          <>
            <StatementReviewTable rows={rows} setRows={setRows} categories={categories} />

            <DialogFooter className="mt-2">
              <div className="mr-auto text-sm text-muted-foreground">
                {rows.filter((r) => r.include).length} of {rows.length} selected
              </div>
              <Button variant="outline" onClick={() => setStep("payees")}>Back to payees</Button>
              <Button onClick={onSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save transactions
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PhaseRow({
  active,
  done,
  label,
  detail,
}: {
  active: boolean;
  done: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">
        {done ? (
          <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[10px]">✓</div>
        ) : active ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <div className="h-4 w-4 rounded-full border border-muted-foreground/40" />
        )}
      </div>
      <div className="flex-1">
        <div className={`text-sm font-medium ${active || done ? "" : "text-muted-foreground"}`}>{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function PayeesStep({
  clusters,
  setClusters,
  categories,
  onBack,
  onContinue,
}: {
  clusters: PayeeCluster[];
  setClusters: (c: PayeeCluster[]) => void;
  categories: Category[];
  onBack: () => void;
  onContinue: () => void;
}) {
  const polishFn = useServerFn(polishPayeeNames);
  const [polishing, setPolishing] = useState(false);
  const [query, setQuery] = useState("");
  // Default: all clusters collapsed. Users can expand individually or via "Expand all".
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [filter, setFilter] = useState<"all" | "new" | "existing">("all");
  // per-cluster selected descriptions (by description string)
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});

  const onPolish = async () => {
    // Only new clusters get AI-renamed; existing payees keep their saved names.
    const targets = clusters
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !c.isExisting)
      .slice(0, 400);
    if (!targets.length) {
      toast.info("Nothing to polish — all payees already exist");
      return;
    }
    setPolishing(true);
    try {
      const { renames, merges } = await polishFn({
        data: {
          clusters: targets.map(({ c }) => ({
            name: c.name,
            sample: c.descriptions[0] ?? "",
            count: c.descriptions.length,
          })),
        },
      });
      let next = clusters.map((c) => ({ ...c }));
      // Apply renames
      Object.entries(renames ?? {}).forEach(([k, name]) => {
        const target = targets[Number(k)];
        if (target && name) next[target.i] = { ...next[target.i], name: String(name) };
      });
      // Apply merges (keep the largest cluster of each group)
      const removed = new Set<number>();
      for (const group of merges ?? []) {
        const real = group.map((g: number) => targets[g]?.i).filter((v): v is number => v != null && !removed.has(v));
        if (real.length < 2) continue;
        const keep = real.reduce((a, b) => (next[a].descriptions.length >= next[b].descriptions.length ? a : b));
        for (const idx of real) {
          if (idx === keep) continue;
          next[keep] = { ...next[keep], descriptions: [...next[keep].descriptions, ...next[idx].descriptions] };
          removed.add(idx);
        }
      }
      next = next.filter((_, i) => !removed.has(i));
      setClusters(next);
      setExpanded({});
      setSelected({});
      const renameCount = Object.keys(renames ?? {}).length;
      toast.success(
        `AI cleaned ${renameCount} name${renameCount === 1 ? "" : "s"}${removed.size ? ` · merged ${removed.size} duplicate group${removed.size === 1 ? "" : "s"}` : ""}`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not polish names");
    } finally {
      setPolishing(false);
    }
  };


  const update = (i: number, patch: Partial<PayeeCluster>) => {
    const copy = [...clusters];
    copy[i] = { ...copy[i], ...patch };
    setClusters(copy);
  };

  // Remove descriptions from a source cluster and drop empty clusters
  const pruneEmpty = (arr: PayeeCluster[]) => arr.filter((c) => c.descriptions.length > 0);

  const moveDescriptions = (fromIdx: number, descs: string[], toIdx: number) => {
    if (!descs.length || fromIdx === toIdx) return;
    const set = new Set(descs);
    const copy = clusters.map((c, i) => {
      if (i === fromIdx) return { ...c, descriptions: c.descriptions.filter((d) => !set.has(d)) };
      if (i === toIdx) return { ...c, descriptions: [...c.descriptions, ...descs] };
      return c;
    });
    setClusters(pruneEmpty(copy));
    setSelected({ ...selected, [fromIdx]: new Set() });
  };

  const splitToNewCluster = (fromIdx: number, descs: string[]) => {
    if (!descs.length) return;
    const src = clusters[fromIdx];
    const set = new Set(descs);
    const newCluster: PayeeCluster = {
      pattern: "",
      pendingAi: false,
      originalName: descs[0].slice(0, 60),
      name: descs[0].slice(0, 60),
      descriptions: descs,
      category_id: src.category_id,
      type: src.type,
      saveAsPayee: true,
      isExisting: false,
    };
    const copy = clusters.map((c, i) =>
      i === fromIdx ? { ...c, descriptions: c.descriptions.filter((d) => !set.has(d)) } : c,
    );
    setClusters([...pruneEmpty(copy), newCluster]);
    setSelected({ ...selected, [fromIdx]: new Set() });
  };

  const mergeCluster = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const src = clusters[fromIdx];
    const copy = clusters
      .map((c, i) => (i === toIdx ? { ...c, descriptions: [...c.descriptions, ...src.descriptions] } : c))
      .filter((_, i) => i !== fromIdx);
    setClusters(copy);
  };

  const toggleSelect = (i: number, d: string) => {
    const cur = new Set(selected[i] ?? []);
    if (cur.has(d)) cur.delete(d);
    else cur.add(d);
    setSelected({ ...selected, [i]: cur });
  };

  const q = query.trim().toLowerCase();
  const visible = clusters
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => {
      if (filter === "new" && c.isExisting) return false;
      if (filter === "existing" && !c.isExisting) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.descriptions.some((d) => d.toLowerCase().includes(q))
      );
    });

  const newCount = clusters.filter((c) => !c.isExisting).length;
  const savingCount = clusters.filter((c) => c.saveAsPayee && !c.isExisting).length;

  return (
    <>
      <div className="-mt-2 space-y-3">
        <p className="text-sm text-muted-foreground">
          Similar statement descriptions were grouped into vendors. Rename, recategorize, or fix mistakes — expand a payee to move individual transactions to another payee or split them out into a new one.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search payee or description…"
              className="h-8 pl-8"
            />
          </div>
          <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
            {(["all", "new", "existing"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`rounded px-2.5 py-1 capitalize transition ${
                  filter === k ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
                {k === "new" && ` (${newCount})`}
                {k === "all" && ` (${clusters.length})`}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              const all: Record<number, boolean> = {};
              clusters.forEach((_, i) => { all[i] = true; });
              setExpanded(all);
            }}
          >
            Expand all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setExpanded({})}
          >
            Collapse all
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 text-xs"
            disabled={polishing}
            onClick={onPolish}
          >
            {polishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            Polish names with AI
          </Button>

        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-md border bg-muted/20 divide-y">
        {visible.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">No payees match your search.</div>
        )}
        {visible.map(({ c, i }) => {
          const isOpen = !!expanded[i];
          const preview = c.descriptions.slice(0, 2);
          const remaining = c.descriptions.length - preview.length;
          const sel = selected[i] ?? new Set<string>();
          const otherClusters = clusters
            .map((cc, idx) => ({ cc, idx }))
            .filter(({ idx }) => idx !== i);
          return (
            <div key={i} className="bg-background p-3 sm:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                {/* Payee name — hero field */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Payee name
                    </Label>
                    <Sparkles className="h-3 w-3 text-primary/70" />
                    <span className="text-[10px] text-muted-foreground">auto-detected</span>
                  </div>
                  <Input
                    value={c.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="Enter a clear payee name"
                    className="h-10 text-base font-semibold"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {c.isExisting ? (
                      <Badge variant="secondary" className="text-[10px]">Existing payee</Badge>
                    ) : (
                      <Badge className="text-[10px]">New</Badge>
                    )}
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Users className="h-2.5 w-2.5" />
                      {c.descriptions.length} txn{c.descriptions.length === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{c.type}</Badge>
                  </div>
                </div>

                {/* Category + Save toggle + Merge */}
                <div className="flex flex-col gap-2 lg:w-72 lg:shrink-0">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Category
                    </Label>
                    <Select
                      value={c.category_id ?? "none"}
                      onValueChange={(v) => update(i, { category_id: v === "none" ? null : v })}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Uncategorized" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Uncategorized</SelectItem>
                        {categories
                          .filter((cat) => cat.kind === c.type || c.type === "transfer")
                          .map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={c.saveAsPayee}
                      disabled={c.isExisting}
                      onChange={(e) => update(i, { saveAsPayee: e.target.checked })}
                    />
                    <span className={c.isExisting ? "text-muted-foreground" : ""}>
                      {c.isExisting ? "Already in Memorized Payees" : "Save to Memorized Payees"}
                    </span>
                  </label>
                  {otherClusters.length > 0 && (
                    <Select
                      value=""
                      onValueChange={(v) => {
                        const targetIdx = Number(v);
                        if (!Number.isNaN(targetIdx)) mergeCluster(i, targetIdx);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <GitMerge className="h-3 w-3" /> Merge this payee into…
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {otherClusters.map(({ cc, idx }) => (
                          <SelectItem key={idx} value={String(idx)}>
                            {cc.name || "(unnamed)"} · {cc.descriptions.length}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Matched descriptions */}
              <div className="mt-3 rounded-md border bg-muted/30">
                <button
                  type="button"
                  onClick={() => setExpanded({ ...expanded, [i]: !isOpen })}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Matched descriptions ({c.descriptions.length})
                    {isOpen && <span className="ml-2 text-[10px] font-normal text-muted-foreground/80">select rows to move or split</span>}
                  </span>
                  {!isOpen && remaining > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Show {remaining} more
                    </span>
                  )}
                  {isOpen && c.descriptions.length > 2 && (
                    <span className="text-[10px] text-muted-foreground/80">click to collapse</span>
                  )}
                </button>

                {isOpen && sel.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t bg-background/70 px-3 py-2 text-xs">
                    <span className="font-medium">{sel.size} selected</span>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {otherClusters.length > 0 && (
                        <Select
                          value=""
                          onValueChange={(v) => {
                            const targetIdx = Number(v);
                            if (!Number.isNaN(targetIdx)) moveDescriptions(i, Array.from(sel), targetIdx);
                          }}
                        >
                          <SelectTrigger className="h-7 w-56 text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <ArrowRight className="h-3 w-3" /> Move to payee…
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {otherClusters.map(({ cc, idx }) => (
                              <SelectItem key={idx} value={String(idx)}>
                                {cc.name || "(unnamed)"} · {cc.descriptions.length}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => splitToNewCluster(i, Array.from(sel))}
                      >
                        <Split className="h-3 w-3" /> Split into new payee
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setSelected({ ...selected, [i]: new Set() })}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}

                <div className="px-3 pb-2 pt-1 font-mono text-[11px] leading-relaxed">
                  {isOpen && c.descriptions.length > 1 && (
                    <label className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={sel.size === c.descriptions.length}
                        onChange={(e) => {
                          setSelected({
                            ...selected,
                            [i]: e.target.checked ? new Set(c.descriptions) : new Set(),
                          });
                        }}
                      />
                      Select all
                    </label>
                  )}
                  {(isOpen ? c.descriptions : preview).map((d, di) => (
                    <div key={di} className="flex items-start gap-2 py-0.5">
                      {isOpen && (
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={sel.has(d)}
                          onChange={() => toggleSelect(i, d)}
                        />
                      )}
                      <div className="flex-1 break-all text-muted-foreground">{d}</div>
                      {isOpen && (
                        <button
                          type="button"
                          title="Split this row into its own new payee"
                          onClick={() => splitToNewCluster(i, [d])}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <DialogFooter className="mt-2">
        <div className="mr-auto text-sm text-muted-foreground">
          {clusters.length} payees · {savingCount} will be saved as new
        </div>
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onContinue}>Continue to transactions</Button>
      </DialogFooter>
    </>
  );
}
