import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- helpers ----------
async function getHouseholdId(ctx: { supabase: any; userId: string }): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.default_household_id) throw new Error("No household found for user");
  return data.default_household_id as string;
}

// ---------- profile / bootstrap ----------
export const getMyContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    return { userId: context.userId, profile };
  });

// ---------- accounts ----------
export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const { data, error } = await context.supabase
      .from("accounts")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

const accountSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  institution: z.string().max(120).optional().nullable(),
  category: z.enum([
    "bank","cash","credit_card","fixed_deposit","recurring_deposit","ppf","epf","nps",
    "mutual_fund","stocks","post_office","gold","real_estate","loan","insurance","chit_fund","other",
  ]),
  subtype: z.string().optional().nullable(),
  currency: z.string().default("INR"),
  opening_balance: z.number(),
  current_balance: z.number(),
  is_liability: z.boolean().default(false),
  excluded_from_net_worth: z.boolean().default(false),
  account_number_last4: z.string().max(4).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  details: z.record(z.string(), z.any()).default({}),
});

export const upsertAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => accountSchema.parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const row = { ...data, household_id: householdId };
    const { data: saved, error } = await context.supabase
      .from("accounts")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    return saved;
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { error } = await context.supabase
      .from("accounts")
      .delete()
      .eq("id", data.id)
      .eq("household_id", householdId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- categories ----------
export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const { data, error } = await context.supabase
      .from("categories")
      .select("*")
      .eq("household_id", householdId)
      .order("kind", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

// ---------- transactions ----------
const txnSchema = z.object({
  id: z.string().uuid().optional(),
  account_id: z.string().uuid(),
  transfer_account_id: z.string().uuid().optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  type: z.enum(["income", "expense", "transfer"]),
  amount: z.number().positive(),
  txn_date: z.string(),
  note: z.string().max(500).optional().nullable(),
  tags: z.array(z.string()).default([]),
});

export const upsertTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => txnSchema.parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const row = { ...data, household_id: householdId, created_by: context.userId };
    const { data: saved, error } = await context.supabase
      .from("transactions")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;

    // Update account balances
    await recomputeAccountBalance(context.supabase, householdId, data.account_id);
    if (data.transfer_account_id) {
      await recomputeAccountBalance(context.supabase, householdId, data.transfer_account_id);
    }
    return saved;
  });

async function recomputeAccountBalance(supabase: any, householdId: string, accountId: string) {
  const { data: acc } = await supabase
    .from("accounts")
    .select("opening_balance, is_liability")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!acc) return;

  const { data: txns } = await supabase
    .from("transactions")
    .select("type, amount, account_id, transfer_account_id")
    .eq("household_id", householdId)
    .or(`account_id.eq.${accountId},transfer_account_id.eq.${accountId}`);

  let balance = Number(acc.opening_balance ?? 0);
  for (const t of txns ?? []) {
    const amt = Number(t.amount);
    if (t.type === "income" && t.account_id === accountId) balance += amt;
    else if (t.type === "expense" && t.account_id === accountId) balance -= amt;
    else if (t.type === "transfer") {
      if (t.account_id === accountId) balance -= amt;
      if (t.transfer_account_id === accountId) balance += amt;
    }
  }
  await supabase.from("accounts").update({ current_balance: balance }).eq("id", accountId);
}

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    // fetch first to know which accounts to recompute
    const { data: txn } = await context.supabase
      .from("transactions")
      .select("account_id, transfer_account_id")
      .eq("id", data.id)
      .eq("household_id", householdId)
      .maybeSingle();
    const { error } = await context.supabase
      .from("transactions")
      .delete()
      .eq("id", data.id)
      .eq("household_id", householdId);
    if (error) throw error;
    if (txn?.account_id) await recomputeAccountBalance(context.supabase, householdId, txn.account_id);
    if (txn?.transfer_account_id) await recomputeAccountBalance(context.supabase, householdId, txn.transfer_account_id);
    return { ok: true };
  });

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        limit: z.number().max(500).default(100),
        accountId: z.string().uuid().optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    let q = context.supabase
      .from("transactions")
      .select("*, category:categories(name, kind), account:accounts!transactions_account_id_fkey(name, currency)")
      .eq("household_id", householdId)
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.accountId) q = q.eq("account_id", data.accountId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

// ---------- dashboard ----------
const rangeSchema = z
  .object({ range: z.enum(["1m", "3m", "6m", "1y", "ytd"]).default("1m") })
  .default({ range: "1m" });

function computeRange(range: "1m" | "3m" | "6m" | "1y" | "ytd") {
  const now = new Date();
  const start = new Date(now);
  let months = 1;
  if (range === "1m") {
    start.setDate(1);
    months = 1;
  } else if (range === "3m") {
    start.setMonth(now.getMonth() - 2);
    start.setDate(1);
    months = 3;
  } else if (range === "6m") {
    start.setMonth(now.getMonth() - 5);
    start.setDate(1);
    months = 6;
  } else if (range === "1y") {
    start.setMonth(now.getMonth() - 11);
    start.setDate(1);
    months = 12;
  } else {
    // ytd
    start.setMonth(0);
    start.setDate(1);
    months = now.getMonth() + 1;
  }
  return { start, months };
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => rangeSchema.parse(data ?? {}))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { start: rangeStart, months: rangeMonths } = computeRange(data.range);
    const rangeStartStr = rangeStart.toISOString().slice(0, 10);

    const { data: accounts } = await context.supabase
      .from("accounts")
      .select("id, name, category, currency, current_balance, is_liability, excluded_from_net_worth, is_active")
      .eq("household_id", householdId)
      .eq("is_active", true);

    const inr = (accounts ?? []).filter((a: any) => a.currency === "INR" && !a.excluded_from_net_worth);
    let assets = 0;
    let liabilities = 0;
    const byCategory: Record<string, number> = {};
    for (const a of inr) {
      const bal = Number(a.current_balance ?? 0);
      if (a.is_liability) {
        liabilities += Math.abs(bal);
      } else {
        assets += bal;
        byCategory[a.category] = (byCategory[a.category] ?? 0) + bal;
      }
    }
    const netWorth = assets - liabilities;

    // Income / expense across the selected range
    const { data: rangeTxns } = await context.supabase
      .from("transactions")
      .select("type, amount, txn_date, category:categories(name)")
      .eq("household_id", householdId)
      .gte("txn_date", rangeStartStr);

    let income = 0;
    let expense = 0;
    const spendByCat: Record<string, number> = {};
    const buckets: Record<string, { income: number; expense: number }> = {};
    for (let i = 0; i < rangeMonths; i++) {
      const d = new Date(rangeStart);
      d.setMonth(rangeStart.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets[key] = { income: 0, expense: 0 };
    }
    for (const t of rangeTxns ?? []) {
      const amt = Number(t.amount);
      if (t.type === "income") income += amt;
      else if (t.type === "expense") {
        expense += amt;
        const cat = (t as any).category?.name ?? "Uncategorized";
        spendByCat[cat] = (spendByCat[cat] ?? 0) + amt;
      }
      const key = (t.txn_date as string).slice(0, 7);
      if (buckets[key]) {
        if (t.type === "income") buckets[key].income += amt;
        else if (t.type === "expense") buckets[key].expense += amt;
      }
    }
    const cashFlow = Object.entries(buckets).map(([month, v]) => ({
      month,
      label: new Date(`${month}-01`).toLocaleDateString("en-IN", { month: "short" }),
      income: v.income,
      expense: v.expense,
      net: v.income - v.expense,
    }));

    // --- Net worth trend within range ---
    const { data: snaps } = await context.supabase
      .from("net_worth_snapshots")
      .select("snapshot_date, net_worth, total_assets, total_liabilities")
      .eq("household_id", householdId)
      .gte("snapshot_date", rangeStartStr)
      .order("snapshot_date", { ascending: true })
      .limit(400);
    const netWorthTrend = (snaps ?? []).map((s: any) => ({
      date: s.snapshot_date,
      label: new Date(s.snapshot_date).toLocaleDateString("en-IN", { month: "short", day: "2-digit" }),
      netWorth: Number(s.net_worth ?? 0),
      assets: Number(s.total_assets ?? 0),
      liabilities: Number(s.total_liabilities ?? 0),
    }));
    const todayStr = new Date().toISOString().slice(0, 10);
    if (netWorthTrend.length === 0 || netWorthTrend[netWorthTrend.length - 1].date !== todayStr) {
      netWorthTrend.push({ date: todayStr, label: "Now", netWorth, assets, liabilities });
    }

    // --- Upcoming bills (always next 30 days, independent of range) ---
    const inThirty = new Date();
    inThirty.setDate(inThirty.getDate() + 30);
    const { data: billsData } = await context.supabase
      .from("bills")
      .select("id, name, amount, due_date, status, account:accounts(name)")
      .eq("household_id", householdId)
      .neq("status", "paid")
      .lte("due_date", inThirty.toISOString().slice(0, 10))
      .order("due_date", { ascending: true })
      .limit(8);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcomingBills = (billsData ?? []).map((b: any) => {
      const due = new Date(b.due_date);
      const daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);
      return {
        id: b.id,
        name: b.name,
        amount: Number(b.amount ?? 0),
        due_date: b.due_date,
        daysUntil,
        accountName: b.account?.name ?? null,
        overdue: daysUntil < 0,
      };
    });
    const upcomingBillsTotal = upcomingBills.reduce((s: number, b: any) => s + b.amount, 0);

    return {
      range: data.range,
      netWorth,
      assets,
      liabilities,
      byCategory,
      accountsCount: (accounts ?? []).length,
      income,
      expense,
      savings: income - expense,
      spendByCat,
      cashFlow,
      netWorthTrend,
      upcomingBills,
      upcomingBillsTotal,
    };
  });


