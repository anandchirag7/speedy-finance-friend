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

  const update = (patch: Partial<Cat>) => {
    setTouched(true);
    setForm((f) => ({ ...f, ...patch }));
  };

  const mode: "income" | "expense" | "subcategory" =
    modeOverride ?? (form.parent_id ? "subcategory" : form.kind === "income" ? "income" : "expense");

  const setMode = (m: "income" | "expense" | "subcategory") => {
    setModeOverride(m);
    if (m === "subcategory") {
      setTouched(true);
    } else {
      update({ kind: m, parent_id: null });
    }
  };

  const name = (form.name ?? "").trim();
  const nameError =
    touched && name.length === 0
      ? "Category name is required"
      : allCategories.some(
            (c) =>
              c.id !== form.id &&
              c.name.trim().toLowerCase() === name.toLowerCase() &&
              c.kind === (form.kind ?? "expense"),
          )
        ? "A category with this name already exists"
        : null;

  // Parent options for subcategory mode — any category except self and its descendants
  const parentGroups = useMemo(() => {
    const q = parentQuery.trim().toLowerCase();
    // Build descendant set to prevent cycles when editing an existing category
    const descendants = new Set<string>();
    if (form.id) {
      const childrenOf = (pid: string) => allCategories.filter((c) => c.parent_id === pid);
      const stack = [form.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const ch of childrenOf(cur)) {
          if (!descendants.has(ch.id)) {
            descendants.add(ch.id);
            stack.push(ch.id);
          }
        }
      }
    }
    const nameById = new Map(allCategories.map((c) => [c.id, c.name] as const));
    const pathOf = (c: Cat): string => {
      const parts = [c.name];
      let p = c.parent_id;
      while (p) {
        const parent = allCategories.find((x) => x.id === p);
        if (!parent) break;
        parts.unshift(parent.name);
        p = parent.parent_id;
      }
      return parts.join(" › ");
    };
    const eligible = allCategories
      .filter(
        (c) =>
          c.id !== form.id &&
          !descendants.has(c.id) &&
          (!q ||
            c.name.toLowerCase().includes(q) ||
            pathOf(c).toLowerCase().includes(q)),
      )
      .map((c) => ({ ...c, __path: pathOf(c) }));
    const groups: Record<string, (Cat & { __path: string })[]> = {};
    for (const c of eligible) {
      (groups[c.kind] ||= []).push(c);
    }
    // sort each group by path for a tidy tree order
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.__path.localeCompare(b.__path));
    void nameById;
    return groups;
  }, [allCategories, parentQuery, form.id]);


  const selectedParent = allCategories.find((c) => c.id === form.parent_id);
  const description = form.description ?? "";
  const canSave = !saving && name.length > 0 && !nameError;

  const attemptClose = () => {
    if (touched && !saving) setConfirmDiscard(true);
    else onClose();
  };

  const submit = () => {
    setTouched(true);
    if (!name) return;
    if (nameError) return;
    onSave({
      id: form.id,
      name,
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
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(o) => !o && attemptClose()}>
        <DialogContent
          className="max-w-xl gap-0 overflow-hidden rounded-none border-0 bg-card p-0 shadow-xl sm:rounded-2xl sm:border data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 flex h-[100dvh] w-screen max-h-none flex-col sm:h-auto sm:w-full sm:max-h-[92vh]"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            attemptClose();
          }}
          onInteractOutside={(e) => {
            if (touched) e.preventDefault();
          }}
        >
          {/* Header */}
          <div className="border-b bg-card px-5 pb-4 pt-5 sm:px-6">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="font-display text-xl font-semibold tracking-tight">
                {form.id ? "Edit Category" : "Create Category"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Categories help organize your financial transactions for budgets, reports, and taxes.
              </p>
            </DialogHeader>

            {/* Segmented tabs */}
            <div className="mt-4 inline-flex rounded-lg border bg-muted/60 p-0.5">
              {[
                { k: "details", label: "Details" },
                { k: "tax", label: "Tax Reporting" },
              ].map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setTab(t.k as any)}
                  className={cn(
                    "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
                    tab === t.k
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto bg-[oklch(0.985_0.005_240)] px-5 py-5 dark:bg-background sm:px-6">
            {tab === "details" ? (
              <div className="space-y-5 animate-in fade-in-50 duration-200">
                {/* Name */}
                <div className="grid gap-1.5">
                  <Label htmlFor="cat-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Category Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="cat-name"
                    autoFocus
                    value={form.name ?? ""}
                    onChange={(e) => update({ name: e.target.value })}
                    onBlur={() => setTouched(true)}
                    placeholder="e.g. Groceries"
                    className={cn(
                      "h-10 bg-card",
                      nameError && "border-destructive focus-visible:ring-destructive/30",
                    )}
                    aria-invalid={!!nameError}
                    aria-describedby={nameError ? "cat-name-error" : undefined}
                  />
                  {nameError && (
                    <p id="cat-name-error" className="text-xs text-destructive animate-in fade-in-50">
                      {nameError}
                    </p>
                  )}
                </div>

                {/* Type cards */}
                <div className="grid gap-2">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Category Type
                  </Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <TypeCard
                      title="Income"
                      description="Money coming in"
                      icon={TrendingUp}
                      accent="text-emerald-600"
                      selected={mode === "income"}
                      onClick={() => setMode("income")}
                    />
                    <TypeCard
                      title="Expense"
                      description="Money going out"
                      icon={TrendingDown}
                      accent="text-rose-600"
                      selected={mode === "expense"}
                      onClick={() => setMode("expense")}
                    />
                    <TypeCard
                      title="Subcategory"
                      description="Nested under another"
                      icon={FolderTree}
                      accent="text-indigo-600"
                      selected={mode === "subcategory"}
                      onClick={() => setMode("subcategory")}
                    />
                  </div>
                </div>

                {/* Parent picker (animated) */}
                {mode === "subcategory" && (
                  <div className="grid gap-1.5 animate-in fade-in-50 slide-in-from-top-1 duration-200">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Parent Category
                    </Label>
                    <Popover open={parentOpen} onOpenChange={setParentOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="flex h-10 items-center justify-between rounded-md border bg-card px-3 text-left text-sm shadow-sm hover:bg-muted/30"
                          aria-haspopup="listbox"
                          aria-expanded={parentOpen}
                        >
                          {selectedParent ? (
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium capitalize",
                                  KIND_STYLES[selectedParent.kind],
                                )}
                              >
                                {selectedParent.kind}
                              </span>
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
                          <CommandInput
                            placeholder="Search parents…"
                            value={parentQuery}
                            onValueChange={setParentQuery}
                          />
                          <CommandList className="max-h-64">
                            <CommandEmpty>No categories found.</CommandEmpty>
                            {Object.entries(parentGroups).map(([kind, list]) => (
                              <CommandGroup key={kind} heading={kind.charAt(0).toUpperCase() + kind.slice(1)}>
                                {list.map((p) => (
                                  <CommandItem
                                    key={p.id}
                                    value={`${p.kind}:${p.name}`}
                                    onSelect={() => {
                                      update({ parent_id: p.id, kind: p.kind });
                                      setParentOpen(false);
                                    }}
                                  >
                                    <span
                                      className={cn(
                                        "mr-2 inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium capitalize",
                                        KIND_STYLES[p.kind],
                                      )}
                                    >
                                      {p.kind}
                                    </span>
                                    {p.name}
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

                {/* Scope + Group */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Scope
                    </Label>
                    <Select
                      value={form.scope ?? "personal"}
                      onValueChange={(v: any) => update({ scope: v })}
                    >
                      <SelectTrigger className="h-10 bg-card">
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
                  <div className="grid gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Group
                    </Label>
                    <Input
                      value={form.group_label ?? ""}
                      onChange={(e) => update({ group_label: e.target.value })}
                      placeholder="e.g. Household"
                      className="h-10 bg-card"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Description <span className="normal-case text-muted-foreground/70">(optional)</span>
                    </Label>
                    <span
                      className={cn(
                        "text-[11px] tabular-nums text-muted-foreground",
                        description.length > 450 && "text-warning-foreground",
                        description.length >= 500 && "text-destructive",
                      )}
                    >
                      {description.length}/500
                    </span>
                  </div>
                  <Textarea
                    rows={3}
                    maxLength={500}
                    value={description}
                    onChange={(e) => update({ description: e.target.value })}
                    placeholder="Add a short note about what belongs in this category…"
                    className="resize-none bg-card"
                  />
                </div>

                <label className="flex items-center justify-between rounded-lg border bg-card p-3">
                  <div>
                    <div className="text-sm font-medium">Hidden</div>
                    <div className="text-xs text-muted-foreground">
                      Keep out of pickers, budgets, and reports.
                    </div>
                  </div>
                  <Switch
                    checked={!!form.is_hidden}
                    onCheckedChange={(v) => update({ is_hidden: v })}
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-5 animate-in fade-in-50 duration-200">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tax Category
                  </Label>
                  <Select
                    value={form.tax_code?.split("|")[0] || "__none"}
                    onValueChange={(v) => {
                      const line = form.tax_code?.split("|")[1] ?? "";
                      update({ tax_code: v === "__none" ? null : line ? `${v}|${line}` : v });
                    }}
                  >
                    <SelectTrigger className="h-10 bg-card">
                      <SelectValue placeholder="Select a tax category" />
                    </SelectTrigger>
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
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tax Line Mapping
                  </Label>
                  <Input
                    value={form.tax_code?.split("|")[1] ?? ""}
                    onChange={(e) => {
                      const cat = form.tax_code?.split("|")[0] ?? "";
                      const line = e.target.value;
                      update({ tax_code: cat ? `${cat}|${line}` : line ? `|${line}` : null });
                    }}
                    placeholder="e.g. Schedule VI — Line 3(a)"
                    className="h-10 bg-card"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Optional. Maps this category to a specific tax form line for exports.
                  </p>
                </div>

                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Receipt className="h-3.5 w-3.5" /> Reporting Preview
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <PreviewRow label="Category" value={name || "Untitled"} />
                    <PreviewRow
                      label="Type"
                      value={
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize",
                            KIND_STYLES[(form.kind ?? "expense") as Cat["kind"]],
                          )}
                        >
                          {form.kind ?? "expense"}
                        </span>
                      }
                    />
                    <PreviewRow
                      label="Tax Category"
                      value={
                        form.tax_code?.split("|")[0] || (
                          <span className="text-muted-foreground">Not taxable</span>
                        )
                      }
                    />
                    <PreviewRow
                      label="Tax Line"
                      value={
                        form.tax_code?.split("|")[1] || (
                          <span className="text-muted-foreground">—</span>
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-card px-5 py-3 sm:px-6">
            <p className="hidden text-xs text-muted-foreground sm:block">
              {touched ? "Unsaved changes" : "\u00A0"}
            </p>
            <div className="flex flex-1 gap-2 sm:flex-none sm:justify-end">
              <Button variant="outline" onClick={attemptClose} className="flex-1 sm:flex-none">
                Cancel
              </Button>
              <Button
                disabled={!canSave}
                onClick={submit}
                className="flex-1 sm:flex-none"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                    Saving…
                  </span>
                ) : form.id ? (
                  "Save Changes"
                ) : (
                  "Create Category"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to this category will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false);
                onClose();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TypeCard({
  title,
  description,
  icon: Icon,
  accent,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  icon: any;
  accent: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left transition-all",
        "hover:border-primary/40 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30 shadow-sm"
          : "border-border",
      )}
    >
      <div
        className={cn(
          "grid h-8 w-8 place-items-center rounded-lg bg-muted",
          selected && "bg-primary/10",
        )}
      >
        <Icon className={cn("h-4 w-4", accent)} />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] leading-snug text-muted-foreground">{description}</div>
      {selected && (
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
      )}
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

