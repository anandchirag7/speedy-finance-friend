import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { markBillPaid } from "@/lib/bills.functions";
import { listAccounts } from "@/lib/finance.functions";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; bill: any; }

export function MarkPaidDialog({ open, onOpenChange, bill }: Props) {
  const qc = useQueryClient();
  const listAcc = useServerFn(listAccounts);
  const mark = useServerFn(markBillPaid);
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => listAcc() });

  const [amount, setAmount] = useState<string>("");
  const [paidDate, setPaidDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [createTxn, setCreateTxn] = useState(true);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && bill) {
      setAmount(String(bill.amount ?? ""));
      setPaidDate(new Date().toISOString().slice(0, 10));
      setAccountId(bill.account_id ?? null);
      setCreateTxn(true);
      setNotes("");
    }
  }, [open, bill]);

  const save = useMutation({
    mutationFn: async () => mark({ data: {
      bill_id: bill.id, paid_date: paidDate, amount: parseFloat(amount || "0"),
      account_id: accountId, create_transaction: createTxn, notes: notes || null,
    } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["bill-payments"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Marked as paid");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (!bill) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {bill.name} paid</DialogTitle>
          <DialogDescription>Records a payment and advances the next due date.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2">
            <Label>Amount paid</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Paid date</Label>
            <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>From account</Label>
            <Select value={accountId ?? "none"} onValueChange={(v) => setAccountId(v === "none" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {(accounts.data as any[] ?? []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between col-span-2 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Create transaction</div>
              <div className="text-xs text-muted-foreground">Post an expense in your register</div>
            </div>
            <Switch checked={createTxn} onCheckedChange={setCreateTxn} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !amount}>Confirm payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
