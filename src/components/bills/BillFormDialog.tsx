import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { upsertBill, deleteBill, RECURRENCES, PRIORITIES } from "@/lib/bills.functions";
import { listAccounts, listCategories } from "@/lib/finance.functions";
import { listMemorizedPayees } from "@/lib/memorized-payees.functions";

type Bill = any;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill?: Bill | null;
}

const DEFAULT: any = {
  name: "",
  amount: null,
  currency: "INR",
  due_date: new Date().toISOString().slice(0, 10),
  recurrence: "monthly",
  status: "upcoming",
  priority: "normal",
  account_id: null,
  category_id: null,
  payee_id: null,
  auto_pay: false,
  reminder_days: [7, 3, 1],
  tags: [],
  url: "",
  is_estimated: false,
  is_active: true,
  end_date: null,
  min_amount: null,
  max_amount: null,
  notes: "",
  whatsapp_enabled: true,
  whatsapp_number: "",
};

export function BillFormDialog({ open, onOpenChange, bill }: Props) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertBill);
  const del = useServerFn(deleteBill);
  const listAcc = useServerFn(listAccounts);
  const listCat = useServerFn(listCategories);
  const listPay = useServerFn(listMemorizedPayees);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => listAcc() });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => listCat() });
  const payees = useQuery({ queryKey: ["payees"], queryFn: () => listPay() });

  const [f, setF] = useState<any>(DEFAULT);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (open) {
      setF(bill ? { ...DEFAULT, ...bill, amount: bill.amount != null ? Number(bill.amount) : null } : DEFAULT);
      setTagInput("");
    }
  }, [open, bill]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        ...f,
        amount: f.amount != null && f.amount !== "" ? Number(f.amount) : null,
        min_amount: f.min_amount != null && f.min_amount !== "" ? Number(f.min_amount) : null,
        max_amount: f.max_amount != null && f.max_amount !== "" ? Number(f.max_amount) : null,
        end_date: f.end_date || null,
        url: f.url || null,
        notes: f.notes || null,
        account_id: f.account_id || null,
        category_id: f.category_id || null,
        payee_id: f.payee_id || null,
        whatsapp_number: f.whatsapp_number?.trim() ? f.whatsapp_number.trim() : null,
      };
      if (bill?.id) payload.id = bill.id;
      return upsert({ data: payload });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bills"] });
      toast.success(bill ? "Bill updated" : "Bill created");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save bill"),
  });

  const remove = useMutation({
    mutationFn: async () => del({ data: { id: bill!.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bills"] });
      toast.success("Bill deleted");
      onOpenChange(false);
    },
  });

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (!f.tags.includes(t)) setF({ ...f, tags: [...f.tags, t] });
    setTagInput("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit bill" : "New bill"}</DialogTitle>
          <DialogDescription>Track a recurring bill, EMI, subscription, or one-off reminder.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 space-y-1.5">
            <Label>Bill name *</Label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Electricity, Netflix, Home loan EMI…" />
          </div>

          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input type="number" step="0.01" value={f.amount ?? ""} onChange={(e) => setF({ ...f, amount: e.target.value === "" ? null : parseFloat(e.target.value) })} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} />
          </div>

          <div className="space-y-1.5">
            <Label>Due date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("justify-start font-normal", !f.due_date && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {f.due_date ? format(new Date(f.due_date), "PPP") : "Pick"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={f.due_date ? new Date(f.due_date) : undefined}
                  onSelect={(d) => d && setF({ ...f, due_date: d.toISOString().slice(0, 10) })}
                  className="pointer-events-auto p-3" initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>Recurrence</Label>
            <Select value={f.recurrence} onValueChange={(v) => setF({ ...f, recurrence: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECURRENCES.map((r) => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Pay from account</Label>
            <Select value={f.account_id ?? "none"} onValueChange={(v) => setF({ ...f, account_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {(accounts.data as any[] ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={f.category_id ?? "none"} onValueChange={(v) => setF({ ...f, category_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {(categories.data as any[] ?? []).filter((c: any) => c.kind === "expense").map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label>Payee</Label>
            <Select value={f.payee_id ?? "none"} onValueChange={(v) => setF({ ...f, payee_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {(payees.data as any[] ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.merchant}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Expected range — min</Label>
            <Input type="number" step="0.01" value={f.min_amount ?? ""} onChange={(e) => setF({ ...f, min_amount: e.target.value === "" ? null : parseFloat(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Expected range — max</Label>
            <Input type="number" step="0.01" value={f.max_amount ?? ""} onChange={(e) => setF({ ...f, max_amount: e.target.value === "" ? null : parseFloat(e.target.value) })} />
          </div>

          <div className="space-y-1.5">
            <Label>End date (optional)</Label>
            <Input type="date" value={f.end_date ?? ""} onChange={(e) => setF({ ...f, end_date: e.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment link / URL</Label>
            <Input value={f.url ?? ""} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label>Reminders (days before)</Label>
            <div className="flex flex-wrap gap-2">
              {[14, 7, 3, 1, 0].map((d) => {
                const on = f.reminder_days.includes(d);
                return (
                  <button key={d} type="button"
                    onClick={() => setF({ ...f, reminder_days: on ? f.reminder_days.filter((x: number) => x !== d) : [...f.reminder_days, d].sort((a, b) => b - a) })}
                    className={cn("px-3 py-1 rounded-full text-xs border transition", on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
                    {d === 0 ? "On due day" : `${d}d before`}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {f.tags.map((t: string) => (
                <Badge key={t} variant="secondary" className="gap-1">{t}
                  <button onClick={() => setF({ ...f, tags: f.tags.filter((x: string) => x !== t) })}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
            <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="Type a tag and press Enter" />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><div className="text-sm font-medium">Auto-pay</div><div className="text-xs text-muted-foreground">Bank drafts this automatically</div></div>
            <Switch checked={f.auto_pay} onCheckedChange={(v) => setF({ ...f, auto_pay: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div><div className="text-sm font-medium">Estimated amount</div><div className="text-xs text-muted-foreground">Varies each cycle</div></div>
            <Switch checked={f.is_estimated} onCheckedChange={(v) => setF({ ...f, is_estimated: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
            <div><div className="text-sm font-medium">Active</div><div className="text-xs text-muted-foreground">Include on the calendar and reminders</div></div>
            <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label>Notes</Label>
            <Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {bill?.id && (
              <Button variant="ghost" className="text-destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()}>
              {save.isPending ? "Saving…" : "Save bill"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
