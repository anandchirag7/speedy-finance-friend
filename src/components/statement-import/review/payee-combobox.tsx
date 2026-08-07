import { memo, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

const PAGE = 40;

/**
 * Shared searchable payee combobox. Options are lazily sliced (40 at a time)
 * and only mounted while open, so 10k rows never render option lists.
 */
export const PayeeCombobox = memo(function PayeeCombobox({
  value,
  payees,
  onChange,
}: {
  value: string;
  payees: string[];
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const matches = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const list = q ? payees.filter((p) => p.toLowerCase().includes(q)) : payees;
    return list.slice(0, limit);
  }, [open, query, payees, limit]);

  const typed = query.trim();

  const triggerBtn = (
    <button
      type="button"
      aria-label="Payee"
      onClick={() => {
        if (!open) {
          setOpen(true);
          setQuery("");
          setLimit(PAGE);
        }
      }}
      className={cn(
        "flex h-7 w-full items-center justify-between gap-1 rounded-md border bg-background px-2 text-left text-xs transition-colors hover:bg-accent/50",
        !value && "text-muted-foreground",
      )}
    >
      <span className="truncate">{value || "Set payee"}</span>
      <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
    </button>
  );

  if (!open) return triggerBtn;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setQuery("");
          setLimit(PAGE);
        }
      }}
    >
      <PopoverTrigger asChild>
        {triggerBtn}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setLimit(PAGE);
            }}
            placeholder="Search or type a payee"
            className="h-8 text-xs"
            autoFocus
          />
          <CommandList
              className="max-h-56"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
                  setLimit((n) => n + PAGE);
                }
              }}
            >
              <CommandGroup>
                {typed && !payees.includes(typed) && (
                  <CommandItem
                    value={`__new_${typed}`}
                    className="text-xs"
                    onSelect={() => {
                      onChange(typed);
                      setOpen(false);
                    }}
                  >
                    <Plus className="mr-1.5 h-3 w-3" aria-hidden />
                    Use “{typed}”
                  </CommandItem>
                )}
                {matches.map((p) => (
                  <CommandItem
                    key={p}
                    value={p}
                    className="text-xs"
                    onSelect={() => {
                      onChange(p);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-1.5 h-3 w-3", value === p ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{p}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
  );
});
