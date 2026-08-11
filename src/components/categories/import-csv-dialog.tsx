import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UploadCloud, Download, AlertTriangle, CheckCircle2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { importCategoriesCsv } from "@/lib/categories.functions";
import { cn } from "@/lib/utils";

export type CsvCategoryRow = {
  name: string;
  parent: string | null;
  kind: "income" | "expense" | "transfer" | "investment";
  scope: "personal" | "business";
  description: string | null;
  group_label: string | null;
  tax_code: string | null;
  is_hidden: boolean;
};

const TEMPLATE =
  "name,parent,kind,scope,description,group_label,tax_code,is_hidden\n" +
  "Food & Dining,,expense,personal,Everyday food spend,Living,,false\n" +
  "Groceries,Food & Dining,expense,personal,,Living,,false\n" +
  "Salary,,income,personal,Monthly pay,Earnings,,false\n";

/** Minimal RFC4180-ish CSV parser (handles quotes, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const KINDS = ["income", "expense", "transfer", "investment"] as const;

function normalizeKind(v: string): CsvCategoryRow["kind"] | null {
  const k = v.trim().toLowerCase();
  if (!k) return "expense";
  if ((KINDS as readonly string[]).includes(k)) return k as CsvCategoryRow["kind"];
  if (k === "debit" || k === "spend" || k === "spending") return "expense";
  if (k === "credit" || k === "earning" || k === "earnings") return "income";
  return null;
}

export function parseCategoriesCsv(text: string): { rows: CsvCategoryRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length === 0) return { rows: [], errors: ["File is empty."] };

  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iName = idx("name", "category", "category_name");
  const iParent = idx("parent", "parent_name", "parent_category");
  const iKind = idx("kind", "type");
  const iScope = idx("scope");
  const iDesc = idx("description", "notes");
  const iGroup = idx("group_label", "group");
  const iTax = idx("tax_code", "tax");
  const iHidden = idx("is_hidden", "hidden");

  if (iName < 0) {
    return { rows: [], errors: ['Missing a "name" column in the header row.'] };
  }

  const rows: CsvCategoryRow[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < table.length; r++) {
    const line = table[r];
    const name = (line[iName] ?? "").trim();
    if (!name) {
      errors.push(`Row ${r + 1}: missing category name — skipped.`);
      continue;
    }
    if (name.length > 100) {
      errors.push(`Row ${r + 1}: name longer than 100 characters — skipped.`);
      continue;
    }
    const parent = iParent >= 0 ? (line[iParent] ?? "").trim() : "";
    const kind = normalizeKind(iKind >= 0 ? (line[iKind] ?? "") : "");
    if (!kind) {
      errors.push(`Row ${r + 1}: unknown type "${line[iKind]}" — skipped.`);
      continue;
    }
    const scopeRaw = (iScope >= 0 ? (line[iScope] ?? "") : "").trim().toLowerCase();
    const scope: CsvCategoryRow["scope"] =
      scopeRaw === "business" || scopeRaw === "biz" ? "business" : "personal";
    const hiddenRaw = (iHidden >= 0 ? (line[iHidden] ?? "") : "").trim().toLowerCase();
    const key = `${scope}|${parent.toLowerCase()}|${name.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`Row ${r + 1}: duplicate of an earlier row — skipped.`);
      continue;
    }
    seen.add(key);
    rows.push({
      name,
      parent: parent || null,
      kind,
      scope,
      description: (iDesc >= 0 ? (line[iDesc] ?? "").trim() : "") || null,
      group_label: (iGroup >= 0 ? (line[iGroup] ?? "").trim() : "") || null,
      tax_code: (iTax >= 0 ? (line[iTax] ?? "").trim() : "") || null,
      is_hidden: hiddenRaw === "true" || hiddenRaw === "yes" || hiddenRaw === "1",
    });
  }
  return { rows, errors };
}

export function ImportCategoriesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CsvCategoryRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const importFn = useServerFn(importCategoriesCsv);
  const mut = useMutation({
    mutationFn: (payload: CsvCategoryRow[]) => importFn({ data: { rows: payload } }),
    onSuccess: (res: any) => {
      toast.success(
        `Imported ${res.created} new and updated ${res.updated} categories.`,
        res.skipped ? { description: `${res.skipped} row(s) skipped.` } : undefined,
      );
      qc.invalidateQueries({ queryKey: ["categories-full"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Import failed"),
  });

  const reset = () => {
    setFileName(null);
    setRows([]);
    setErrors([]);
  };

  const accept = async (f: File | null) => {
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      toast.error("Please choose a .csv file");
      return;
    }
    const text = await f.text();
    const parsed = parseCategoriesCsv(text);
    setFileName(f.name);
    setRows(parsed.rows);
    setErrors(parsed.errors);
  };

  const parentsCount = useMemo(() => rows.filter((r) => !r.parent).length, [rows]);

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "categories-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (mut.isPending) return;
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import categories from CSV</DialogTitle>
          <DialogDescription>
            Columns: <span className="font-medium">name</span>, parent, kind, scope, description,
            group_label, tax_code, is_hidden. Only <span className="font-medium">name</span> is
            required. Existing categories with the same name and parent are updated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void accept(e.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40",
            )}
          >
            <UploadCloud
              className={cn("h-6 w-6", dragging ? "text-primary" : "text-muted-foreground")}
              aria-hidden
            />
            <p className="text-sm font-medium">
              {fileName ?? "Drop a CSV here, or click to browse"}
            </p>
            <p className="text-[11px] text-muted-foreground">Comma-separated values (.csv)</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void accept(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Download template
            </Button>
            {fileName && (
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                <X className="mr-1.5 h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>

          {rows.length > 0 && (
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
                {rows.length} row(s) ready — {parentsCount} top-level, {rows.length - parentsCount}{" "}
                nested
              </div>
              <div className="max-h-52 overflow-auto rounded-lg border bg-card">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">Name</th>
                      <th className="px-2 py-1.5">Parent</th>
                      <th className="px-2 py-1.5">Type</th>
                      <th className="px-2 py-1.5">Scope</th>
                      <th className="px-2 py-1.5">Group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((r, i) => (
                      <tr key={`${r.scope}-${r.parent}-${r.name}-${i}`} className="border-t">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.parent ?? "—"}</td>
                        <td className="px-2 py-1.5 capitalize">{r.kind}</td>
                        <td className="px-2 py-1.5 capitalize">{r.scope}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.group_label ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 200 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Showing first 200 of {rows.length} rows.
                </p>
              )}
            </div>
          )}

          {errors.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-auto">
              {errors.slice(0, 20).map((e, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 rounded-[10px] border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px]"
                >
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-warning" aria-hidden />
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mut.mutate(rows)}
            disabled={rows.length === 0 || mut.isPending}
          >
            {mut.isPending ? "Importing…" : `Import ${rows.length || ""} categories`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
