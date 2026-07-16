import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Sparkles,
  Upload,
  Download,
  Filter as FilterIcon,
  ArrowUpDown,
  Lock,
  Unlock,
  Star,
  StarOff,
  Trash2,
  Copy,
  Zap,
  ZapOff,
  Calendar,
  Repeat,
  ChevronDown,
  ChevronRight,
  X,
  Settings2,
  MoreHorizontal,
  Wand2,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Building2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  listMemorizedPayees,
  createMemorizedPayee,
  updateMemorizedPayee,
  deleteMemorizedPayees,
  bulkUpdateMemorizedPayees,
  listCategoriesForPayees,
  listAccountsForPayees,
} from "@/lib/memorized-payees.functions";

export const Route = createFileRoute("/_authenticated/payees")({
  component: PayeesPage,
});

type Payee = Awaited<ReturnType<typeof listMemorizedPayees>>[number];

const TXN_TYPES = [
  { value: "expense", label: "Expense", icon: TrendingDown, tone: "text-rose-600" },
  { value: "income", label: "Income", icon: TrendingUp, tone: "text-emerald-600" },
  { value: "transfer", label: "Transfer", icon: ArrowRight, tone: "text-blue-600" },
  { value: "deposit", label: "Deposit", icon: TrendingUp, tone: "text-emerald-600" },
  { value: "withdrawal", label: "Withdrawal", icon: TrendingDown, tone: "text-amber-600" },
  { value: "investment", label: "Investment", icon: Building2, tone: "text-violet-600" },
] as const;

const FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly", "custom"] as const;

function inr(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function relTime(iso: string | null | undefined) {
  if (!iso) return "Never";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "Today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function PayeesPage() {
  const qc = useQueryClient();
  const list = useServerFn(listMemorizedPayees);
  const listCats = useServerFn(listCategoriesForPayees);
  const listAccts = useServerFn(listAccountsForPayees);
  const create = useServerFn(createMemorizedPayee);
  const update = useServerFn(updateMemorizedPayee);
  const del = useServerFn(deleteMemorizedPayees);
  const bulk = useServerFn(bulkUpdateMemorizedPayees);

  const payees = useQuery({ queryKey: ["memorized-payees"], queryFn: () => list() });
  const cats = useQuery({ queryKey: ["mp-cats"], queryFn: () => listCats() });
  const accts = useQuery({ queryKey: ["mp-accts"], queryFn: () => listAccts() });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [autoFilter, setAutoFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("alpha");
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["memorized-payees"] });

  const createMut = useMutation({
    mutationFn: async (draft: any) => create({ data: draft }),
    onSuccess: (row: any) => {
      invalidate();
      setSelectedId(row.id);
      toast.success("Payee created");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create"),
  });

  const updateMut = useMutation({
    mutationFn: async (v: { id: string; patch: any }) => update({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const delMut = useMutation({
    mutationFn: async (ids: string[]) => del({ data: { ids } }),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      setMulti(new Set());
      toast.success("Deleted");
    },
  });

  const bulkMut = useMutation({
    mutationFn: async (v: { ids: string[]; patch: any }) => bulk({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("Bulk update applied");
    },
  });

  const filtered = useMemo(() => {
    const rows = (payees.data ?? []) as Payee[];
    const term = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (term) {
        const hay = `${r.merchant} ${r.memo ?? ""} ${(r.tags ?? []).join(" ")} ${r.address ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (typeFilter !== "all" && r.txn_type !== typeFilter) return false;
      if (autoFilter === "on" && !r.auto_categorize) return false;
      if (autoFilter === "off" && r.auto_categorize) return false;
      if (statusFilter === "locked" && !r.locked) return false;
      if (statusFilter === "recurring" && !r.is_recurring) return false;
      if (statusFilter === "favorites" && !r.is_favorite) return false;
      if (statusFilter === "disabled" && !r.is_disabled) return false;
      return true;
    });
    switch (sort) {
      case "recent":
        out = [...out].sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""));
        break;
      case "most":
        out = [...out].sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0));
        break;
      case "newest":
        out = [...out].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        break;
      case "oldest":
        out = [...out].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
        break;
      default:
        out = [...out].sort((a, b) => a.merchant.localeCompare(b.merchant));
    }
    return out;
  }, [payees.data, search, typeFilter, autoFilter, statusFilter, sort]);

  const selected = useMemo(
    () => (payees.data ?? []).find((p: Payee) => p.id === selectedId) ?? null,
    [payees.data, selectedId],
  );

  const toggleMulti = (id: string) => {
    setMulti((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    createMut.mutate({
      merchant: "New payee",
      txn_type: "expense",
      tags: [],
      splits: [],
      currency: "INR",
      restrict_account_ids: [],
      auto_categorize: true,
      priority: 0,
    });
  };

  const handleExport = () => {
    const rows = payees.data ?? [];
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memorized-payees-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported");
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw new Error("Invalid file");
      let ok = 0;
      for (const r of arr) {
        const { id, household_id, created_at, updated_at, category, usage_count, last_used_at, created_by, modified_by, ...rest } = r;
        try {
          await create({ data: { ...rest, merchant: r.merchant ?? "Imported" } });
          ok++;
        } catch {}
      }
      invalidate();
      toast.success(`Imported ${ok} payees`);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    }
  };

  const stats = useMemo(() => {
    const rows = (payees.data ?? []) as Payee[];
    return {
      total: rows.length,
      automated: rows.filter((r) => r.auto_categorize && !r.is_disabled).length,
      recurring: rows.filter((r) => r.is_recurring).length,
      locked: rows.filter((r) => r.locked).length,
    };
  }, [payees.data]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-[#F8FAFC]">
      {/* Global header */}
      <div className="border-b bg-white px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900">Memorized Payees</h1>
                <p className="truncate text-sm text-slate-500">
                  Reusable merchant templates that categorize and populate future transactions.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatChip label="Total" value={stats.total} />
            <StatChip label="Automated" value={stats.automated} tone="emerald" />
            <StatChip label="Recurring" value={stats.recurring} tone="violet" />
            <StatChip label="Locked" value={stats.locked} tone="amber" />
            <div className="mx-1 h-6 w-px bg-slate-200" />
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Wand2 className="h-4 w-4" /> AI Assistant
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Import
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleExport}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleCreate} disabled={createMut.isPending}>
              <Plus className="h-4 w-4" /> New Payee
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="sticky top-0 z-10 border-b bg-white/80 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search payees, memos, tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-lg border-slate-200 bg-slate-50 pl-9 focus-visible:bg-white"
            />
          </div>
          <ToolbarSelect icon={FilterIcon} label="Type" value={typeFilter} onChange={setTypeFilter} options={[
            { value: "all", label: "All types" },
            ...TXN_TYPES.map((t) => ({ value: t.value, label: t.label })),
          ]} />
          <ToolbarSelect icon={Zap} label="Automation" value={autoFilter} onChange={setAutoFilter} options={[
            { value: "all", label: "Any automation" },
            { value: "on", label: "Enabled" },
            { value: "off", label: "Disabled" },
          ]} />
          <ToolbarSelect icon={Settings2} label="Status" value={statusFilter} onChange={setStatusFilter} options={[
            { value: "all", label: "Any status" },
            { value: "favorites", label: "Favorites" },
            { value: "locked", label: "Locked" },
            { value: "recurring", label: "Recurring" },
            { value: "disabled", label: "Disabled" },
          ]} />
          <ToolbarSelect icon={ArrowUpDown} label="Sort" value={sort} onChange={setSort} options={[
            { value: "alpha", label: "A → Z" },
            { value: "recent", label: "Recently used" },
            { value: "most", label: "Most used" },
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
          ]} />
          {multi.size > 0 && (
            <>
              <div className="mx-1 h-6 w-px bg-slate-200" />
              <span className="text-xs font-medium text-slate-600">{multi.size} selected</span>
              <Button size="sm" variant="ghost" onClick={() => bulkMut.mutate({ ids: [...multi], patch: { auto_categorize: true } })}>
                <Zap className="mr-1.5 h-4 w-4" /> Enable automation
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulkMut.mutate({ ids: [...multi], patch: { auto_categorize: false } })}>
                <ZapOff className="mr-1.5 h-4 w-4" /> Disable
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulkMut.mutate({ ids: [...multi], patch: { locked: true } })}>
                <Lock className="mr-1.5 h-4 w-4" /> Lock
              </Button>
              <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" onClick={() => setConfirmDel([...multi])}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Two-panel workspace */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left list */}
        <div className="flex w-full flex-col overflow-hidden border-r bg-white lg:w-[420px] xl:w-[460px]">
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {payees.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-[92px] w-full rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState hasFilters={!!search || typeFilter !== "all" || statusFilter !== "all"} onCreate={handleCreate} />
            ) : (
              <ul className="space-y-1.5">
                {filtered.map((p: Payee) => (
                  <PayeeCard
                    key={p.id}
                    payee={p}
                    active={selectedId === p.id}
                    checked={multi.has(p.id)}
                    onCheck={() => toggleMulti(p.id)}
                    onSelect={() => setSelectedId(p.id)}
                    onFavorite={() =>
                      updateMut.mutate({ id: p.id, patch: { is_favorite: !p.is_favorite } })
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right details */}
        <div className="hidden flex-1 overflow-y-auto lg:block">
          {selected ? (
            <DetailsPanel
              payee={selected}
              cats={cats.data ?? []}
              accts={accts.data ?? []}
              onPatch={(patch) => updateMut.mutate({ id: selected.id, patch })}
              onDelete={() => setConfirmDel([selected.id])}
              onDuplicate={() => {
                const { id, household_id, created_at, updated_at, category, usage_count, last_used_at, ...rest } = selected as any;
                createMut.mutate({ ...rest, merchant: `${selected.merchant} (copy)` });
              }}
              saving={updateMut.isPending}
            />
          ) : (
            <div className="grid h-full place-items-center p-10">
              <div className="max-w-sm text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-600">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">Select a payee to view details</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Or create a new memorized payee to start automating transaction entry.
                </p>
                <Button className="mt-4" onClick={handleCreate}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create payee
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile drawer (rendered as overlay) */}
      {selected && (
        <div className="fixed inset-0 z-50 flex bg-black/40 lg:hidden" onClick={() => setSelectedId(null)}>
          <div className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-3">
              <div className="text-sm font-semibold">Payee details</div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <DetailsPanel
                payee={selected}
                cats={cats.data ?? []}
                accts={accts.data ?? []}
                onPatch={(patch) => updateMut.mutate({ id: selected.id, patch })}
                onDelete={() => setConfirmDel([selected.id])}
                onDuplicate={() => {
                  const { id, household_id, created_at, updated_at, category, usage_count, last_used_at, ...rest } = selected as any;
                  createMut.mutate({ ...rest, merchant: `${selected.merchant} (copy)` });
                }}
                saving={updateMut.isPending}
              />
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDel?.length ?? 0} payee{(confirmDel?.length ?? 0) > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the memorized template only. Existing transactions are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => {
                if (confirmDel) delMut.mutate(confirmDel);
                setConfirmDel(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- helpers ---------- */

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "violet" | "amber" }) {
  const toneMap = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
  } as const;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        tone ? toneMap[tone] : "bg-slate-50 text-slate-700 ring-slate-200",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums font-semibold">{value}</span>
    </div>
  );
}

function ToolbarSelect({
  icon: Icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: any;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[130px] gap-1.5 rounded-lg border-slate-200 bg-white text-xs">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-slate-500">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PayeeCard({
  payee,
  active,
  checked,
  onCheck,
  onSelect,
  onFavorite,
}: {
  payee: Payee;
  active: boolean;
  checked: boolean;
  onCheck: () => void;
  onSelect: () => void;
  onFavorite: () => void;
}) {
  const type = TXN_TYPES.find((t) => t.value === payee.txn_type) ?? TXN_TYPES[0];
  const TIcon = type.icon;
  return (
    <li
      onClick={onSelect}
      className={cn(
        "group relative cursor-pointer rounded-xl border p-3 transition-all",
        active
          ? "border-violet-300 bg-violet-50/60 shadow-sm ring-1 ring-violet-200"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm",
        payee.is_disabled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCheck();
          }}
          className={cn(
            "mt-1 grid h-4 w-4 shrink-0 place-items-center rounded border transition",
            checked ? "border-violet-500 bg-violet-500 text-white" : "border-slate-300 opacity-0 group-hover:opacity-100",
          )}
          aria-label="Select payee"
        >
          {checked && <span className="text-[10px]">✓</span>}
        </button>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-semibold text-slate-700">
          {initials(payee.merchant)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-900">{payee.merchant}</span>
                {payee.locked && <Lock className="h-3 w-3 shrink-0 text-amber-600" aria-label="Locked" />}
                {payee.is_recurring && <Repeat className="h-3 w-3 shrink-0 text-violet-600" aria-label="Recurring" />}
                {payee.show_in_calendar && <Calendar className="h-3 w-3 shrink-0 text-blue-600" aria-label="Calendar" />}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                <TIcon className={cn("h-3 w-3", type.tone)} />
                <span>{type.label}</span>
                {payee.category && (
                  <>
                    <span>·</span>
                    <span className="truncate">{(payee.category as any).name}</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums text-slate-900">{inr(payee.default_amount as any)}</div>
              <div className="text-[10px] text-slate-400">{relTime(payee.last_used_at)}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {payee.auto_categorize ? (
              <Badge variant="secondary" className="h-5 gap-1 rounded-md bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50">
                <Zap className="h-2.5 w-2.5" /> Auto
              </Badge>
            ) : (
              <Badge variant="secondary" className="h-5 rounded-md bg-slate-100 px-1.5 text-[10px] text-slate-500 hover:bg-slate-100">
                Manual
              </Badge>
            )}
            {(payee.tags ?? []).slice(0, 2).map((t) => (
              <Badge key={t} variant="secondary" className="h-5 rounded-md bg-slate-100 px-1.5 text-[10px] font-normal text-slate-600 hover:bg-slate-100">
                {t}
              </Badge>
            ))}
            {(payee.tags?.length ?? 0) > 2 && (
              <span className="text-[10px] text-slate-400">+{(payee.tags?.length ?? 0) - 2}</span>
            )}
            <span className="ml-auto text-[10px] text-slate-400">
              {payee.usage_count ?? 0} txn{(payee.usage_count ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFavorite();
          }}
          className="opacity-0 transition group-hover:opacity-100"
          aria-label="Favorite"
        >
          {payee.is_favorite ? (
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          ) : (
            <StarOff className="h-4 w-4 text-slate-400 hover:text-amber-500" />
          )}
        </button>
      </div>
    </li>
  );
}

function EmptyState({ hasFilters, onCreate }: { hasFilters: boolean; onCreate: () => void }) {
  return (
    <div className="grid place-items-center py-16 text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-600">
          <Sparkles className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">
          {hasFilters ? "No matching payees" : "No memorized payees yet"}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {hasFilters
            ? "Try adjusting your search or filters."
            : "Create your first automation rule to speed up transaction entry."}
        </p>
        {!hasFilters && (
          <Button size="sm" className="mt-3" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> New payee
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- Details panel ---------- */

function DetailsPanel({
  payee: payeeProp,
  cats,
  accts,
  onPatch: onPatchProp,
  onDelete,
  onDuplicate,
  saving,
}: {
  payee: Payee;
  cats: any[];
  accts: any[];
  onPatch: (patch: any) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  saving: boolean;
}) {
  // Local draft overlay + debounced flush so typing doesn't hit the server on every keystroke.
  const [draft, setDraft] = useState<Record<string, any>>({});
  const pending = useRef<Record<string, any>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPatchRef = useRef(onPatchProp);
  useEffect(() => { onPatchRef.current = onPatchProp; }, [onPatchProp]);

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    if (p && Object.keys(p).length) {
      onPatchRef.current(p);
      pending.current = {};
      setDraft({});
    }
  };

  // Flush and reset when switching to a different payee.
  useEffect(() => {
    flush();
    setDraft({});
    pending.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payeeProp.id]);

  // Flush on unmount.
  useEffect(() => () => flush(), []);

  const payee = { ...payeeProp, ...draft } as Payee;
  const onPatch = (patch: any) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  const type = TXN_TYPES.find((t) => t.value === payee.txn_type) ?? TXN_TYPES[0];
  const TIcon = type.icon;
  const [tagInput, setTagInput] = useState("");
  const addTag = () => {
    const v = tagInput.trim();
    if (!v) return;
    if ((payee.tags ?? []).includes(v)) return;
    onPatch({ tags: [...(payee.tags ?? []), v] });
    setTagInput("");
  };


  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* Sticky header */}
      <div className="sticky top-0 -mx-6 mb-4 flex items-center gap-3 border-b bg-[#F8FAFC]/95 px-6 py-3 backdrop-blur">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-sm font-semibold text-slate-700">
          {initials(payee.merchant)}
        </div>
        <div className="min-w-0 flex-1">
          <Input
            value={payee.merchant}
            onChange={(e) => onPatch({ merchant: e.target.value })}
            className="h-8 border-0 bg-transparent p-0 text-lg font-semibold shadow-none focus-visible:ring-0"
          />
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <TIcon className={cn("h-3 w-3", type.tone)} />
            <span>{type.label}</span>
            <span>·</span>
            <span>{payee.usage_count ?? 0} transactions</span>
            <span>·</span>
            <span>{saving ? "Saving…" : "Autosaved"}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onPatch({ is_favorite: !payee.is_favorite })} aria-label="Favorite">
          {payee.is_favorite ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : <StarOff className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onPatch({ locked: !payee.locked })} aria-label="Lock">
          {payee.locked ? <Lock className="h-4 w-4 text-amber-600" /> : <Unlock className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPatch({ is_disabled: !payee.is_disabled })}>
              {payee.is_disabled ? <Zap className="mr-2 h-4 w-4" /> : <ZapOff className="mr-2 h-4 w-4" />}
              {payee.is_disabled ? "Enable" : "Disable"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-rose-600 focus:text-rose-600">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* AI banner */}
      {(payee.usage_count ?? 0) >= 3 && payee.ai_suggestions && (
        <div className="mb-4 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/70 text-violet-600">
              <Wand2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">
                Smart insight
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                This merchant appears {payee.usage_count} times. Average amount {inr((payee.default_amount as any) ?? 0)}.
                Consider enabling automatic categorization for faster entry.
              </p>
            </div>
            {!payee.auto_categorize && (
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => onPatch({ auto_categorize: true })}>
                Enable
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <Section title="General information" defaultOpen>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Payee name" className="sm:col-span-2">
              <Input
                value={payee.merchant ?? ""}
                onChange={(e) => onPatch({ merchant: e.target.value })}
                placeholder="e.g., Netflix, Amazon, Landlord"
              />
            </Field>
            <Field label="Merchant type">
              <Input
                value={payee.merchant_type ?? ""}
                onChange={(e) => onPatch({ merchant_type: e.target.value || null })}
                placeholder="e.g., Streaming, Restaurant"
              />
            </Field>
            <Field label="Website">
              <Input
                value={payee.website ?? ""}
                onChange={(e) => onPatch({ website: e.target.value || null })}
                placeholder="https://"
              />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input
                value={payee.address ?? ""}
                onChange={(e) => onPatch({ address: e.target.value || null })}
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                value={payee.notes ?? ""}
                onChange={(e) => onPatch({ notes: e.target.value || null })}
                rows={3}
              />
            </Field>
          </div>
        </Section>

        <Section title="Default transaction" defaultOpen>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={payee.txn_type} onValueChange={(v) => onPatch({ txn_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TXN_TYPES.map((t) => {
                    const I = t.icon;
                    return (
                      <SelectItem key={t.value} value={t.value}>
                        <div className="flex items-center gap-2">
                          <I className={cn("h-4 w-4", t.tone)} /> {t.label}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Category">
              <Select
                value={payee.category_id ?? "none"}
                onValueChange={(v) => onPatch({ category_id: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">— None —</SelectItem>
                  {cats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Default amount">
              <Input
                type="number"
                inputMode="decimal"
                value={payee.default_amount ?? ""}
                onChange={(e) => onPatch({ default_amount: e.target.value ? Number(e.target.value) : null })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Tolerance %">
              <Input
                type="number"
                value={payee.amount_tolerance_pct ?? ""}
                onChange={(e) => onPatch({ amount_tolerance_pct: e.target.value ? Number(e.target.value) : null })}
                placeholder="e.g., 10"
              />
            </Field>
            <Field label="Payment method">
              <Input
                value={payee.payment_method ?? ""}
                onChange={(e) => onPatch({ payment_method: e.target.value || null })}
                placeholder="UPI, Card, Cash…"
              />
            </Field>
            <Field label="Default account">
              <Select
                value={payee.account_id ?? "none"}
                onValueChange={(v) => onPatch({ account_id: v === "none" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Any —</SelectItem>
                  {accts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Memo" className="sm:col-span-2">
              <Textarea
                value={payee.memo ?? ""}
                onChange={(e) => onPatch({ memo: e.target.value || null })}
                rows={2}
                maxLength={500}
              />
              <div className="mt-1 text-right text-[10px] text-slate-400">{(payee.memo ?? "").length}/500</div>
            </Field>
            <Field label="Tags" className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-white p-2">
                {(payee.tags ?? []).map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1 rounded-md bg-slate-100 font-normal">
                    {t}
                    <button
                      className="ml-0.5 opacity-60 hover:opacity-100"
                      onClick={() => onPatch({ tags: (payee.tags ?? []).filter((x) => x !== t) })}
                      aria-label={`Remove ${t}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder="Add tag…"
                  className="min-w-[100px] flex-1 bg-transparent text-xs outline-none"
                />
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Automation rules" defaultOpen>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              ["auto_categorize", "Automatically categorize"],
              ["auto_memo", "Automatically populate memo"],
              ["auto_tags", "Automatically populate tags"],
              ["auto_amount", "Automatically set amount"],
              ["auto_clear", "Automatically clear transaction"],
              ["auto_attach_receipt", "Automatically attach receipt"],
              ["auto_budget", "Automatically assign budget"],
              ["auto_reviewed", "Automatically mark reviewed"],
              ["auto_tax", "Apply tax category"],
              ["auto_business", "Apply business tag"],
            ].map(([key, label]) => (
              <ToggleRow
                key={key}
                label={label}
                checked={(payee as any)[key]}
                onChange={(v) => onPatch({ [key]: v })}
              />
            ))}
          </div>
        </Section>

        <Section title="Recurring settings">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ToggleRow
              label="This is a recurring payment"
              checked={payee.is_recurring}
              onChange={(v) => onPatch({ is_recurring: v })}
            />
            <ToggleRow
              label="Show in calendar"
              checked={payee.show_in_calendar}
              onChange={(v) => onPatch({ show_in_calendar: v })}
            />
            {payee.is_recurring && (
              <>
                <Field label="Frequency">
                  <Select
                    value={payee.recurrence_freq ?? "monthly"}
                    onValueChange={(v) => onPatch({ recurrence_freq: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map((f) => (
                        <SelectItem key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Next expected date">
                  <Input
                    type="date"
                    value={payee.next_expected_date ?? ""}
                    onChange={(e) => onPatch({ next_expected_date: e.target.value || null })}
                  />
                </Field>
                <Field label="Reminder days before">
                  <Input
                    type="number"
                    value={payee.reminder_days ?? ""}
                    onChange={(e) => onPatch({ reminder_days: e.target.value ? Number(e.target.value) : null })}
                    placeholder="e.g., 3"
                  />
                </Field>
              </>
            )}
          </div>
        </Section>

        <Section title="Advanced preferences">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ToggleRow label="Lock from automatic updates" checked={payee.locked} onChange={(v) => onPatch({ locked: v })} />
            <ToggleRow label="Never auto-categorize" checked={payee.never_auto} onChange={(v) => onPatch({ never_auto: v })} />
            <ToggleRow label="Allow AI suggestions" checked={payee.ai_suggestions} onChange={(v) => onPatch({ ai_suggestions: v })} />
            <ToggleRow label="Enable fuzzy matching" checked={payee.fuzzy_match} onChange={(v) => onPatch({ fuzzy_match: v })} />
            <ToggleRow label="Exact merchant name only" checked={payee.exact_match_only} onChange={(v) => onPatch({ exact_match_only: v })} />
            <ToggleRow label="Enable for downloaded" checked={payee.apply_to_downloaded} onChange={(v) => onPatch({ apply_to_downloaded: v })} />
            <ToggleRow label="Enable for manual" checked={payee.apply_to_manual} onChange={(v) => onPatch({ apply_to_manual: v })} />
            <ToggleRow label="Enable for CSV import" checked={payee.apply_to_import} onChange={(v) => onPatch({ apply_to_import: v })} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Apply only above amount">
              <Input
                type="number"
                value={payee.min_amount ?? ""}
                onChange={(e) => onPatch({ min_amount: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
            <Field label="Apply only below amount">
              <Input
                type="number"
                value={payee.max_amount ?? ""}
                onChange={(e) => onPatch({ max_amount: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
            <Field label="Date range start">
              <Input
                type="date"
                value={payee.date_range_start ?? ""}
                onChange={(e) => onPatch({ date_range_start: e.target.value || null })}
              />
            </Field>
            <Field label="Date range end">
              <Input
                type="date"
                value={payee.date_range_end ?? ""}
                onChange={(e) => onPatch({ date_range_end: e.target.value || null })}
              />
            </Field>
            <Field label="Priority">
              <Input
                type="number"
                value={payee.priority ?? 0}
                onChange={(e) => onPatch({ priority: Number(e.target.value || 0) })}
              />
            </Field>
          </div>
        </Section>

        <Section title="Activity history">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Uses" value={String(payee.usage_count ?? 0)} />
            <Stat label="Last used" value={relTime(payee.last_used_at)} />
            <Stat label="Created" value={relTime(payee.created_at)} />
            <Stat label="Modified" value={relTime(payee.updated_at)} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs font-medium text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 transition hover:bg-slate-50">
      <span className="text-sm text-slate-700">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
