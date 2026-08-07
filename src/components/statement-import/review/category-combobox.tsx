import { memo, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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
import type { Category } from "./types";

const MAX_OPTIONS = 60;

/**
 * Shared searchable category picker. The option list is only mounted while the
 * popover is open, and rendered in a portal outside the virtualized row so it
 * never inflates row render cost.
 */
export const CategoryCombobox = memo(function CategoryCombobox({
  value,
  categories,
  onChange,
}: {
  value: string | null;
  categories: Category[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const label = value ? categoryMap.get(value) ?? "Uncategorized" : "Uncategorized";

  const options = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const list = q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;
    return list.slice(0, MAX_OPTIONS);
  }, [open, query, categories]);

  const triggerBtn = (
    <button
      type="button"
      aria-label="Category"
      onClick={() => !open && setOpen(true)}
      className={cn(
        "flex h-7 w-full items-center justify-between gap-1 rounded-md border bg-background px-2 text-left text-xs transition-colors hover:bg-accent/50",
        !value && "text-muted-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
    </button>
  );

  if (!open) return triggerBtn;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {triggerBtn}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search categories"
            className="h-8 text-xs"
            autoFocus
          />
          <CommandList className="max-h-56">
              <CommandEmpty className="py-3 text-center text-xs">No category</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__none"
                  className="text-xs"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-1.5 h-3 w-3", value ? "opacity-0" : "opacity-100")} />
                  Uncategorized
                </CommandItem>
                {options.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    className="text-xs"
                    onSelect={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("mr-1.5 h-3 w-3", value === c.id ? "opacity-100" : "opacity-0")}
                    />
                    {c.parent_id ? `— ${c.name}` : c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
  );
});
