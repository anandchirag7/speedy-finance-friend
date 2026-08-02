import { memo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SkeletonRow, TransactionRow, type RowCallbacks } from "./transaction-row";
import { ROW_HEIGHT, type Category, type ReviewRow } from "./types";

/**
 * Virtualized transaction body — the only scroll container in the modal.
 * Fixed row height + 10 overscan rows keeps 10k+ rows smooth, and rows past
 * `loadedCount` render as skeletons while the next page is materialized.
 */
export const VirtualizedTransactionList = memo(function VirtualizedTransactionList({
  ids,
  byId,
  selectedIds,
  categories,
  payees,
  callbacks,
  loadedCount,
  onLoadMore,
}: {
  ids: string[];
  byId: Record<string, ReviewRow>;
  selectedIds: Set<string>;
  categories: Category[];
  payees: string[];
  callbacks: RowCallbacks;
  loadedCount: number;
  onLoadMore: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const items = virtualizer.getVirtualItems();
  const last = items.length ? items[items.length - 1]!.index : 0;

  useEffect(() => {
    if (last >= loadedCount - 40 && loadedCount < ids.length) onLoadMore();
  }, [last, loadedCount, ids.length, onLoadMore]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((v) => {
          const id = ids[v.index]!;
          const row = v.index < loadedCount ? byId[id] : undefined;
          return (
            <div
              key={id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_HEIGHT,
                transform: `translateY(${v.start}px)`,
              }}
            >
              {row ? (
                <TransactionRow
                  row={row}
                  selected={selectedIds.has(id)}
                  categories={categories}
                  payees={payees}
                  callbacks={callbacks}
                />
              ) : (
                <SkeletonRow />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
