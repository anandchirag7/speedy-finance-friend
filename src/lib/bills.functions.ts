import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getHouseholdId(ctx: { supabase: any; userId: string }): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.default_household_id) throw new Error("No household found");
  return data.default_household_id as string;
}

export const RECURRENCES = ["once", "weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly"] as const;
export const BILL_STATUSES = ["upcoming", "paid", "overdue", "snoozed", "skipped", "cancelled"] as const;
export const PRIORITIES = ["low", "normal", "high", "critical"] as const;

const billShape = {
  name: z.string().min(1).max(200),
  amount: z.number().nullable().optional(),
  currency: z.string().default("INR"),
  due_date: z.string(),
  recurrence: z.enum(RECURRENCES).default("monthly"),
  status: z.enum(BILL_STATUSES).default("upcoming"),
  priority: z.enum(PRIORITIES).default("normal"),
  account_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  payee_id: z.string().uuid().nullable().optional(),
  auto_pay: z.boolean().default(false),
  reminder_days: z.array(z.number().int()).default([7, 3, 1]),
  tags: z.array(z.string()).default([]),
  url: z.string().max(500).nullable().optional(),
  is_estimated: z.boolean().default(false),
  is_active: z.boolean().default(true),
  end_date: z.string().nullable().optional(),
  min_amount: z.number().nullable().optional(),
  max_amount: z.number().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
};

function advanceDate(iso: string, recurrence: string): string {
  const d = new Date(iso + "T00:00:00");
  switch (recurrence) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "half_yearly": d.setMonth(d.getMonth() + 6); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    default: return iso;
  }
  return d.toISOString().slice(0, 10);
}

export const listBills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const [{ data: bills, error }, { data: payments }] = await Promise.all([
      (context.supabase as any)
        .from("bills")
        .select("*, account:accounts(id, name, category), category:categories(id, name, kind, color, icon), payee:memorized_payees(id, merchant)")
        .eq("household_id", householdId)
        .order("due_date", { ascending: true }),
      (context.supabase as any)
        .from("bill_payments")
        .select("bill_id, amount, paid_date, status")
        .eq("household_id", householdId)
        .order("paid_date", { ascending: false }),
    ]);
    if (error) throw error;
    const stats = new Map<string, { count: number; total: number; last: string | null }>();
    for (const p of payments ?? []) {
      if ((p as any).status !== "paid") continue;
      const k = (p as any).bill_id as string;
      const cur = stats.get(k) ?? { count: 0, total: 0, last: null };
      cur.count += 1;
      cur.total += Number((p as any).amount ?? 0);
      const d = (p as any).paid_date as string | null;
      if (d && (!cur.last || d > cur.last)) cur.last = d;
      stats.set(k, cur);
    }
    const today = new Date().toISOString().slice(0, 10);
    return (bills ?? []).map((b: any) => {
      const s = stats.get(b.id);
      const status = b.status === "paid" || b.status === "snoozed" || b.status === "skipped" || b.status === "cancelled"
        ? b.status
        : (b.due_date < today ? "overdue" : "upcoming");
      return {
        ...b,
        computed_status: status,
        paid_count: s?.count ?? 0,
        paid_total: s?.total ?? 0,
        last_paid_at: s?.last ?? b.last_paid_on ?? null,
      };
    });
  });

export const listBillPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ bill_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    let q = (context.supabase as any)
      .from("bill_payments")
      .select("*, bill:bills(id, name, currency), transaction:transactions(id, txn_date, amount, note)")
      .eq("household_id", householdId)
      .order("due_date", { ascending: false });
    if (data.bill_id) q = q.eq("bill_id", data.bill_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const upsertBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid().optional(), ...billShape }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const payload: any = { ...data, household_id: householdId };
    if (data.id) {
      const { id, ...upd } = payload;
      const { data: row, error } = await (context.supabase as any).from("bills").update(upd).eq("id", id).eq("household_id", householdId).select("*").maybeSingle();
      if (error) throw error;
      return row;
    }
    const { data: row, error } = await (context.supabase as any).from("bills").insert(payload).select("*").maybeSingle();
    if (error) throw error;
    return row;
  });

export const deleteBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { error } = await (context.supabase as any).from("bills").delete().eq("id", data.id).eq("household_id", householdId);
    if (error) throw error;
    return { ok: true };
  });

export const markBillPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    bill_id: z.string().uuid(),
    paid_date: z.string(),
    amount: z.number(),
    account_id: z.string().uuid().nullable().optional(),
    create_transaction: z.boolean().default(true),
    notes: z.string().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: bill, error: bErr } = await (context.supabase as any)
      .from("bills")
      .select("*")
      .eq("id", data.bill_id)
      .eq("household_id", householdId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!bill) throw new Error("Bill not found");

    let txnId: string | null = null;
    if (data.create_transaction && (data.account_id ?? bill.account_id)) {
      const { data: txn, error: tErr } = await (context.supabase as any)
        .from("transactions")
        .insert({
          household_id: householdId,
          account_id: data.account_id ?? bill.account_id,
          category_id: bill.category_id,
          type: "expense",
          amount: data.amount,
          txn_date: data.paid_date,
          merchant: bill.name,
          note: `Bill: ${bill.name}`,
          created_by: context.userId,
        })
        .select("id")
        .maybeSingle();
      if (tErr) throw tErr;
      txnId = txn?.id ?? null;
    }

    await (context.supabase as any).from("bill_payments").insert({
      household_id: householdId,
      bill_id: bill.id,
      due_date: bill.due_date,
      paid_date: data.paid_date,
      amount: data.amount,
      status: "paid",
      transaction_id: txnId,
      account_id: data.account_id ?? bill.account_id,
      notes: data.notes ?? null,
      created_by: context.userId,
    });

    const next = bill.recurrence === "once" ? bill.due_date : advanceDate(bill.due_date, bill.recurrence);
    const nextStatus = bill.recurrence === "once" ? "paid" : "upcoming";
    const end = bill.end_date as string | null;
    const finalStatus = end && next > end ? "cancelled" : nextStatus;
    await (context.supabase as any)
      .from("bills")
      .update({ due_date: next, status: finalStatus, last_paid_on: data.paid_date })
      .eq("id", bill.id);

    return { ok: true, transaction_id: txnId };
  });

export const skipBillOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ bill_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: bill, error } = await (context.supabase as any).from("bills").select("*").eq("id", data.bill_id).eq("household_id", householdId).maybeSingle();
    if (error) throw error;
    if (!bill) throw new Error("Bill not found");
    await (context.supabase as any).from("bill_payments").insert({
      household_id: householdId, bill_id: bill.id, due_date: bill.due_date, status: "skipped", created_by: context.userId,
    });
    const next = bill.recurrence === "once" ? bill.due_date : advanceDate(bill.due_date, bill.recurrence);
    await (context.supabase as any).from("bills").update({ due_date: next, status: "upcoming" }).eq("id", bill.id);
    return { ok: true };
  });

export const snoozeBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ bill_id: z.string().uuid(), new_due_date: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    await (context.supabase as any).from("bills")
      .update({ due_date: data.new_due_date, status: "snoozed" })
      .eq("id", data.bill_id).eq("household_id", householdId);
    return { ok: true };
  });
