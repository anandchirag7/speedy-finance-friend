import { memo, useState } from "react";
import { Merge, Redo2, Tag, Undo2, Activity, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Category } from "./types";

/**
 * Bulk-edit bar. Actions apply to the rows currently shown *and* included, so
 * users can retarget hundreds of rows without opening a single one. Every
 * change lands in local state and is only persisted on save.
 */
export const BulkEditBar = memo(function BulkEditBar({
  targetCount,
  categories,
  payees,
  onSetCategory,
  onSetPayee,
  onIncludeAll,
  onExcludeAll,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  profiling,
  onToggleProfiling,
}: {
  targetCount: number;
  categories: Category[];
  payees: string[];
  onSetCategory: (id: string | null) => void;
  onSetPayee: (name: string) => void;
  onIncludeAll: () => void;
  onExcludeAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  profiling: boolean;
  onToggleProfiling: () => void;
}) {
  const [payeeDraft, setPayeeDraft] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border bg-muted/30 px-2 py-1.5">
      <span className="text-[11px] font-medium">
        Bulk edit <span className="tabular-nums">{targetCount.toLocaleString()}</span> shown &amp; included
      </span>

      <div className="w-[168px]">
        <Select
          value=""
          onValueChange={(v) => onSetCategory(v === "none" ? null : v)}
          disabled={targetCount === 0}
        >
          <SelectTrigger className="h-7 text-xs" aria-label="Set category for selected">
            <SelectValue placeholder="Set category…" />
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
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={targetCount === 0}>
            <Merge className="mr-1 h-3 w-3" aria-hidden /> Merge payees
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2 p-2" align="start">
          <p className="text-[11px] text-muted-foreground">
            Rename every shown &amp; included row to a single payee.
          </p>
          <Input
            value={payeeDraft}
            onChange={(e) => setPayeeDraft(e.target.value)}
            placeholder="Payee name"
            className="h-7 text-xs"
            aria-label="Merged payee name"
          />
          {payees.length > 0 && (
            <div className="max-h-32 space-y-px overflow-auto rounded border p-1">
              {payees.slice(0, 60).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPayeeDraft(p)}
                  className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            className="h-7 w-full text-xs"
            disabled={!payeeDraft.trim()}
            onClick={() => {
              onSetPayee(payeeDraft.trim());
              setPayeeDraft("");
              setOpen(false);
            }}
          >
            <Tag className="mr-1 h-3 w-3" aria-hidden /> Apply to {targetCount.toLocaleString()}
          </Button>
        </PopoverContent>
      </Popover>

      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onIncludeAll}>
        <CheckSquare className="mr-1 h-3 w-3" aria-hidden /> Include shown
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onExcludeAll}>
        <Square className="mr-1 h-3 w-3" aria-hidden /> Exclude shown
      </Button>

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!canUndo}
          onClick={onUndo}
          aria-label="Undo last edit"
          title="Undo (⌘Z)"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!canRedo}
          onClick={onRedo}
          aria-label="Redo last edit"
          title="Redo (⇧⌘Z)"
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant={profiling ? "secondary" : "ghost"}
          className="h-7 w-7"
          onClick={onToggleProfiling}
          aria-label="Toggle render profiler"
          title="Render profiler"
        >
          <Activity className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
});
