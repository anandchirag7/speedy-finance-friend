import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_BY_CATEGORY, type AccountCategory } from "@/lib/account-types";
import { upsertAccount } from "@/lib/finance.functions";

export function AccountFormDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: any;
}) {
  const isEdit = !!initial?.id;
  const [category, setCategory] = useState<AccountCategory>((initial?.category as AccountCategory) ?? "bank");
  const [name, setName] = useState(initial?.name ?? "");
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [subtype, setSubtype] = useState<string>(initial?.subtype ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "INR");
  const [openingBalance, setOpeningBalance] = useState<string>(String(initial?.opening_balance ?? 0));
  const [currentBalance, setCurrentBalance] = useState<string>(String(initial?.current_balance ?? 0));
  const [last4, setLast4] = useState(initial?.account_number_last4 ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [details, setDetails] = useState<Record<string, any>>(initial?.details ?? {});

  useEffect(() => {
    if (!open) return;
    setCategory((initial?.category as AccountCategory) ?? "bank");
    setName(initial?.name ?? "");
    setInstitution(initial?.institution ?? "");
    setSubtype(initial?.subtype ?? "");
    setCurrency(initial?.currency ?? "INR");
    setOpeningBalance(String(initial?.opening_balance ?? 0));
    setCurrentBalance(String(initial?.current_balance ?? 0));
    setLast4(initial?.account_number_last4 ?? "");
    setNotes(initial?.notes ?? "");
    setDetails(initial?.details ?? {});
  }, [open, initial]);

  const def = ACCOUNT_TYPE_BY_CATEGORY[category];
  const qc = useQueryClient();
  const save = useServerFn(upsertAccount);

  const mut = useMutation({
    mutationFn: (data: any) => save({ data }),
    onSuccess: () => {
      toast.success(isEdit ? "Account updated" : "Account added");
      qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const submit = () => {
    if (!name.trim()) return toast.error("Name required");
    mut.mutate({
      id: initial?.id,
      name: name.trim(),
      institution: institution || null,
      category,
      subtype: subtype || null,
      currency,
      opening_balance: Number(openingBalance) || 0,
      current_balance: Number(currentBalance) || 0,
      is_liability: def?.isLiability ?? false,
      excluded_from_net_worth: def?.excludedFromNetWorth ?? false,
      account_number_last4: last4 ? last4.slice(-4) : null,
      notes: notes || null,
      details,
    });
  };

  const detailField = (key: string, label: string, type: string = "text") => (
    <div>
      <Label>{label}</Label>
      <Input
        type={type}
        value={details[key] ?? ""}
        onChange={(e) => setDetails({ ...details, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit account" : "Add account"}</DialogTitle>
          <DialogDescription>{def?.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Type</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v as AccountCategory); setSubtype(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.category} value={t.category}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {def?.subtypes && (
              <div>
                <Label>Sub-type</Label>
                <Select value={subtype} onValueChange={setSubtype}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {def.subtypes.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDFC Savings" />
          </div>
          <div>
            <Label>Institution</Label>
            <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. HDFC Bank" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Opening balance</Label>
              <Input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
            </div>
            <div>
              <Label>Current balance</Label>
              <Input type="number" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["INR", "USD", "EUR", "GBP", "AED", "SGD"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Last 4 digits (optional)</Label>
              <Input maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>

          {/* Type-specific quick fields */}
          {category === "credit_card" && (
            <div className="grid grid-cols-3 gap-2">
              {detailField("credit_limit", "Credit limit", "number")}
              {detailField("statement_day", "Statement day", "number")}
              {detailField("due_day", "Due day", "number")}
            </div>
          )}
          {(category === "fixed_deposit" || category === "recurring_deposit") && (
            <div className="grid grid-cols-3 gap-2">
              {detailField("interest_rate", "Rate %", "number")}
              {detailField("maturity_date", "Maturity", "date")}
              {category === "recurring_deposit" && detailField("monthly_installment", "Monthly ₹", "number")}
            </div>
          )}
          {category === "loan" && (
            <div className="grid grid-cols-3 gap-2">
              {detailField("interest_rate", "Rate %", "number")}
              {detailField("emi_amount", "EMI ₹", "number")}
              {detailField("next_due", "Next due", "date")}
            </div>
          )}
          {category === "insurance" && (
            <div className="grid grid-cols-3 gap-2">
              {detailField("sum_assured", "Sum assured ₹", "number")}
              {detailField("premium", "Premium ₹", "number")}
              {detailField("renewal_date", "Renewal", "date")}
            </div>
          )}
          {category === "ppf" && (
            <div className="grid grid-cols-2 gap-2">
              {detailField("year_contribution", "This year ₹", "number")}
              {detailField("maturity_date", "Maturity", "date")}
            </div>
          )}
          {category === "epf" && detailField("uan", "UAN")}
          {category === "gold" && (
            <div className="grid grid-cols-2 gap-2">
              {detailField("grams", "Grams", "number")}
              {detailField("purity", "Purity (e.g. 22K)")}
            </div>
          )}
          {category === "real_estate" && (
            <div className="grid grid-cols-2 gap-2">
              {detailField("purchase_price", "Purchase ₹", "number")}
              {detailField("purchase_date", "Purchase date", "date")}
            </div>
          )}

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {def?.excludedFromNetWorth && (
            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Checkbox checked disabled />
              Insurance is tracked here but not added to your net worth.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
