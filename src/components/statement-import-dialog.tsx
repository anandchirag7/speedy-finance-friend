import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Loader2, Trash2, Sparkles, Users, ChevronDown, ChevronRight, Search } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAccounts } from "@/lib/finance.functions";
import {
  extractStatementRows,
  clusterStatementPayees,
  bulkInsertTransactions,
} from "@/lib/statement-import.functions";

type ParsedTxn = {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  suggestedCategory: string;
  payee: string;
};

type Category = { id: string; name: string; kind: string; parent_id: string | null };
type ExistingPayee = { id: string; merchant: string; category_id: string | null };

type PayeeCluster = {
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
  const extractFn = useServerFn(extractStatementRows);
  const clusterFn = useServerFn(clusterStatementPayees);
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
  };

  const onUpload = async () => {
    if (!accountId) return toast.error("Choose an account");
    if (!bank) return toast.error("Choose a bank");
    if (!file) return toast.error("Choose a file");
    setParsing(true);
    try {
      const base64 = await readFileAsBase64(file);
      const result = await parseFn({
        data: {
          accountId,
          bank,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64,
        },
      });
      if (!result.transactions.length) {
        toast.error("No transactions found in file");
        return;
      }
      setCategories(result.categories);
      setExistingPayees(result.existingPayees);
      setRawTxns(result.transactions);

      const initialClusters: PayeeCluster[] = result.payees.map((p) => {
        const match = result.categories.find(
          (c) => c.name.toLowerCase() === (p.suggestedCategory ?? "").toLowerCase(),
        );
        const existing = result.existingPayees.find(
          (e) => e.merchant.toLowerCase() === p.name.toLowerCase(),
        );
        return {
          originalName: p.name,
          name: p.name,
          descriptions: p.descriptions ?? [],
          category_id: existing?.category_id ?? match?.id ?? null,
          type: p.type,
          saveAsPayee: !existing, // by default save new ones
          isExisting: !!existing || !!p.isExisting,
        };
      });
      setClusters(initialClusters);
      setStep("payees");
      toast.success(`AI clustered ${initialClusters.length} payees from ${result.transactions.length} transactions`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to parse statement");
    } finally {
      setParsing(false);
    }
  };

  const onConfirmPayees = () => {
    // Map each txn to its cluster's final name & category
    const byOriginal = new Map(clusters.map((c) => [c.originalName, c]));
    const mapped = rawTxns.map((t) => {
      const cluster = byOriginal.get(t.payee);
      const merchant = cluster?.name ?? t.payee ?? "";
      const category_id = cluster?.category_id ?? null;
      return { ...t, merchant, category_id, include: true };
    });
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
      await saveFn({
        data: {
          accountId,
          newPayees,
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
                Confirm payees clustered by AI
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
            <DialogFooter>
              <Button onClick={onUpload} disabled={parsing}>
                {parsing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {parsing ? "Parsing with AI…" : "Parse statement"}
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
            <div className="flex-1 overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-40">Payee</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24">Type</TableHead>
                    <TableHead className="w-28 text-right">Amount</TableHead>
                    <TableHead className="w-48">Category</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i} className={r.include ? "" : "opacity-40"}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[i] = { ...r, include: e.target.checked };
                            setRows(copy);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={r.date}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[i] = { ...r, date: e.target.value };
                            setRows(copy);
                          }}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.merchant}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[i] = { ...r, merchant: e.target.value };
                            setRows(copy);
                          }}
                          className="h-8 font-medium"
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.description}</TableCell>
                      <TableCell>
                        <Select
                          value={r.type}
                          onValueChange={(v: any) => {
                            const copy = [...rows];
                            copy[i] = { ...r, type: v };
                            setRows(copy);
                          }}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="expense">Expense</SelectItem>
                            <SelectItem value="income">Income</SelectItem>
                            <SelectItem value="transfer">Transfer</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Input
                          type="number"
                          step="0.01"
                          value={r.amount}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[i] = { ...r, amount: Number(e.target.value) };
                            setRows(copy);
                          }}
                          className="h-8 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={r.category_id ?? "none"}
                          onValueChange={(v) => {
                            const copy = [...rows];
                            copy[i] = { ...r, category_id: v === "none" ? null : v };
                            setRows(copy);
                          }}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={r.suggestedCategory || "Uncategorized"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Uncategorized</SelectItem>
                            {categories
                              .filter((c) => c.kind === r.type || r.type === "transfer")
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [filter, setFilter] = useState<"all" | "new" | "existing">("all");

  const update = (i: number, patch: Partial<PayeeCluster>) => {
    const copy = [...clusters];
    copy[i] = { ...copy[i], ...patch };
    setClusters(copy);
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
          AI grouped similar statement descriptions into vendors. Review the suggested payee name, rename if needed, and pick a category before importing transactions.
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
                    <span className="text-[10px] text-muted-foreground">AI suggested</span>
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

                {/* Category + Save toggle */}
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
                  </span>
                  {!isOpen && remaining > 0 && <span className="text-[10px]">+{remaining} more</span>}
                </button>
                <div className="px-3 pb-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {(isOpen ? c.descriptions : preview).map((d, di) => (
                    <div key={di} className="break-all">• {d}</div>
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
