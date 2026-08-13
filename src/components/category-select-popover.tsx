import { useMemo, useState } from "react";
import { Check, ChevronRight, Plus, Search, FolderTree } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upsertCategory } from "@/lib/categories.functions";
import { cn } from "@/lib/utils";

export type CategoryItem = {
  id: string;
  name: string;
  kind?: string;
  parent_id?: string | null;
  color?: string | null;
  icon?: string | null;
};

/**
 * Builds full hierarchical display label for a category.
 * E.g., "Food & Dining > Restaurants > Fast Food"
 */
export function getCategoryHierarchyLabel(
  catId: string | null | undefined,
  categories: CategoryItem[] | Map<string, CategoryItem>
): string {
  if (!catId) return "Uncategorized";
  const catMap = categories instanceof Map ? categories : new Map(categories.map((c) => [c.id, c]));
  const parts: string[] = [];
  let curr = catMap.get(catId);
  const visited = new Set<string>();

  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    parts.unshift(curr.name);
    curr = curr.parent_id ? catMap.get(curr.parent_id) : undefined;
  }

  return parts.length > 0 ? parts.join(" > ") : "Uncategorized";
}

export function CategorySelectPopover({
  categories,
  value,
  onChange,
  onCategoryCreated,
  className,
  placeholder,
}: {
  categories: CategoryItem[];
  value: string | null;
  onChange: (v: string | null) => void;
  onCategoryCreated?: (newCategory: CategoryItem) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatKind, setNewCatKind] = useState<"expense" | "income" | "transfer" | "investment">("expense");
  const [newCatParentId, setNewCatParentId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertCategory);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Compute full path string for every category for search & display
  const itemsWithPath = useMemo(() => {
    return categories.map((c) => {
      const fullPath = getCategoryHierarchyLabel(c.id, categoryMap);
      return { ...c, fullPath };
    });
  }, [categories, categoryMap]);

  // Filtered items based on search query
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return itemsWithPath;
    return itemsWithPath.filter(
      (item) => item.name.toLowerCase().includes(q) || item.fullPath.toLowerCase().includes(q)
    );
  }, [itemsWithPath, search]);

  const selectedLabel = useMemo(() => getCategoryHierarchyLabel(value, categories), [value, categories]);

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setIsCreating(true);
    try {
      const created = await upsertFn({
        data: {
          name: newCatName.trim(),
          kind: newCatKind,
          parent_id: newCatParentId,
        },
      });
      toast.success(`Category "${created.name}" created!`);
      const newObj: CategoryItem = {
        id: created.id,
        name: created.name,
        kind: created.kind,
        parent_id: created.parent_id,
      };
      qc.invalidateQueries({ queryKey: ["categories"] });
      if (onCategoryCreated) onCategoryCreated(newObj);
      onChange(created.id);
      setAddDialogOpen(false);
      setNewCatName("");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create category");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("h-7 w-full justify-between px-2 text-xs font-normal text-left truncate", className)}
          >
            <span className="truncate">{value ? selectedLabel : (placeholder ?? selectedLabel)}</span>
            <ChevronRight className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50 rotate-90" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="flex items-center border-b px-2 py-1.5">
            <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Search category or parent..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0"
            />
          </div>

          <div className="max-h-[220px] overflow-y-auto p-1 text-xs">
            {/* Uncategorized Option */}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-muted/70 transition-colors",
                value === null && "bg-primary/10 font-medium text-primary"
              )}
            >
              <span>Uncategorized</span>
              {value === null && <Check className="h-3.5 w-3.5" />}
            </button>

            {filteredItems.length === 0 ? (
              <div className="py-4 text-center text-muted-foreground text-xs">No matching categories found.</div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = value === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onChange(item.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-muted/70 transition-colors my-0.5",
                      isSelected && "bg-primary/10 font-medium text-primary"
                    )}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="font-medium truncate">{item.name}</span>
                      {item.parent_id && (
                        <span className="text-[10px] text-muted-foreground truncate">{item.fullPath}</span>
                      )}
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Add Category Trigger */}
          <div className="border-t p-1.5 bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start h-7 text-xs text-primary font-medium px-2"
              onClick={() => {
                setOpen(false);
                setAddDialogOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add New Category
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Quick Add Category Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FolderTree className="h-4 w-4 text-primary" />
              Add New Category
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs">Category Name</Label>
              <Input
                placeholder="e.g., Dining Out, Subscriptions..."
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Category Type</Label>
              <Select
                value={newCatKind}
                onValueChange={(v) => setNewCatKind(v as "expense" | "income" | "transfer" | "investment")}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Parent Category (Optional)</Label>
              <Select
                value={newCatParentId ?? "none"}
                onValueChange={(v) => setNewCatParentId(v === "none" ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="None (Top Level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Top Level)</SelectItem>
                  {itemsWithPath.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.fullPath}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAddDialogOpen(false)} disabled={isCreating}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateCategory} disabled={!newCatName.trim() || isCreating}>
              {isCreating ? "Creating..." : "Save Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
