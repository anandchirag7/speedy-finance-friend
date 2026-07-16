import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listAccounts, listCategories, upsertTransaction } from "@/lib/finance.functions";

export function FastEntryDialog({ open: openProp, onOpenChange, hideTrigger }: { open?: boolean; onOpenChange?: (o: boolean) => void; hideTrigger?: boolean } = {}) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (o: boolean) => { onOpenChange?.(o); if (openProp === undefined) setOpenInternal(o); };
  const [type, setType] = useState<"expense" | "income" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const qc = useQueryClient();
  const listAcc = useServerFn(listAccounts);
  const listCat = useServerFn(listCategories);
  const saveTxn = useServerFn(upsertTransaction);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: listAcc, enabled: open });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: listCat, enabled: open });

  const relevantCategories = (categories as any[]).filter(
    (c) => c.parent_id !== null && (type === "income" ? c.kind === "income" : c.kind === "expense"),
  );

  const mut = useMutation({
    mutationFn: (data: any) => saveTxn({ data }),
    onSuccess: () => {
      toast.success("Transaction saved");
      qc.invalidateQueries();
      setOpen(false);
      setAmount("");
      setNote("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const canSubmit =
    !!amount &&
    Number(amount) > 0 &&
    !!accountId &&
    (type !== "transfer" || (!!transferAccountId && transferAccountId !== accountId));

  const submit = () => {
    if (!canSubmit) return;
    mut.mutate({
      account_id: accountId,
      transfer_account_id: type === "transfer" ? transferAccountId : null,
      category_id: type === "transfer" ? null : categoryId || null,
      type,
      amount: Number(amount),
      txn_date: date,
      note: note || null,
      tags: [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            size="lg"
            className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg md:h-12 md:w-auto md:px-5 md:rounded-full"
          >
            <Plus className="h-5 w-5" />
            <span className="hidden md:inline ml-1">Add</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick entry</DialogTitle>
          <DialogDescription>Log an expense, income, or transfer in seconds.</DialogDescription>
        </DialogHeader>

        <Tabs value={type} onValueChange={(v) => setType(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="expense">Expense</TabsTrigger>
            <TabsTrigger value="income">Income</TabsTrigger>
            <TabsTrigger value="transfer">Transfer</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-3">
          <div>
            <Label htmlFor="amount">Amount (₹)</Label>
            <Input
              id="amount"
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg tabular-nums"
              autoFocus
            />
          </div>

          <div>
            <Label>{type === "transfer" ? "From account" : "Account"}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {(accounts as any[]).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === "transfer" ? (
            <div>
              <Label>To account</Label>
              <Select value={transferAccountId} onValueChange={setTransferAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {(accounts as any[]).filter((a) => a.id !== accountId).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {relevantCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="note">Note</Label>
              <Input id="note" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || mut.isPending}>
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
