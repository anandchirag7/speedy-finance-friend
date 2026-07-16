import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  listCategoriesWithUsage,
  upsertCategory,
  deleteCategory,
  toggleCategoryHidden,
  duplicateCategory,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

function CategoriesPage() {
  const list = useServerFn(listCategoriesWithUsage);
  const qc = useQueryClient();
  const { data: cats, isLoading } = useQuery({
    queryKey: ["categories-full"],
    queryFn: () => list(),
  });

  const [scope, setScope] = useState<ScopeKey>("all");
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | Cat["kind"]>("all");
  const [sortKey, setSortKey] = useState<"name" | "usage_count" | "kind" | "group_label">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Partial<Cat> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Cat | null>(null);

  const all = (cats ?? []) as Cat[];

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

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
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
  }, [all, scope, q, showHidden, kindFilter]);

  // Build parent/child tree from filtered set (include a parent if any child matches)
  const tree = useMemo(() => {
    const byId = new Map<string, Cat>();
    for (const c of all) byId.set(c.id, c);
    const includeIds = new Set<string>(filtered.map((c) => c.id));
    for (const c of filtered) if (c.parent_id && byId.has(c.parent_id)) includeIds.add(c.parent_id);
    const nodes = all.filter((c) => includeIds.has(c.id));
    const roots = nodes.filter((c) => !c.parent_id || !byId.has(c.parent_id));
    const kids = new Map<string, Cat[]>();
    for (const c of nodes) {
      if (c.parent_id && byId.has(c.parent_id)) {
        const arr = kids.get(c.parent_id) ?? [];
        arr.push(c);
        kids.set(c.parent_id, arr);
      }
    }
    const cmp = (a: Cat, b: Cat) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = (a as any)[sortKey] ?? "";
      const bv = (b as any)[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    };
    roots.sort(cmp);
    for (const [, v] of kids) v.sort(cmp);
    return { roots, kids };
  }, [all, filtered, sortKey, sortDir]);

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
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

  const totalRows = tree.roots.reduce(
    (n, r) => n + 1 + (expanded[r.id] ? (tree.kids.get(r.id)?.length ?? 0) : 0),
    0,
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-[oklch(0.975_0.005_240)] dark:bg-background">
        <div className="mx-auto flex max-w-[1400px] gap-6 p-4 md:p-6">
          {/* Desktop nav */}
          <NavPanel
            scope={scope}
            setScope={setScope}
            counts={counts}
            className="hidden lg:block"
          />

          <div className="min-w-0 flex-1 space-y-4">
            {/* Header */}
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {/* Mobile nav trigger */}
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="icon" className="lg:hidden">
                        <FolderTree className="h-4 w-4" />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-72 p-0">
                      <NavPanel
                        scope={scope}
                        setScope={setScope}
                        counts={counts}
                        className="block border-none shadow-none"
                      />
                    </SheetContent>
                  </Sheet>
                  <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                    Categories
                  </h1>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Organize how money moves — group transactions, map to tax codes, and keep your books tidy.
                </p>
              </div>
              <Button
                onClick={() =>
                  setEditing({
                    name: "",
                    kind: scope.includes("income") ? "income" : "expense",
                    scope: scope.startsWith("biz") ? "business" : "personal",
                    is_hidden: false,
                    sort_order: 0,
                  })
                }
                className="hidden md:inline-flex"
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add Category
              </Button>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search categories, groups, tax codes…"
                  className="h-9 pl-9"
                />
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

            {/* Table card */}
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              {/* Desktop table */}
              <div className="hidden md:block">
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                      <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Th className="w-[36px] pl-4">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={
                              filtered.length > 0 &&
                              filtered.every((c) => selected[c.id])
                            }
                            onChange={(e) => {
                              const next: Record<string, boolean> = {};
                              if (e.target.checked) for (const c of filtered) next[c.id] = true;
                              setSelected(next);
                            }}
                          />
                        </Th>
                        <SortableTh label="Category" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                        <SortableTh label="Usage" active={sortKey === "usage_count"} dir={sortDir} onClick={() => toggleSort("usage_count")} />
                        <SortableTh label="Type" active={sortKey === "kind"} dir={sortDir} onClick={() => toggleSort("kind")} />
                        <Th>Description</Th>
                        <SortableTh label="Group" active={sortKey === "group_label"} dir={sortDir} onClick={() => toggleSort("group_label")} />
                        <Th>Tax</Th>
                        <Th className="text-center">Hidden</Th>
                        <Th className="w-[80px] pr-4 text-right">Actions</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <tr key={i} className="border-t">
                            <td colSpan={9} className="p-3">
                              <Skeleton className="h-9 w-full" />
                            </td>
                          </tr>
                        ))
                      ) : totalRows === 0 ? (
                        <tr>
                          <td colSpan={9}>
                            <EmptyState onAdd={() => setEditing({ name: "", kind: "expense", scope: "personal", is_hidden: false })} />
                          </td>
                        </tr>
                      ) : (
                        tree.roots.flatMap((root) => {
                          const children = tree.kids.get(root.id) ?? [];
                          const isOpen = expanded[root.id];
                          const rows = [
                            <Row
                              key={root.id}
                              cat={root}
                              level={0}
                              hasChildren={children.length > 0}
                              open={isOpen}
                              selected={!!selected[root.id]}
                              onToggleOpen={() =>
                                setExpanded((e) => ({ ...e, [root.id]: !e[root.id] }))
                              }
                              onSelect={(v) =>
                                setSelected((s) => ({ ...s, [root.id]: v }))
                              }
                              onEdit={() => setEditing(root)}
                              onDuplicate={() => dupMut.mutate(root.id)}
                              onDelete={() => setDeleteTarget(root)}
                              onToggleHidden={(v) =>
                                hideMut.mutate({ id: root.id, is_hidden: v })
                              }
                            />,
                          ];
                          if (isOpen) {
                            for (const ch of children) {
                              rows.push(
                                <Row
                                  key={ch.id}
                                  cat={ch}
                                  level={1}
                                  hasChildren={false}
                                  open={false}
                                  selected={!!selected[ch.id]}
                                  onToggleOpen={() => {}}
                                  onSelect={(v) =>
                                    setSelected((s) => ({ ...s, [ch.id]: v }))
                                  }
                                  onEdit={() => setEditing(ch)}
                                  onDuplicate={() => dupMut.mutate(ch.id)}
                                  onDelete={() => setDeleteTarget(ch)}
                                  onToggleHidden={(v) =>
                                    hideMut.mutate({ id: ch.id, is_hidden: v })
                                  }
                                />,
                              );
                            }
                          }
                          return rows;
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile: expandable cards */}
              <div className="divide-y md:hidden">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-3">
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ))
                ) : totalRows === 0 ? (
                  <EmptyState onAdd={() => setEditing({ name: "", kind: "expense", scope: "personal", is_hidden: false })} />
                ) : (
                  tree.roots.map((root) => {
                    const children = tree.kids.get(root.id) ?? [];
                    const isOpen = expanded[root.id];
                    return (
                      <div key={root.id}>
                        <MobileRow
                          cat={root}
                          hasChildren={children.length > 0}
                          open={isOpen}
                          onToggle={() =>
                            setExpanded((e) => ({ ...e, [root.id]: !e[root.id] }))
                          }
                          onEdit={() => setEditing(root)}
                          onDelete={() => setDeleteTarget(root)}
                        />
                        {isOpen &&
                          children.map((ch) => (
                            <div key={ch.id} className="pl-6">
                              <MobileRow
                                cat={ch}
                                hasChildren={false}
                                open={false}
                                onToggle={() => {}}
                                onEdit={() => setEditing(ch)}
                                onDelete={() => setDeleteTarget(ch)}
                              />
                            </div>
                          ))}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Floating FAB on mobile */}
        <Button
          size="icon"
          className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg md:hidden"
          onClick={() => setEditing({ name: "", kind: "expense", scope: "personal", is_hidden: false })}
        >
          <Plus className="h-6 w-6" />
        </Button>

        <EditDialog
          value={editing}
          onClose={() => setEditing(null)}
          onSave={(v) => upsertMut.mutate({ data: v as any })}
          saving={upsertMut.isPending}
          allCategories={all}
        />

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget && deleteTarget.usage_count > 0
                  ? `This category is used by ${deleteTarget.usage_count} transaction(s). Those transactions will become uncategorized.`
                  : "This action cannot be undone."}
              </AlertDialogDescription>
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
      </div>
    </TooltipProvider>
  );
}

/* ----------------------- Nav Panel ----------------------- */
function NavPanel({
  scope,
  setScope,
  counts,
  className,
}: {
  scope: ScopeKey;
  setScope: (s: ScopeKey) => void;
  counts: Record<ScopeKey, number>;
  className?: string;
}) {
  return (
    <aside className={cn("w-64 shrink-0", className)}>
      <div className="rounded-xl border bg-card p-2 shadow-sm">
        <div className="px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Browse
          </p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = scope === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setScope(item.key)}
                className={cn(
                  "group flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground/80 hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  {item.label}
                </span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
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

/* ----------------------- Table primitives ----------------------- */
function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("border-b bg-muted/60 px-3 py-2.5 font-medium", className)}>
      {children}
    </th>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <Th>
      <button
        onClick={onClick}
        className="flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {active && (
          <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>
        )}
      </button>
    </Th>
  );
}

function Row({
  cat,
  level,
  hasChildren,
  open,
  selected,
  onToggleOpen,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleHidden,
}: {
  cat: Cat;
  level: number;
  hasChildren: boolean;
  open: boolean;
  selected: boolean;
  onToggleOpen: () => void;
  onSelect: (v: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleHidden: (v: boolean) => void;
}) {
  return (
    <tr
      className={cn(
        "group h-[52px] border-b transition-colors hover:bg-muted/40",
        selected && "bg-primary/5",
      )}
    >
      <td className="pl-4 align-middle">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-primary"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="px-3 align-middle">
        <div className="flex items-center gap-1" style={{ paddingLeft: level * 20 }}>
          {hasChildren ? (
            <button
              onClick={onToggleOpen}
              className="grid h-6 w-6 place-items-center rounded hover:bg-muted"
              aria-label={open ? "Collapse" : "Expand"}
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="inline-block h-6 w-6" />
          )}
          <span
            className="grid h-7 w-7 place-items-center rounded-md text-xs font-semibold"
            style={{
              background: cat.color ?? "oklch(0.94 0.02 90)",
              color: "oklch(0.25 0.04 155)",
            }}
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
        <Badge
          variant="secondary"
          className="rounded-md px-1.5 py-0 text-[11px] tabular-nums"
        >
          {cat.usage_count}
        </Badge>
      </td>
      <td className="px-3 align-middle">
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize",
            KIND_STYLES[cat.kind],
          )}
        >
          {cat.kind}
        </span>
      </td>
      <td className="max-w-[260px] px-3 align-middle text-muted-foreground">
        <div className="truncate">{cat.description ?? "—"}</div>
      </td>
      <td className="px-3 align-middle">
        {cat.group_label ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {cat.group_label}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 align-middle">
        {cat.tax_code ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Receipt className="h-3.5 w-3.5" /> {cat.tax_code}
              </span>
            </TooltipTrigger>
            <TooltipContent>Tax mapping: {cat.tax_code}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 text-center align-middle">
        <Switch
          checked={cat.is_hidden}
          onCheckedChange={onToggleHidden}
          aria-label="Toggle hidden"
        />
      </td>
      <td className="pr-4 text-right align-middle">
        <div className="inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDuplicate}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}

/* ----------------------- Mobile row ----------------------- */
function MobileRow({
  cat,
  hasChildren,
  open,
  onToggle,
  onEdit,
  onDelete,
}: {
  cat: Cat;
  hasChildren: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
        <span
          className="grid h-8 w-8 place-items-center rounded-md text-xs font-semibold"
          style={{ background: cat.color ?? "oklch(0.94 0.02 90)" }}
        >
          {cat.icon ?? cat.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{cat.name}</span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
                KIND_STYLES[cat.kind],
              )}
            >
              {cat.kind}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {cat.group_label && <span>{cat.group_label}</span>}
            <span>· {cat.usage_count} uses</span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
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
  value,
  onClose,
  onSave,
  saving,
  allCategories,
}: {
  value: Partial<Cat> | null;
  onClose: () => void;
  onSave: (v: Partial<Cat>) => void;
  saving: boolean;
  allCategories: Cat[];
}) {
  const [form, setForm] = useState<Partial<Cat>>({});
  const isOpen = !!value;

  // reset when opening
  useMemo(() => {
    if (value) setForm({ ...value });
  }, [value]);

  const parentOptions = allCategories.filter(
    (c) => c.id !== form.id && !c.parent_id && c.kind === form.kind,
  );

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              value={form.name ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g., Groceries"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={form.kind ?? "expense"}
                onValueChange={(v: any) => setForm((f) => ({ ...f, kind: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Scope</Label>
              <Select
                value={form.scope ?? "personal"}
                onValueChange={(v: any) => setForm((f) => ({ ...f, scope: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">
                    <span className="inline-flex items-center gap-2">
                      <User className="h-3.5 w-3.5" /> Personal
                    </span>
                  </SelectItem>
                  <SelectItem value="business">
                    <span className="inline-flex items-center gap-2">
                      <Briefcase className="h-3.5 w-3.5" /> Business
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Group</Label>
              <Input
                value={form.group_label ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, group_label: e.target.value }))
                }
                placeholder="e.g., Household"
              />
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1">
                Tax code
                <Info className="h-3 w-3 text-muted-foreground" />
              </Label>
              <Input
                value={form.tax_code ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tax_code: e.target.value }))
                }
                placeholder="e.g., 80C"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Parent (optional)</Label>
            <Select
              value={form.parent_id ?? "__none"}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, parent_id: v === "__none" ? null : v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None —</SelectItem>
                {parentOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="What belongs in this category?"
            />
          </div>
          <label className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm">Hide from pickers &amp; reports</span>
            <Switch
              checked={!!form.is_hidden}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_hidden: v }))}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !form.name?.trim()}
            onClick={() =>
              onSave({
                id: form.id,
                name: form.name!,
                kind: (form.kind ?? "expense") as any,
                scope: (form.scope ?? "personal") as any,
                parent_id: form.parent_id ?? null,
                icon: form.icon ?? null,
                color: form.color ?? null,
                description: form.description ?? null,
                group_label: form.group_label ?? null,
                tax_code: form.tax_code ?? null,
                is_hidden: !!form.is_hidden,
                sort_order: form.sort_order ?? 0,
              })
            }
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
