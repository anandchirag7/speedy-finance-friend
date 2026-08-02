import { Sparkles, ShieldCheck, Link2, Wand2, AlertTriangle, EyeOff, Users, Layers } from "lucide-react";
import type { MatchSource, ClusterStatus } from "@/lib/statement-clusters";
import { cn } from "@/lib/utils";

const SOURCE_META: Record<
  MatchSource,
  { label: string; className: string; Icon: typeof Sparkles; hint: string }
> = {
  alias: {
    label: "Alias",
    className: "bg-success/12 text-success border-success/30",
    Icon: ShieldCheck,
    hint: "Exact match on a saved alias",
  },
  payee: {
    label: "Payee",
    className: "bg-info/12 text-info border-info/30",
    Icon: Users,
    hint: "Matched an existing memorized payee",
  },
  rule: {
    label: "Rule",
    className: "bg-success/12 text-success border-success/30",
    Icon: Link2,
    hint: "Matched one of your payee rules",
  },
  dictionary: {
    label: "Known",
    className: "bg-success/12 text-success border-success/30",
    Icon: ShieldCheck,
    hint: "Matched the shared merchant dictionary",
  },
  cluster: {
    label: "Grouped",
    className: "bg-muted text-muted-foreground border-border",
    Icon: Layers,
    hint: "Grouped deterministically by merchant tokens",
  },
  ai: {
    label: "AI",
    className: "bg-ai/12 text-ai border-ai/30",
    Icon: Sparkles,
    hint: "Name suggested by AI — confirm or rename",
  },
  manual: {
    label: "Manual",
    className: "bg-info/12 text-info border-info/30",
    Icon: Wand2,
    hint: "You set this",
  },
  pending: {
    label: "Naming…",
    className: "bg-warning/15 text-warning-foreground border-warning/40",
    Icon: AlertTriangle,
    hint: "Waiting on background naming",
  },
};

export function MatchSourceBadge({
  source,
  className,
}: {
  source: MatchSource;
  className?: string;
}) {
  const meta = SOURCE_META[source];
  const { Icon } = meta;
  return (
    <span
      title={meta.hint}
      aria-label={`Match source: ${meta.label}. ${meta.hint}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
        meta.className,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden />
      {meta.label}
    </span>
  );
}

const STATUS_META: Record<ClusterStatus, { label: string; className: string }> = {
  auto: { label: "Auto matched", className: "bg-success/12 text-success border-success/30" },
  suggested: { label: "AI suggested", className: "bg-ai/12 text-ai border-ai/30" },
  review: { label: "Needs review", className: "bg-warning/15 text-warning-foreground border-warning/40" },
  approved: { label: "Approved", className: "bg-info/12 text-info border-info/30" },
  ignored: { label: "Ignored", className: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({ status }: { status: ClusterStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
        meta.className,
      )}
    >
      {status === "ignored" && <EyeOff className="h-2.5 w-2.5" aria-hidden />}
      {meta.label}
    </span>
  );
}

/** Compact 4-segment confidence meter with an accessible label. */
export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const filled = Math.max(1, Math.round(value * 4));
  const tone = pct >= 85 ? "bg-success" : pct >= 65 ? "bg-ai" : "bg-warning";
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`Confidence ${pct}%`}
      aria-label={`Confidence ${pct} percent`}
    >
      <span className="flex gap-px" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn("h-2.5 w-1 rounded-sm", i < filled ? tone : "bg-border")}
          />
        ))}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
    </span>
  );
}
