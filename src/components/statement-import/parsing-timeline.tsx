import { Check, Loader2, CircleDashed, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const STAGE_ORDER = [
  "read",
  "table",
  "rows",
  "columns",
  "parse",
  "dedupe",
  "normalize",
  "payees",
  "rules",
  "cluster",
  "ai",
  "review",
] as const;

export type StageKey = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  read: "Reading file",
  table: "Detecting table",
  rows: "Extracting rows",
  columns: "Detecting columns",
  parse: "Parsing transactions",
  dedupe: "Removing duplicates",
  normalize: "Normalizing descriptions",
  payees: "Matching existing payees",
  rules: "Applying rules",
  cluster: "Smart clustering",
  ai: "AI naming unresolved clusters",
  review: "Preparing review",
};

export type StageState = "pending" | "active" | "done" | "error";

export type Stage = {
  key: StageKey;
  state: StageState;
  detail?: string;
  processed?: number;
  total?: number;
  ms?: number;
};

export type ProcessingStats = {
  rowsScanned: number;
  transactions: number;
  duplicatesRemoved: number;
  uniqueDescriptions: number;
  payeesMatched: number;
  rulesMatched: number;
  clusters: number;
  aiRemaining: number;
  exceptions: number;
};

export const emptyStats: ProcessingStats = {
  rowsScanned: 0,
  transactions: 0,
  duplicatesRemoved: 0,
  uniqueDescriptions: 0,
  payeesMatched: 0,
  rulesMatched: 0,
  clusters: 0,
  aiRemaining: 0,
  exceptions: 0,
};

const fmt = (n: number) => n.toLocaleString();

function StageRow({ stage }: { stage: Stage }) {
  const label = STAGE_LABELS[stage.key];
  const progress =
    stage.total && stage.total > 0
      ? Math.min(100, Math.round(((stage.processed ?? 0) / stage.total) * 100))
      : null;
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        stage.state === "active" && "bg-primary/5",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
        {stage.state === "done" ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : stage.state === "active" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : stage.state === "error" ? (
          <X className="h-3.5 w-3.5 text-destructive" />
        ) : (
          <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/40" />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          stage.state === "pending" ? "text-muted-foreground/70" : "font-medium",
        )}
      >
        {label}
        {stage.detail && (
          <span className="ml-1.5 font-normal text-muted-foreground">{stage.detail}</span>
        )}
      </span>
      {progress != null && (
        <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-border sm:block" aria-hidden>
          <span
            className="block h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </span>
      )}
      {stage.processed != null && stage.total ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {fmt(stage.processed)} / {fmt(stage.total)}
        </span>
      ) : stage.ms != null && stage.state === "done" ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {stage.ms < 1000 ? `${stage.ms}ms` : `${(stage.ms / 1000).toFixed(1)}s`}
        </span>
      ) : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] border bg-card px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{fmt(value)}</div>
    </div>
  );
}

/**
 * Live processing timeline. Announces progress to screen readers via an
 * aria-live region while keeping the visual layout compact.
 */
export function ProcessingTimeline({
  stages,
  stats,
  elapsedMs,
  currentOperation,
}: {
  stages: Stage[];
  stats: ProcessingStats;
  elapsedMs: number;
  currentOperation: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="rounded-xl border bg-muted/20 p-2 shadow-sm">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Processing
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {(elapsedMs / 1000).toFixed(1)}s elapsed
          </span>
        </div>
        <ul className="space-y-px">
          {stages.map((s) => (
            <StageRow key={s.key} stage={s} />
          ))}
        </ul>
        <p className="sr-only" role="status" aria-live="polite">
          {currentOperation}
        </p>
      </div>
      <div className="space-y-2">
        <div className="rounded-xl border bg-primary/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Current operation
          </div>
          <div className="truncate text-xs font-medium">{currentOperation}</div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Rows scanned" value={stats.rowsScanned} />
          <Stat label="Extracted" value={stats.transactions} />
          <Stat label="Duplicates" value={stats.duplicatesRemoved} />
          <Stat label="Unique desc." value={stats.uniqueDescriptions} />
          <Stat label="Payees matched" value={stats.payeesMatched} />
          <Stat label="Rules matched" value={stats.rulesMatched} />
          <Stat label="Clusters" value={stats.clusters} />
          <Stat label="AI remaining" value={stats.aiRemaining} />
          <Stat label="Exceptions" value={stats.exceptions} />
        </div>
      </div>
    </div>
  );
}
