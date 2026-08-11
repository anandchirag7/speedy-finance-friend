import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Copy,
  Pencil,
  Trash2,
  Filter,
  Briefcase,
  User,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  Layers,
  Receipt,
  FolderTree,
  RefreshCw,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  ChevronsDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  listCategoriesWithUsage,
  upsertCategory,
  deleteCategory,
  toggleCategoryHidden,
  duplicateCategory,
  seedDefaultCategories,
  bulkImportCategoriesFromCSV,
} from "@/lib/categories.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/categories")({
  head: () => ({
    meta: [
      { title: "Categories — Paisa" },
      { name: "description", content: "Manage income, expense, transfer and investment categories." },
    ],
  }),
  component: CategoriesPage,
});

type Cat = {
  id: string;
  name: string;
  kind: "income" | "expense" | "transfer" | "investment";
  scope: "personal" | "business";
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  description: string | null;
  group_label: string | null;
  tax_code: string | null;
  is_hidden: boolean;
  is_system: boolean;
  sort_order: number;
  usage_count: number;
};

type ScopeKey =
  | "all"
  | "biz-income"
  | "biz-expense"
  | "personal-income"
  | "personal-expense"
  | "investments"
  | "transfers";

const NAV: { key: ScopeKey; label: string; icon: any }[] = [
  { key: "biz-income", label: "Business Income", icon: Briefcase },
  { key: "biz-expense", label: "Business Expenses", icon: Receipt },
  { key: "personal-income", label: "Personal Income", icon: TrendingUp },
  { key: "personal-expense", label: "Personal Expenses", icon: TrendingDown },
  { key: "investments", label: "Investments", icon: Wallet },
  { key: "transfers", label: "Transfers", icon: ArrowLeftRight },
  { key: "all", label: "All Categories", icon: Layers },
];

const KIND_STYLES: Record<Cat["kind"], string> = {
  income:
    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
  expense:
    "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20",
  transfer:
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/20",
  investment:
    "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20",
};

const PAGE_SIZE = 50;

function matchesScope(c: Cat, scope: ScopeKey) {
  if (scope === "all") return true;
  if (scope === "transfers") return c.kind === "transfer";
  if (scope === "investments") return c.kind === "investment";
  if (scope === "biz-income") return c.scope === "business" && c.kind === "income";
  if (scope === "biz-expense") return c.scope === "business" && c.kind === "expense";
  if (scope === "personal-income") return c.scope === "personal" && c.kind === "income";
  if (scope === "personal-expense") return c.scope === "personal" && c.kind === "expense";
  return true;
}

/* ---- Debounce hook ---- */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ====================== MAIN PAGE ====================== */
function CategoriesPage() {
  const list = useServerFn(listCategoriesWithUsage);
  const seedFn = useServerFn(seedDefaultCategories);
  const importFn = useServerFn(bulkImportCategoriesFromCSV);
  const qc = useQueryClient();
  const { data: cats, isLoading } = useQuery({
    queryKey: ["categories-full"],
    queryFn: () => list(),
    retry: 1,
    staleTime: 30_000,
  });

  const [scope, setScope] = useState<ScopeKey>("all");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);
  const [showHidden, setShowHidden] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | Cat["kind"]>("all");
  const [sortKey, setSortKey] = useState<"name" | "kind" | "group_label">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Partial<Cat> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Cat | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const all = (cats ?? []) as Cat[];

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [scope, debouncedQ, showHidden, kindFilter]);

  const counts = useMemo(() => {
    const m: Record<ScopeKey, number> = {
      all: all.length,
      "biz-income": 0,
      "biz-expense": 0,
      "personal-income": 0,
      "personal-expense": 0,
      investments: 0,
      transfers: 0,
    };
    for (const c of all) {
      for (const nv of NAV) if (matchesScope(c, nv.key)) m[nv.key]++;
    }
    return m;
  }, [all]);

  // Filter
  const filtered = useMemo(() => {
    const term = debouncedQ.trim().toLowerCase();
    return all.filter((c) => {
      if (!matchesScope(c, scope)) return false;
      if (!showHidden && c.is_hidden) return false;
      if (kindFilter !== "all" && c.kind !== kindFilter) return false;
      if (term) {
        const hay = `${c.name} ${c.description ?? ""} ${c.group_label ?? ""} ${c.tax_code ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [all, scope, debouncedQ, showHidden, kindFilter]);

  // Build flat rows from tree — cycle-safe, expansion-aware
  const flatRows = useMemo(() => {
    const byId = new Map<string, Cat>();
    for (const c of all) byId.set(c.id, c);

    const includeIds = new Set<string>(filtered.map((c) => c.id));
    for (const c of filtered) {
      if (c.parent_id && c.parent_id !== c.id && byId.has(c.parent_id)) {
        includeIds.add(c.parent_id);
      }
    }

    const nodes = all.filter((c) => includeIds.has(c.id));
    const roots: Cat[] = [];
    const kids = new Map<string, Cat[]>();

    for (const c of nodes) {
      if (!c.parent_id || c.parent_id === c.id || !byId.has(c.parent_id)) {
        roots.push(c);
      } else {
        const arr = kids.get(c.parent_id) ?? [];
        arr.push(c);
        kids.set(c.parent_id, arr);
      }
    }

    const cmp = (a: Cat, b: Cat) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = (a as any)[sortKey] ?? "";
      const bv = (b as any)[sortKey] ?? "";
      return String(av).localeCompare(String(bv)) * dir;
    };
    roots.sort(cmp);
    for (const [, v] of kids) v.sort(cmp);

    const result: Array<{ cat: Cat; level: number; hasChildren: boolean }> = [];
    const visited = new Set<string>();

    const walk = (node: Cat, level: number) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const children = kids.get(node.id) ?? [];
      result.push({ cat: node, level, hasChildren: children.length > 0 });
      if (expanded[node.id]) {
        for (const ch of children) walk(ch, level + 1);
      }
    };

    for (const r of roots) walk(r, 0);
    return result;
  }, [all, filtered, sortKey, sortDir, expanded]);

  // Paginated slice
  const visibleRows = flatRows.slice(0, visibleCount);
  const hasMore = visibleCount < flatRows.length;

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const upsertMut = useMutation({
    mutationFn: useServerFn(upsertCategory),
    onSuccess: () => {
      toast.success("Category saved");
      qc.invalidateQueries({ queryKey: ["categories-full"] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const delMut = useMutation({
    mutationFn: useServerFn(deleteCategory),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["categories-full"] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });
  const hideMutFn = useServerFn(toggleCategoryHidden);
  const hideMut = useMutation({
    mutationFn: (v: { id: string; is_hidden: boolean }) => hideMutFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories-full"] }),
  });
  const dupMutFn = useServerFn(duplicateCategory);
  const dupMut = useMutation({
    mutationFn: (id: string) => dupMutFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Duplicated");
      qc.invalidateQueries({ queryKey: ["categories-full"] });
    },
  });

  return (
    <div className="min-h-screen bg-[oklch(0.975_0.005_240)] dark:bg-background">
      <div className="mx-auto flex max-w-[1400px] gap-6 p-4 md:p-6">
        {/* Desktop nav */}
        <NavPanel scope={scope} setScope={setScope} counts={counts} className="hidden lg:block" />

        <div className="min-w-0 flex-1 space-y-4">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="lg:hidden">
                      <FolderTree className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72 p-0">
                    <NavPanel scope={scope} setScope={setScope} counts={counts} className="block border-none shadow-none" />
                  </SheetContent>
                </Sheet>
                <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Categories</h1>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Organize how money moves — group transactions, map to tax codes, and keep your books tidy.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline" size="sm" className="gap-1.5"
                onClick={async () => {
                  if (window.confirm("Re-insert default categories?")) {
                    try {
                      await seedFn();
                      toast.success("Default categories inserted!");
                      qc.invalidateQueries({ queryKey: ["categories-full"] });
                    } catch (e: any) {
                      toast.error(e?.message ?? "Failed to seed defaults");
                    }
                  }
                }}
              >
                <RefreshCw className="h-4 w-4" /> Seed Defaults
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCsvOpen(true)}>
                <Upload className="h-4 w-4" /> Upload CSV
              </Button>
              <Button
                size="sm" className="gap-1.5"
                onClick={() => setEditing({
                  name: "", kind: scope.includes("income") ? "income" : "expense",
                  scope: scope.startsWith("biz") ? "business" : "personal",
                  is_hidden: false, sort_order: 0,
                })}
              >
                <Plus className="h-4 w-4" /> Add Category
              </Button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search categories…" className="h-9 pl-9" />
            </div>
            <div className="flex items-center gap-2">
              <Select value={kindFilter} onValueChange={(v: any) => setKindFilter(v)}>
                <SelectTrigger className="h-9 w-[150px]">
                  <Filter className="mr-1 h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                <Switch checked={showHidden} onCheckedChange={setShowHidden} />
                <span className="text-muted-foreground">Show hidden</span>
              </label>
            </div>
          </div>

          {/* Stats bar */}
          {!isLoading && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{filtered.length} categories</span>
              {flatRows.length !== filtered.length && <span>· {flatRows.length} visible (with parents)</span>}
              {hasMore && <span>· showing {visibleCount} of {flatRows.length}</span>}
            </div>
          )}

          {/* Table card */}
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {/* Desktop table */}
            <div className="hidden md:block">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="border-b bg-muted/60 px-3 py-2.5 font-medium w-[36px] pl-4">
                        <input
                          type="checkbox" className="h-3.5 w-3.5 accent-primary"
                          checked={filtered.length > 0 && filtered.every((c) => selected[c.id])}
                          onChange={(e) => {
                            const next: Record<string, boolean> = {};
                            if (e.target.checked) for (const c of filtered) next[c.id] = true;
                            setSelected(next);
                          }}
                        />
                      </th>
                      <SortableTh label="Category" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                      <th className="border-b bg-muted/60 px-3 py-2.5 font-medium">Type</th>
                      <th className="border-b bg-muted/60 px-3 py-2.5 font-medium">Description</th>
                      <SortableTh label="Group" active={sortKey === "group_label"} dir={sortDir} onClick={() => toggleSort("group_label")} />
                      <th className="border-b bg-muted/60 px-3 py-2.5 font-medium text-center">Hidden</th>
                      <th className="border-b bg-muted/60 px-3 py-2.5 font-medium w-[80px] pr-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-t">
                          <td colSpan={7} className="p-3"><Skeleton className="h-9 w-full" /></td>
                        </tr>
                      ))
                    ) : flatRows.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState onAdd={() => setEditing({ name: "", kind: "expense", scope: "personal", is_hidden: false })} />
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map(({ cat, level, hasChildren }) => (
                        <Row
                          key={cat.id} cat={cat} level={level} hasChildren={hasChildren}
                          open={!!expanded[cat.id]} selected={!!selected[cat.id]}
                          onToggleOpen={() => setExpanded((e) => ({ ...e, [cat.id]: !e[cat.id] }))}
                          onSelect={(v) => setSelected((s) => ({ ...s, [cat.id]: v }))}
                          onEdit={() => setEditing(cat)}
                          onDuplicate={() => dupMut.mutate(cat.id)}
                          onDelete={() => setDeleteTarget(cat)}
                          onToggleHidden={(v) => hideMut.mutate({ id: cat.id, is_hidden: v })}
                        />
                      ))
                    )}
                  </tbody>
                </table>
                {/* Load more button */}
                {hasMore && (
                  <div className="flex justify-center border-t py-3">
                    <Button
                      variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    >
                      <ChevronsDown className="h-4 w-4" />
                      Show {Math.min(PAGE_SIZE, flatRows.length - visibleCount)} more ({flatRows.length - visibleCount} remaining)
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile: paginated cards */}
            <div className="divide-y md:hidden">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-3"><Skeleton className="h-14 w-full" /></div>
                ))
              ) : flatRows.length === 0 ? (
                <EmptyState onAdd={() => setEditing({ name: "", kind: "expense", scope: "personal", is_hidden: false })} />
              ) : (
                <>
                  {visibleRows.map(({ cat, level, hasChildren }) => (
                    <div key={cat.id} style={{ paddingLeft: level * 16 }}>
                      <MobileRow
                        cat={cat} hasChildren={hasChildren} open={!!expanded[cat.id]}
                        onToggle={() => setExpanded((e) => ({ ...e, [cat.id]: !e[cat.id] }))}
                        onEdit={() => setEditing(cat)}
                        onDelete={() => setDeleteTarget(cat)}
                      />
                    </div>
                  ))}
                  {hasMore && (
                    <div className="flex justify-center py-3">
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                        <ChevronsDown className="h-4 w-4" /> Show more
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* FAB mobile */}
      <Button
        size="icon" className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg md:hidden"
        onClick={() => setEditing({ name: "", kind: "expense", scope: "personal", is_hidden: false })}
      >
        <Plus className="h-6 w-6" />
      </Button>

      <EditDialog value={editing} onClose={() => setEditing(null)} onSave={(v) => upsertMut.mutate({ data: v as any })} saving={upsertMut.isPending} allCategories={all} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && delMut.mutate({ data: { id: deleteTarget.id } } as any)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CategoryCsvUploadModal
        open={csvOpen} onOpenChange={setCsvOpen} importFn={importFn}
        onImportSuccess={() => {
          qc.invalidateQueries({ queryKey: ["categories-full"] });
          qc.invalidateQueries({ queryKey: ["categories"] });
        }}
      />
    </div>
  );
}

/* ----------------------- Nav Panel ----------------------- */
function NavPanel({ scope, setScope, counts, className }: {
  scope: ScopeKey; setScope: (s: ScopeKey) => void; counts: Record<ScopeKey, number>; className?: string;
}) {
  return (
    <aside className={cn("w-64 shrink-0", className)}>
      <div className="rounded-xl border bg-card p-2 shadow-sm">
        <div className="px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Browse</p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = scope === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key} onClick={() => setScope(item.key)}
                className={cn(
                  "group flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-primary/10 text-primary font-medium" : "text-foreground/80 hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                  {item.label}
                </span>
                <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] tabular-nums", active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  {counts[item.key]}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

/* ----------------------- Sortable header ----------------------- */
function SortableTh({ label, active, dir, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <th className="border-b bg-muted/60 px-3 py-2.5 font-medium">
      <button onClick={onClick} className="flex items-center gap-1 hover:text-foreground">
        {label}
        {active && <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

/* ----------------------- Simplified Row ----------------------- */
function Row({ cat, level, hasChildren, open, selected, onToggleOpen, onSelect, onEdit, onDuplicate, onDelete, onToggleHidden }: {
  cat: Cat; level: number; hasChildren: boolean; open: boolean; selected: boolean;
  onToggleOpen: () => void; onSelect: (v: boolean) => void; onEdit: () => void;
  onDuplicate: () => void; onDelete: () => void; onToggleHidden: (v: boolean) => void;
}) {
  return (
    <tr className={cn("group border-b transition-colors hover:bg-muted/40", selected && "bg-primary/5")}>
      <td className="pl-4 align-middle">
        <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      </td>
      <td className="px-3 align-middle">
        <div className="flex items-center gap-1" style={{ paddingLeft: level * 20 }}>
          {hasChildren ? (
            <button onClick={onToggleOpen} className="grid h-6 w-6 place-items-center rounded hover:bg-muted" aria-label={open ? "Collapse" : "Expand"}>
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="inline-block h-6 w-6" />
          )}
          <span
            className="grid h-7 w-7 place-items-center rounded-md text-xs font-semibold"
            style={{ background: cat.color ?? "oklch(0.94 0.02 90)", color: "oklch(0.25 0.04 155)" }}
          >
            {cat.icon ?? cat.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{cat.name}</div>
            {cat.scope === "business" && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Briefcase className="h-2.5 w-2.5" /> Business
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 align-middle">
        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize", KIND_STYLES[cat.kind])}>
          {cat.kind}
        </span>
      </td>
      <td className="max-w-[260px] px-3 align-middle text-muted-foreground">
        <div className="truncate">{cat.description ?? "—"}</div>
      </td>
      <td className="px-3 align-middle">
        {cat.group_label ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{cat.group_label}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 text-center align-middle">
        <Switch checked={cat.is_hidden} onCheckedChange={onToggleHidden} aria-label="Toggle hidden" />
      </td>
      <td className="pr-4 text-right align-middle">
        <div className="inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDuplicate} aria-label="Duplicate">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} aria-label="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ----------------------- Mobile row ----------------------- */
function MobileRow({ cat, hasChildren, open, onToggle, onEdit, onDelete }: {
  cat: Cat; hasChildren: boolean; open: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        {hasChildren ? (
          <button onClick={onToggle} className="grid h-7 w-7 place-items-center rounded hover:bg-muted">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="inline-block h-7 w-7" />
        )}
        <span className="grid h-8 w-8 place-items-center rounded-md text-xs font-semibold" style={{ background: cat.color ?? "oklch(0.94 0.02 90)" }}>
          {cat.icon ?? cat.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{cat.name}</span>
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", KIND_STYLES[cat.kind])}>{cat.kind}</span>
          </div>
          {cat.group_label && <div className="mt-0.5 text-xs text-muted-foreground">{cat.group_label}</div>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-3.5 w-3.5" /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ----------------------- Empty ----------------------- */
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/5 text-primary">
        <FolderTree className="h-7 w-7" />
      </div>
      <div>
        <h3 className="font-display text-lg font-semibold">No categories yet</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Categories help you slice spending, plan budgets, and file taxes. Start with a few to get going.
        </p>
      </div>
      <Button onClick={onAdd}>
        <Plus className="mr-1.5 h-4 w-4" /> Add your first category
      </Button>
    </div>
  );
}

/* ----------------------- Edit dialog ----------------------- */
function EditDialog({
  value, onClose, onSave, saving, allCategories,
}: {
  value: Partial<Cat> | null; onClose: () => void; onSave: (v: Partial<Cat>) => void;
  saving: boolean; allCategories: Cat[];
}) {
  const isOpen = !!value;
  const initial = useMemo<Partial<Cat>>(() => value ?? {}, [value]);
  const [form, setForm] = useState<Partial<Cat>>({});
  const [tab, setTab] = useState<"details" | "tax">("details");
  const [touched, setTouched] = useState(false);
  const [parentQuery, setParentQuery] = useState("");
  const [parentOpen, setParentOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [modeOverride, setModeOverride] = useState<"income" | "expense" | "subcategory" | null>(null);

  useEffect(() => {
    if (value) {
      setForm({ ...value });
      setTab("details");
      setTouched(false);
      setParentQuery("");
      setModeOverride(value.parent_id ? "subcategory" : null);
    }
  }, [value]);

  const update = (patch: Partial<Cat>) => { setTouched(true); setForm((f) => ({ ...f, ...patch })); };

  const mode: "income" | "expense" | "subcategory" =
    modeOverride ?? (form.parent_id ? "subcategory" : form.kind === "income" ? "income" : "expense");

  const setMode = (m: "income" | "expense" | "subcategory") => {
    setModeOverride(m);
    if (m === "subcategory") { setTouched(true); }
    else { update({ kind: m, parent_id: null }); }
  };

  const name = (form.name ?? "").trim();
  const nameError =
    touched && name.length === 0 ? "Category name is required"
    : allCategories.some((c) => c.id !== form.id && c.name.trim().toLowerCase() === name.toLowerCase() && c.kind === (form.kind ?? "expense"))
      ? "A category with this name already exists" : null;

  const parentGroups = useMemo(() => {
    const q = parentQuery.trim().toLowerCase();
    const descendants = new Set<string>();
    if (form.id) {
      const childrenOf = (pid: string) => allCategories.filter((c) => c.parent_id === pid);
      const stack = [form.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const ch of childrenOf(cur)) {
          if (!descendants.has(ch.id)) { descendants.add(ch.id); stack.push(ch.id); }
        }
      }
    }
    const pathOf = (c: Cat): string => {
      const parts = [c.name]; let p = c.parent_id;
      while (p) { const parent = allCategories.find((x) => x.id === p); if (!parent) break; parts.unshift(parent.name); p = parent.parent_id; }
      return parts.join(" › ");
    };
    const eligible = allCategories
      .filter((c) => c.id !== form.id && !descendants.has(c.id) && (!q || c.name.toLowerCase().includes(q) || pathOf(c).toLowerCase().includes(q)))
      .map((c) => ({ ...c, __path: pathOf(c) }));
    const groups: Record<string, (Cat & { __path: string })[]> = {};
    for (const c of eligible) (groups[c.kind] ||= []).push(c);
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.__path.localeCompare(b.__path));
    return groups;
  }, [allCategories, parentQuery, form.id]);

  const selectedParent = allCategories.find((c) => c.id === form.parent_id);
  const description = form.description ?? "";
  const canSave = !saving && name.length > 0 && !nameError;

  const attemptClose = () => { if (touched && !saving) setConfirmDiscard(true); else onClose(); };

  const submit = () => {
    setTouched(true);
    if (!name || nameError) return;
    onSave({
      id: form.id, name, kind: (form.kind ?? "expense") as any, scope: (form.scope ?? "personal") as any,
      parent_id: form.parent_id ?? null, icon: form.icon ?? null, color: form.color ?? null,
      description: form.description ?? null, group_label: form.group_label ?? null,
      tax_code: form.tax_code ?? null, is_hidden: !!form.is_hidden, sort_order: form.sort_order ?? 0,
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(o) => !o && attemptClose()}>
        <DialogContent
          className="max-w-xl gap-0 overflow-hidden rounded-none border-0 bg-card p-0 shadow-xl sm:rounded-2xl sm:border data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 flex h-[100dvh] w-screen max-h-none flex-col sm:h-auto sm:w-full sm:max-h-[92vh]"
          onEscapeKeyDown={(e) => { e.preventDefault(); attemptClose(); }}
          onInteractOutside={(e) => { if (touched) e.preventDefault(); }}
        >
          <div className="border-b bg-card px-5 pb-4 pt-5 sm:px-6">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="font-display text-xl font-semibold tracking-tight">
                {form.id ? "Edit Category" : "Create Category"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">Categories help organize your financial transactions.</p>
            </DialogHeader>
            <div className="mt-4 inline-flex rounded-lg border bg-muted/60 p-0.5">
              {[{ k: "details", label: "Details" }, { k: "tax", label: "Tax Reporting" }].map((t) => (
                <button
                  key={t.k} type="button" onClick={() => setTab(t.k as any)}
                  className={cn("rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
                    tab === t.k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-[oklch(0.985_0.005_240)] px-5 py-5 dark:bg-background sm:px-6">
            {tab === "details" ? (
              <div className="space-y-5 animate-in fade-in-50 duration-200">
                <div className="grid gap-1.5">
                  <Label htmlFor="cat-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Category Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="cat-name" autoFocus value={form.name ?? ""} onChange={(e) => update({ name: e.target.value })}
                    onBlur={() => setTouched(true)} placeholder="e.g. Groceries"
                    className={cn("h-10 bg-card", nameError && "border-destructive focus-visible:ring-destructive/30")}
                  />
                  {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Category Type</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <TypeCard title="Income" description="Money coming in" icon={TrendingUp} accent="text-emerald-600" selected={mode === "income"} onClick={() => setMode("income")} />
                    <TypeCard title="Expense" description="Money going out" icon={TrendingDown} accent="text-rose-600" selected={mode === "expense"} onClick={() => setMode("expense")} />
                    <TypeCard title="Subcategory" description="Nested under another" icon={FolderTree} accent="text-indigo-600" selected={mode === "subcategory"} onClick={() => setMode("subcategory")} />
                  </div>
                </div>

                {mode === "subcategory" && (
                  <div className="grid gap-1.5 animate-in fade-in-50 slide-in-from-top-1 duration-200">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parent Category</Label>
                    <Popover open={parentOpen} onOpenChange={setParentOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" className="flex h-10 items-center justify-between rounded-md border bg-card px-3 text-left text-sm shadow-sm hover:bg-muted/30">
                          {selectedParent ? (
                            <span className="flex items-center gap-2">
                              <span className={cn("inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium capitalize", KIND_STYLES[selectedParent.kind])}>{selectedParent.kind}</span>
                              <span className="font-medium">{selectedParent.name}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Search and select a parent…</span>
                          )}
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search parents…" value={parentQuery} onValueChange={setParentQuery} />
                          <CommandList className="max-h-64">
                            <CommandEmpty>No categories found.</CommandEmpty>
                            {Object.entries(parentGroups).map(([kind, list]) => (
                              <CommandGroup key={kind} heading={kind.charAt(0).toUpperCase() + kind.slice(1)}>
                                {list.map((p) => (
                                  <CommandItem key={p.id} value={`${p.kind}:${p.__path}`} onSelect={() => { update({ parent_id: p.id, kind: p.kind }); setParentOpen(false); }}>
                                    <span className={cn("mr-2 inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium capitalize", KIND_STYLES[p.kind])}>{p.kind}</span>
                                    <span className="truncate">
                                      {p.__path.includes(" › ") ? (<><span className="text-muted-foreground">{p.__path.split(" › ").slice(0, -1).join(" › ")} › </span><span className="font-medium">{p.name}</span></>) : (<span className="font-medium">{p.name}</span>)}
                                    </span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scope</Label>
                    <Select value={form.scope ?? "personal"} onValueChange={(v: any) => update({ scope: v })}>
                      <SelectTrigger className="h-10 bg-card"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="personal"><span className="inline-flex items-center gap-2"><User className="h-3.5 w-3.5" /> Personal</span></SelectItem>
                        <SelectItem value="business"><span className="inline-flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" /> Business</span></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Group</Label>
                    <Input value={form.group_label ?? ""} onChange={(e) => update({ group_label: e.target.value })} placeholder="e.g. Household" className="h-10 bg-card" />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description <span className="normal-case text-muted-foreground/70">(optional)</span></Label>
                    <span className={cn("text-[11px] tabular-nums text-muted-foreground", description.length > 450 && "text-warning-foreground", description.length >= 500 && "text-destructive")}>{description.length}/500</span>
                  </div>
                  <Textarea rows={3} maxLength={500} value={description} onChange={(e) => update({ description: e.target.value })} placeholder="Add a short note…" className="resize-none bg-card" />
                </div>

                <label className="flex items-center justify-between rounded-lg border bg-card p-3">
                  <div>
                    <div className="text-sm font-medium">Hidden</div>
                    <div className="text-xs text-muted-foreground">Keep out of pickers, budgets, and reports.</div>
                  </div>
                  <Switch checked={!!form.is_hidden} onCheckedChange={(v) => update({ is_hidden: v })} />
                </label>
              </div>
            ) : (
              <div className="space-y-5 animate-in fade-in-50 duration-200">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tax Category</Label>
                  <Select value={form.tax_code?.split("|")[0] || "__none"} onValueChange={(v) => { const line = form.tax_code?.split("|")[1] ?? ""; update({ tax_code: v === "__none" ? null : line ? `${v}|${line}` : v }); }}>
                    <SelectTrigger className="h-10 bg-card"><SelectValue placeholder="Select a tax category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Not taxable —</SelectItem>
                      <SelectItem value="80C">80C — Investments</SelectItem>
                      <SelectItem value="80D">80D — Medical Insurance</SelectItem>
                      <SelectItem value="80G">80G — Donations</SelectItem>
                      <SelectItem value="HRA">HRA — House Rent Allowance</SelectItem>
                      <SelectItem value="LTA">LTA — Leave Travel</SelectItem>
                      <SelectItem value="BUS-INC">Business Income</SelectItem>
                      <SelectItem value="BUS-EXP">Business Expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tax Line Mapping</Label>
                  <Input
                    value={form.tax_code?.split("|")[1] ?? ""}
                    onChange={(e) => { const cat = form.tax_code?.split("|")[0] ?? ""; const line = e.target.value; update({ tax_code: cat ? `${cat}|${line}` : line ? `|${line}` : null }); }}
                    placeholder="e.g. Schedule VI — Line 3(a)" className="h-10 bg-card"
                  />
                  <p className="text-[11px] text-muted-foreground">Optional. Maps this category to a specific tax form line.</p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Receipt className="h-3.5 w-3.5" /> Reporting Preview</div>
                  <div className="mt-3 space-y-2 text-sm">
                    <PreviewRow label="Category" value={name || "Untitled"} />
                    <PreviewRow label="Type" value={<span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize", KIND_STYLES[(form.kind ?? "expense") as Cat["kind"]])}>{form.kind ?? "expense"}</span>} />
                    <PreviewRow label="Tax Category" value={form.tax_code?.split("|")[0] || <span className="text-muted-foreground">Not taxable</span>} />
                    <PreviewRow label="Tax Line" value={form.tax_code?.split("|")[1] || <span className="text-muted-foreground">—</span>} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-card px-5 py-3 sm:px-6">
            <p className="hidden text-xs text-muted-foreground sm:block">{touched ? "Unsaved changes" : "\u00A0"}</p>
            <div className="flex flex-1 gap-2 sm:flex-none sm:justify-end">
              <Button variant="outline" onClick={attemptClose} className="flex-1 sm:flex-none">Cancel</Button>
              <Button disabled={!canSave} onClick={submit} className="flex-1 sm:flex-none">
                {saving ? <span className="inline-flex items-center gap-2"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" /> Saving…</span>
                  : form.id ? "Save Changes" : "Create Category"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your edits to this category will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmDiscard(false); onClose(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ----------------------- CSV Upload Modal ----------------------- */
function CategoryCsvUploadModal({
  open, onOpenChange, importFn, onImportSuccess,
}: {
  open: boolean; onOpenChange: (open: boolean) => void;
  importFn: (args: { data: { rows: any[] } }) => Promise<any>;
  onImportSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<Array<{
    name: string; kind: "income" | "expense" | "transfer" | "investment";
    scope: "personal" | "business"; parent_name?: string | null; description?: string | null;
  }>>([]);
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) { toast.error("CSV file is empty or missing header row"); return; }

    const parseCsvLine = (line: string) => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === "," && !inQuotes) { result.push(current.trim()); current = ""; }
        else current += char;
      }
      result.push(current.trim());
      return result.map((s) => s.replace(/^"|"$/g, "").trim());
    };

    const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const nameIdx = headers.findIndex((h) => h.includes("name") || h.includes("category"));
    const kindIdx = headers.findIndex((h) => h.includes("kind") || h.includes("type"));
    const parentIdx = headers.findIndex((h) => h.includes("parent"));
    const scopeIdx = headers.findIndex((h) => h.includes("scope"));
    const descIdx = headers.findIndex((h) => h.includes("desc"));

    if (nameIdx === -1) { toast.error("CSV must contain a 'Name' or 'Category' column"); return; }

    const rows: typeof parsedRows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]!);
      const name = cols[nameIdx];
      if (!name) continue;
      const rawKind = (kindIdx !== -1 ? cols[kindIdx] : "expense")?.toLowerCase() ?? "expense";
      let kind: "income" | "expense" | "transfer" | "investment" = "expense";
      if (rawKind.includes("inc")) kind = "income";
      else if (rawKind.includes("trans")) kind = "transfer";
      else if (rawKind.includes("invest")) kind = "investment";
      const rawScope = (scopeIdx !== -1 ? cols[scopeIdx] : "personal")?.toLowerCase() ?? "personal";
      const scope: "personal" | "business" = rawScope.includes("biz") || rawScope.includes("bus") ? "business" : "personal";
      rows.push({ name, kind, scope, parent_name: parentIdx !== -1 ? cols[parentIdx] || null : null, description: descIdx !== -1 ? cols[descIdx] || null : null });
    }
    setParsedRows(rows);
  };

  const handleDownloadTemplate = () => {
    const template = `Name,Kind,Parent Name,Scope,Description\nFood & Dining,expense,,personal,Dining out and food delivery\nGroceries,expense,Food & Dining,personal,Supermarket groceries\nSalary,income,,personal,Monthly payroll salary`;
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "categories_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!parsedRows.length) return;
    setLoading(true);
    try {
      const res = await importFn({ data: { rows: parsedRows as any } });
      const parts: string[] = [];
      if (res.importedCount > 0) parts.push(`${res.importedCount} new`);
      if (res.updatedCount > 0) parts.push(`${res.updatedCount} parent links fixed`);
      toast.success(parts.length > 0 ? `Done: ${parts.join(", ")}` : "All categories already exist");
      onImportSuccess();
      onOpenChange(false);
      setFile(null);
      setParsedRows([]);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to import categories");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" /> Upload Categories via CSV
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-xs">
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="font-semibold text-foreground">CSV Template</p>
              <p className="text-muted-foreground text-[11px]">Download sample CSV with pre-defined headers.</p>
            </div>
            <Button size="sm" variant="outline" onClick={handleDownloadTemplate} className="h-8 gap-1.5 text-xs shrink-0">
              <Download className="h-3.5 w-3.5" /> Template
            </Button>
          </div>
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center hover:bg-muted/10 transition-colors">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="font-medium text-xs">{file ? file.name : "Choose a .csv file or drag & drop"}</p>
            <p className="text-[11px] text-muted-foreground mb-3">{file ? `${parsedRows.length} valid rows parsed` : "Supports parent & sub-category hierarchies"}</p>
            <label className="cursor-pointer">
              <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors inline-block">Select CSV File</span>
              <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
            </label>
          </div>
          {parsedRows.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Preview ({parsedRows.length} rows)</span>
                <span className="text-[11px] text-emerald-600 font-medium">Ready to import</span>
              </div>
              <div className="max-h-48 overflow-auto rounded-lg border bg-card p-1">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr><th className="p-1.5">Name</th><th className="p-1.5">Kind</th><th className="p-1.5">Parent</th><th className="p-1.5">Scope</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsedRows.slice(0, 15).map((r, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="p-1.5 font-medium">{r.name}</td>
                        <td className="p-1.5 capitalize">{r.kind}</td>
                        <td className="p-1.5 text-muted-foreground">{r.parent_name || "—"}</td>
                        <td className="p-1.5 capitalize">{r.scope}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 15 && <p className="p-1.5 text-center text-[10px] text-muted-foreground">+ {parsedRows.length - 15} more</p>}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={!parsedRows.length || loading} className="gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Import {parsedRows.length} Categories
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------- Type card ----------------------- */
function TypeCard({ title, description, icon: Icon, accent, selected, onClick }: {
  title: string; description: string; icon: any; accent: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected}
      className={cn(
        "group relative flex flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left transition-all",
        "hover:border-primary/40 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30 shadow-sm" : "border-border",
      )}
    >
      <div className={cn("grid h-8 w-8 place-items-center rounded-lg bg-muted", selected && "bg-primary/10")}>
        <Icon className={cn("h-4 w-4", accent)} />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] leading-snug text-muted-foreground">{description}</div>
      {selected && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />}
    </button>
  );
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
