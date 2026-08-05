import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Merge,
  Scissors,
  EyeOff,
  Check,
  Users,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Cluster,
  clusterTotal,
  clusterTxnCount,
  memberCohesion,
  mergeClusters,
  moveMembers,
  splitCluster,

  summarize,
} from "@/lib/statement-clusters";
import { MatchSourceBadge, StatusBadge, ConfidenceMeter } from "./badges";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string; parent_id: string | null };

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "INR", maximumFractionDigits: 0 });

type FilterKey = "all" | "review" | "ai" | "existing" | "new" | "ignored";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "ai", label: "AI suggested" },
  { key: "existing", label: "Existing" },
  { key: "new", label: "New" },
  { key: "ignored", label: "Ignored" },
];

function StatTile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-[10px] border bg-card px-2 py-1.5 text-left transition-colors",
        onClick && "hover:bg-muted/60",
        active && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</div>
    </button>
  );
}

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger className="h-7 w-full text-xs" aria-label="Category">
        <SelectValue placeholder="Category" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Uncategorized</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.parent_id ? `— ${c.name}` : c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ClusterCard({
  cluster,
  categories,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onPatch,
  onSplit,
}: {
  cluster: Cluster;
  categories: Category[];
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<Cluster>) => void;
  onSplit: () => void;
}) {
  const count = clusterTxnCount(cluster);
  const total = clusterTotal(cluster);
  const ignored = cluster.status === "ignored";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-2.5 py-2 shadow-sm transition-colors",
        selected && "border-primary/50 bg-primary/5",
        ignored && "opacity-55",
      )}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${cluster.name}`}
          className="mt-1"
        />
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${cluster.members.length} descriptions`}
          className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              value={cluster.name}
              onChange={(e) => onPatch({ name: e.target.value, source: "manual", status: "approved", confidence: 1 })}
              aria-label="Payee name"
              className="h-7 max-w-[280px] flex-1 text-xs font-medium"
            />
            <MatchSourceBadge source={cluster.pendingAi ? "pending" : cluster.source} />
            <StatusBadge status={cluster.status} />
            <ConfidenceMeter value={cluster.confidence} />
            {cluster.isExisting && (
              <span className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info/12 px-1.5 py-px text-[10px] font-medium text-info">
                <Users className="h-2.5 w-2.5" aria-hidden />
                Linked
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              <strong className="text-foreground">{count.toLocaleString()}</strong> txns
            </span>
            <span className="tabular-nums">
              <strong className="text-foreground">{cluster.members.length}</strong> descriptions
            </span>
            <span className="tabular-nums">{money(total)}</span>
            <span className="capitalize">{cluster.type}</span>
            {cluster.tokens.slice(0, 3).map((t) => (
              <span key={t} className="rounded bg-muted px-1 py-px font-mono text-[10px]">
                {t}
              </span>
            ))}
          </div>

          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,200px)_minmax(0,140px)_auto]">
            <CategorySelect
              categories={categories}
              value={cluster.category_id}
              onChange={(v) => onPatch({ category_id: v })}
            />
            <Select
              value={cluster.type}
              onValueChange={(v) =>
                onPatch({ type: v as Cluster["type"], isTransfer: v === "transfer" })
              }
            >
              <SelectTrigger className="h-7 text-xs" aria-label="Transaction type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => onPatch({ status: "approved", pendingAi: false })}
              >
                <Check className="mr-1 h-3 w-3" aria-hidden />
                Approve
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onSplit}>
                <Scissors className="mr-1 h-3 w-3" aria-hidden />
                Split
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => onPatch({ status: ignored ? "review" : "ignored" })}
              >
                <EyeOff className="mr-1 h-3 w-3" aria-hidden />
                {ignored ? "Restore" : "Ignore"}
              </Button>
            </div>
          </div>

          {expanded && (
            <ul className="mt-1 space-y-px rounded-[10px] border bg-muted/25 p-1">
              {cluster.members.slice(0, 60).map((m) => (
                <li
                  key={m.description}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-background"
                >
                  <span className="min-w-0 flex-1 truncate font-mono" title={m.description}>
                    {m.description}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {m.count}× · {money(m.total)}
                  </span>
                </li>
              ))}
              {cluster.members.length > 60 && (
                <li className="px-1.5 py-1 text-[11px] text-muted-foreground">
                  +{cluster.members.length - 60} more descriptions
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConfirmStep({
  clusters,
  setClusters,
  categories,
  aiRemaining,
  polishing,
  onPolish,
  onBack,
  onContinue,
}: {
  clusters: Cluster[];
  setClusters: (next: Cluster[]) => void;
  categories: Category[];
  aiRemaining: number;
  polishing: boolean;
  onPolish: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [splitId, setSplitId] = useState<string | null>(null);
  const [splitPicked, setSplitPicked] = useState<string[]>([]);
  const [moveTargetId, setMoveTargetId] = useState<string>("");

  const parentRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => summarize(clusters), [clusters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clusters
      .filter((c) => {
        if (filter === "review" && c.status !== "review") return false;
        if (filter === "ai" && c.source !== "ai") return false;
        if (filter === "existing" && !c.isExisting) return false;
        if (filter === "new" && c.isExisting) return false;
        if (filter === "ignored" && c.status !== "ignored") return false;
        if (filter !== "ignored" && c.status === "ignored") return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.members.some((m) => m.description.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => clusterTxnCount(b) - clusterTxnCount(a));
  }, [clusters, filter, query]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 132,
    overscan: 6,
  });

  const patch = (id: string, p: Partial<Cluster>) =>
    setClusters(clusters.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const bulk = (p: Partial<Cluster>) => {
    const set = new Set(selectedIds);
    setClusters(clusters.map((c) => (set.has(c.id) ? { ...c, ...p } : c)));
  };

  const splitTarget = clusters.find((c) => c.id === splitId) ?? null;
  const cohesion = useMemo(
    () => (splitTarget ? memberCohesion(splitTarget) : new Map<string, number>()),
    [splitTarget],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Transactions" value={stats.transactions.toLocaleString()} />
        <StatTile
          label="Clusters"
          value={stats.clusters}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <StatTile
          label="Auto matched"
          value={stats.autoMatched}
          tone="text-success"
          active={filter === "existing"}
          onClick={() => setFilter("existing")}
        />
        <StatTile
          label="AI suggested"
          value={stats.aiSuggested}
          tone="text-ai"
          active={filter === "ai"}
          onClick={() => setFilter("ai")}
        />
        <StatTile
          label="Needs review"
          value={stats.needsReview}
          tone="text-warning"
          active={filter === "review"}
          onClick={() => setFilter("review")}
        />
        <StatTile label="New payees" value={stats.newPayees} active={filter === "new"} onClick={() => setFilter("new")} />
        <StatTile label="Ignored" value={stats.ignored} active={filter === "ignored"} onClick={() => setFilter("ignored")} />
      </div>

      {aiRemaining > 0 && (
        <div className="flex items-center gap-2 rounded-[10px] border border-ai/30 bg-ai/8 px-2.5 py-1.5 text-[11px]" role="status">
          <Loader2 className="h-3 w-3 animate-spin text-ai" aria-hidden />
          Naming {aiRemaining.toLocaleString()} unresolved patterns in the background — you can
          keep editing, names fill in live.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search payees or raw descriptions"
            aria-label="Search clusters"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-px rounded-lg border bg-muted/40 p-px">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-[7px] px-2 py-1 text-[11px] font-medium transition-colors",
                filter === f.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={onPolish}
          disabled={polishing}
        >
          <Sparkles className="mr-1 h-3 w-3" aria-hidden />
          {polishing ? "Polishing…" : "AI polish names"}
        </Button>
      </div>

      {/* Bulk bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-primary/40 bg-primary/5 px-2 py-1.5">
          <span className="text-[11px] font-medium">{selectedIds.length} selected</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => bulk({ status: "approved" })}>
            <Check className="mr-1 h-3 w-3" aria-hidden /> Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={selectedIds.length < 2}
            onClick={() => {
              setClusters(mergeClusters(clusters, selectedIds));
              setSelectedIds([]);
            }}
          >
            <Merge className="mr-1 h-3 w-3" aria-hidden /> Merge
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => bulk({ status: "ignored" })}>
            <EyeOff className="mr-1 h-3 w-3" aria-hidden /> Ignore
          </Button>
          <div className="w-[180px]">
            <CategorySelect
              categories={categories}
              value={null}
              onChange={(v) => bulk({ category_id: v })}
            />
          </div>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setSelectedIds([])}>
            Clear
          </Button>
        </div>
      )}

      {/* Virtualized cluster list */}
      <div ref={parentRef} className="min-h-[240px] flex-1 overflow-auto rounded-xl border bg-muted/15 p-1.5">
        {visible.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">No clusters match this view.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const c = visible[v.index]!;
              return (
                <div
                  key={c.id}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start}px)`,
                    padding: "3px",
                  }}
                >
                  <ClusterCard
                    cluster={c}
                    categories={categories}
                    selected={selectedIds.includes(c.id)}
                    expanded={!!expanded[c.id]}
                    onToggleSelect={() =>
                      setSelectedIds((prev) =>
                        prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                      )
                    }
                    onToggleExpand={() => setExpanded((p) => ({ ...p, [c.id]: !p[c.id] }))}
                    onPatch={(p) => patch(c.id, p)}
                    onSplit={() => {
                      setSplitId(c.id);
                      setSplitPicked([]);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t pt-2.5">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {stats.needsReview > 0
              ? `${stats.needsReview} cluster${stats.needsReview === 1 ? "" : "s"} still need review`
              : "All clusters resolved"}
          </span>
          <Button size="sm" onClick={onContinue}>
            Review transactions
          </Button>
        </div>
      </div>

      {/* Split drawer */}
      <Sheet open={!!splitTarget} onOpenChange={(o) => !o && setSplitId(null)}>
        <SheetContent className="flex w-full flex-col gap-3 sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="text-sm">Split “{splitTarget?.name}”</SheetTitle>
            <SheetDescription className="text-xs">
              Pick the raw descriptions that belong to a different merchant. Similarity shows how
              close each description is to the group representative.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-px overflow-auto rounded-[10px] border p-1">
            {splitTarget?.members.map((m) => {
              const sim = Math.round((cohesion.get(m.description) ?? 0) * 100);
              const picked = splitPicked.includes(m.description);
              return (
                <label
                  key={m.description}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-muted/60",
                    picked && "bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={picked}
                    onCheckedChange={() =>
                      setSplitPicked((prev) =>
                        prev.includes(m.description)
                          ? prev.filter((d) => d !== m.description)
                          : [...prev, m.description],
                      )
                    }
                    aria-label={`Split out ${m.description}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono">{m.description}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{m.count}×</span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      sim >= 80 ? "text-success" : sim >= 55 ? "text-warning" : "text-destructive",
                    )}
                  >
                    {sim}%
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSplitId(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={splitPicked.length === 0}
              onClick={() => {
                setClusters(splitCluster(clusters, splitId!, splitPicked));
                setSplitId(null);
                setSplitPicked([]);
              }}
            >
              Split {splitPicked.length} out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
