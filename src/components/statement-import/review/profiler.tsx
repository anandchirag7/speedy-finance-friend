import { memo, useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lightweight render instrumentation for the virtualized review grid.
 * Counters are module-level so incrementing them from a row render costs a
 * single addition and never triggers React state updates.
 */
const stats = {
  rowRenders: 0,
  commits: 0,
  lastDuration: 0,
  maxDuration: 0,
};

let enabled = false;

export const profilingEnabled = () => enabled;
export const setProfiling = (v: boolean) => {
  enabled = v;
  if (!v) resetProfiling();
};

export function countRowRender() {
  if (enabled) stats.rowRenders++;
}

export function recordCommit(duration: number) {
  if (!enabled) return;
  stats.commits++;
  stats.lastDuration = duration;
  if (duration > stats.maxDuration) stats.maxDuration = duration;
}

export function resetProfiling() {
  stats.rowRenders = 0;
  stats.commits = 0;
  stats.lastDuration = 0;
  stats.maxDuration = 0;
}

/** Floating overlay that samples the counters instead of rerendering with them. */
export const ProfilerOverlay = memo(function ProfilerOverlay({
  rowsRendered,
  onClose,
}: {
  rowsRendered: number;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState({ ...stats });

  useEffect(() => {
    const t = setInterval(() => setSnap({ ...stats }), 400);
    return () => clearInterval(t);
  }, []);

  const rows: Array<[string, string, string?]> = [
    ["Row renders", snap.rowRenders.toLocaleString()],
    ["Mounted rows", rowsRendered.toLocaleString()],
    ["Commits", snap.commits.toLocaleString()],
    [
      "Last commit",
      `${snap.lastDuration.toFixed(1)} ms`,
      snap.lastDuration > 16 ? "text-destructive" : "text-success",
    ],
    [
      "Worst commit",
      `${snap.maxDuration.toFixed(1)} ms`,
      snap.maxDuration > 32 ? "text-destructive" : "text-muted-foreground",
    ],
  ];

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-50 w-48 rounded-[10px] border bg-background/95 p-2 shadow-lg backdrop-blur">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Activity className="h-3 w-3" aria-hidden /> Render profiler
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-0.5 hover:bg-muted"
          aria-label="Close profiler"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>
      <dl className="space-y-0.5">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="flex justify-between gap-2 text-[11px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("font-medium tabular-nums", tone)}>{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => {
          resetProfiling();
          setSnap({ ...stats });
        }}
        className="mt-1 w-full rounded border px-1 py-0.5 text-[10px] hover:bg-muted"
      >
        Reset counters
      </button>
    </div>
  );
});
