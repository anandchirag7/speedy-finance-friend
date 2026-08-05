import { useCallback, useRef, useState } from "react";
import type { ReviewRow } from "./types";

export type ReviewSnapshot = {
  byId: Record<string, ReviewRow>;
  selectedIds: Set<string>;
  label: string;
};

const LIMIT = 60;

/**
 * Undo/redo stack for inline review edits. Snapshots are shallow copies of the
 * normalized store, so pushing one is O(rows) on the map reference only — cheap
 * enough for 10k rows and bounded to the last `LIMIT` actions.
 */
export function useEditHistory(
  apply: (snap: ReviewSnapshot) => void,
) {
  const past = useRef<ReviewSnapshot[]>([]);
  const future = useRef<ReviewSnapshot[]>([]);
  const [state, setState] = useState({ canUndo: false, canRedo: false, lastLabel: "" });

  const sync = useCallback(() => {
    setState({
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      lastLabel: past.current[past.current.length - 1]?.label ?? "",
    });
  }, []);

  /** Record the state *before* an edit is applied. */
  const record = useCallback(
    (snap: ReviewSnapshot) => {
      past.current.push(snap);
      if (past.current.length > LIMIT) past.current.shift();
      future.current = [];
      sync();
    },
    [sync],
  );

  const undo = useCallback(
    (current: ReviewSnapshot) => {
      const prev = past.current.pop();
      if (!prev) return;
      future.current.push({ ...current, label: prev.label });
      apply(prev);
      sync();
    },
    [apply, sync],
  );

  const redo = useCallback(
    (current: ReviewSnapshot) => {
      const next = future.current.pop();
      if (!next) return;
      past.current.push({ ...current, label: next.label });
      apply(next);
      sync();
    },
    [apply, sync],
  );

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  return { record, undo, redo, reset, ...state };
}
