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
  if (!data?.default_household_id) throw new Error("No household found for user");
  return data.default_household_id as string;
}

function monthRange(month: string) {
  // month = "YYYY-MM"
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const prevStart = new Date(Date.UTC(y, m - 2, 1));
  const prevEnd = start;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd) };
}

export const getBudgetForMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { start, end, prevStart, prevEnd } = monthRange(data.month);

    // Find or create the monthly budget for this month
    let { data: budget } = await context.supabase
      .from("budgets")
      .select("*")
      .eq("household_id", householdId)
      .eq("period", "monthly")
      .eq("start_date", start)
      .maybeSingle();

    if (!budget) {
      const { data: created, error: e } = await context.supabase
        .from("budgets")
        .insert({
          household_id: householdId,
          name: "Monthly Budget",
          period: "monthly",
          start_date: start,
          end_date: end,
          rollover: false,
        })
        .select("*")
        .single();
      if (e) throw e;
      budget = created;
    }

    // Categories (expense only)
    const [{ data: cats }, { data: bcats }, { data: txns }, { data: prevTxns }] = await Promise.all([
      context.supabase
        .from("categories")
        .select("id,name,parent_id,icon,color,kind,is_hidden,sort_order")
        .eq("household_id", householdId)
        .eq("kind", "expense"),
      context.supabase
        .from("budget_categories")
        .select("id,budget_id,category_id,amount")
        .eq("budget_id", budget.id),
      context.supabase
        .from("transactions")
        .select("category_id, amount")
        .eq("household_id", householdId)
        .eq("type", "expense")
        .gte("txn_date", start)
        .lt("txn_date", end),
      context.supabase
        .from("transactions")
        .select("category_id, amount")
        .eq("household_id", householdId)
        .eq("type", "expense")
        .gte("txn_date", prevStart)
        .lt("txn_date", prevEnd),
    ]);

    const spentByCat: Record<string, number> = {};
    for (const t of txns ?? []) {
      if (!t.category_id) continue;
      spentByCat[t.category_id] = (spentByCat[t.category_id] ?? 0) + Number(t.amount);
    }
    const prevSpentByCat: Record<string, number> = {};
    for (const t of prevTxns ?? []) {
      if (!t.category_id) continue;
      prevSpentByCat[t.category_id] = (prevSpentByCat[t.category_id] ?? 0) + Number(t.amount);
    }

    const bcByCat: Record<string, { id: string; amount: number }> = {};
    for (const b of bcats ?? []) {
      bcByCat[b.category_id] = { id: b.id, amount: Number(b.amount) };
    }

    const categories = (cats ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      parent_id: c.parent_id,
      icon: c.icon,
      color: c.color,
      is_hidden: c.is_hidden,
      sort_order: c.sort_order ?? 0,
      budget_category_id: bcByCat[c.id]?.id ?? null,
      budget: bcByCat[c.id]?.amount ?? 0,
      spent: spentByCat[c.id] ?? 0,
      spent_last_month: prevSpentByCat[c.id] ?? 0,
    }));

    return {
      budget: {
        id: budget.id as string,
        name: budget.name as string,
        period: budget.period as string,
        start_date: budget.start_date as string,
        end_date: budget.end_date as string | null,
        rollover: budget.rollover as boolean,
      },
      categories,
      month: data.month,
      range: { start, end, prevStart, prevEnd },
    };
  });

export const upsertBudgetCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        budget_id: z.string().uuid(),
        category_id: z.string().uuid(),
        amount: z.number().min(0),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: existing } = await context.supabase
      .from("budget_categories")
      .select("id")
      .eq("budget_id", data.budget_id)
      .eq("category_id", data.category_id)
      .maybeSingle();

    if (existing) {
      const { error } = await context.supabase
        .from("budget_categories")
        .update({ amount: data.amount })
        .eq("id", existing.id);
      if (error) throw error;
      return { id: existing.id as string, amount: data.amount };
    }
    const { data: inserted, error } = await context.supabase
      .from("budget_categories")
      .insert({
        budget_id: data.budget_id,
        category_id: data.category_id,
        amount: data.amount,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: inserted.id as string, amount: data.amount };
  });

export const deleteBudgetCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("budget_categories")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const copyPreviousMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { start, prevStart } = monthRange(data.month);

    const { data: prevBudget } = await context.supabase
      .from("budgets")
      .select("id")
      .eq("household_id", householdId)
      .eq("period", "monthly")
      .eq("start_date", prevStart)
      .maybeSingle();
    if (!prevBudget) return { copied: 0 };

    const [{ data: prevCats }, { data: curBudget }] = await Promise.all([
      context.supabase.from("budget_categories").select("category_id, amount").eq("budget_id", prevBudget.id),
      context.supabase
        .from("budgets")
        .select("id")
        .eq("household_id", householdId)
        .eq("period", "monthly")
        .eq("start_date", start)
        .maybeSingle(),
    ]);
    if (!curBudget || !prevCats?.length) return { copied: 0 };

    // Clear then insert
    await context.supabase.from("budget_categories").delete().eq("budget_id", curBudget.id);
    const rows = prevCats.map((r: any) => ({
      budget_id: curBudget.id,
      category_id: r.category_id,
      amount: Number(r.amount),
    }));
    const { error } = await context.supabase.from("budget_categories").insert(rows);
    if (error) throw error;
    return { copied: rows.length };
  });

export const getBudgetTrend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        months: z.number().int().min(2).max(24).default(6),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const [y, m] = data.month.split("-").map(Number);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const monthKey = (d: Date) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

    const months: string[] = [];
    for (let i = data.months - 1; i >= 0; i--) {
      months.push(monthKey(new Date(Date.UTC(y, m - 1 - i, 1))));
    }
    const rangeStart = iso(new Date(Date.UTC(y, m - data.months, 1)));
    const rangeEnd = iso(new Date(Date.UTC(y, m, 1)));

    const [{ data: txns }, { data: budgets }] = await Promise.all([
      context.supabase
        .from("transactions")
        .select("txn_date, category_id, amount")
        .eq("household_id", householdId)
        .eq("type", "expense")
        .gte("txn_date", rangeStart)
        .lt("txn_date", rangeEnd),
      context.supabase
        .from("budgets")
        .select("id,start_date")
        .eq("household_id", householdId)
        .eq("period", "monthly")
        .gte("start_date", rangeStart)
        .lt("start_date", rangeEnd),
    ]);

    const budgetIds = (budgets ?? []).map((b: any) => b.id);
    let bcatRows: Array<{ budget_id: string; category_id: string; amount: number }> = [];
    if (budgetIds.length) {
      const { data: bc } = await context.supabase
        .from("budget_categories")
        .select("budget_id,category_id,amount")
        .in("budget_id", budgetIds);
      bcatRows = (bc ?? []) as any;
    }

    const budgetByMonth: Record<string, number> = {};
    const budgetIdToMonth: Record<string, string> = {};
    for (const b of budgets ?? []) {
      const mk = String(b.start_date).slice(0, 7);
      budgetIdToMonth[b.id] = mk;
      budgetByMonth[mk] = budgetByMonth[mk] ?? 0;
    }
    for (const bc of bcatRows) {
      const mk = budgetIdToMonth[bc.budget_id];
      if (!mk) continue;
      budgetByMonth[mk] = (budgetByMonth[mk] ?? 0) + Number(bc.amount);
    }

    const spentByMonth: Record<string, number> = {};
    const spentByCatMonth: Record<string, Record<string, number>> = {};
    for (const t of txns ?? []) {
      const mk = String(t.txn_date).slice(0, 7);
      spentByMonth[mk] = (spentByMonth[mk] ?? 0) + Number(t.amount);
      if (t.category_id) {
        spentByCatMonth[t.category_id] = spentByCatMonth[t.category_id] ?? {};
        spentByCatMonth[t.category_id][mk] =
          (spentByCatMonth[t.category_id][mk] ?? 0) + Number(t.amount);
      }
    }

    const trend = months.map((mk) => ({
      month: mk,
      budget: budgetByMonth[mk] ?? 0,
      spent: spentByMonth[mk] ?? 0,
    }));

    const perCategory: Record<string, number[]> = {};
    for (const [catId, byMonth] of Object.entries(spentByCatMonth)) {
      perCategory[catId] = months.map((mk) => byMonth[mk] ?? 0);
    }

    return { months, trend, perCategory };
  });
