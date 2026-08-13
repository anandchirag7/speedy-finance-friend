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

const payeeShape = {
  merchant: z.string().min(1).max(200),
  merchant_type: z.string().max(80).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  txn_type: z.enum(["expense", "income", "transfer", "deposit", "withdrawal", "investment"]).default("expense"),
  category_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).default([]),
  memo: z.string().max(500).nullable().optional(),
  default_amount: z.number().nullable().optional(),
  amount_tolerance_pct: z.number().min(0).max(100).nullable().optional(),
  currency: z.string().default("INR"),
  payment_method: z.string().max(80).nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  transfer_account_id: z.string().uuid().nullable().optional(),
  splits: z.array(z.any()).default([]),
  auto_categorize: z.boolean().default(true),
  auto_memo: z.boolean().default(false),
  auto_tags: z.boolean().default(false),
  auto_amount: z.boolean().default(false),
  auto_clear: z.boolean().default(false),
  auto_attach_receipt: z.boolean().default(false),
  auto_budget: z.boolean().default(false),
  auto_reviewed: z.boolean().default(false),
  auto_tax: z.boolean().default(false),
  auto_business: z.boolean().default(false),
  priority: z.number().int().default(0),
  locked: z.boolean().default(false),
  never_auto: z.boolean().default(false),
  ai_suggestions: z.boolean().default(true),
  fuzzy_match: z.boolean().default(true),
  exact_match_only: z.boolean().default(false),
  min_amount: z.number().nullable().optional(),
  max_amount: z.number().nullable().optional(),
  restrict_account_ids: z.array(z.string().uuid()).default([]),
  date_range_start: z.string().nullable().optional(),
  date_range_end: z.string().nullable().optional(),
  apply_to_downloaded: z.boolean().default(true),
  apply_to_manual: z.boolean().default(true),
  apply_to_import: z.boolean().default(true),
  is_recurring: z.boolean().default(false),
  recurrence_freq: z.enum(["weekly", "monthly", "quarterly", "yearly", "custom"]).nullable().optional(),
  recurrence_day: z.number().int().nullable().optional(),
  next_expected_date: z.string().nullable().optional(),
  reminder_days: z.number().int().nullable().optional(),
  show_in_calendar: z.boolean().default(false),
  is_favorite: z.boolean().default(false),
  is_disabled: z.boolean().default(false),
};

export const listMemorizedPayees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const { data, error } = await context.supabase
      .from("memorized_payees")
      .select("*, category:categories(id, name, kind, color, icon)")
      .eq("household_id", householdId)
      .order("is_favorite", { ascending: false })
      .order("merchant", { ascending: true });
    if (error) throw error;
    const payees = data ?? [];

    // Compute live usage_count / last_used_at from transactions by merchant name
    const { data: txns, error: txnsError } = await context.supabase
      .from("transactions")
      .select("merchant, txn_date")
      .eq("household_id", householdId)
      .not("merchant", "is", null);
    if (txnsError) throw txnsError;
    const stats = new Map<string, { count: number; last: string | null }>();
    for (const t of txns ?? []) {
      const key = String((t as any).merchant ?? "").trim().toLowerCase();
      if (!key) continue;
      const cur = stats.get(key) ?? { count: 0, last: null };
      cur.count += 1;
      const d = (t as any).txn_date as string | null;
      if (d && (!cur.last || d > cur.last)) cur.last = d;
      stats.set(key, cur);
    }
    return payees.map((p: any) => {
      const s = stats.get(String(p.merchant ?? "").trim().toLowerCase());
      return { ...p, usage_count: s?.count ?? p.usage_count ?? 0, last_used_at: s?.last ?? p.last_used_at ?? null };
    });
  });


export const createMemorizedPayee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object(payeeShape).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: row, error } = await context.supabase
      .from("memorized_payees")
      .insert({ ...data, household_id: householdId, created_by: context.userId, modified_by: context.userId })
      .select("*, category:categories(id, name, kind, color, icon)")
      .single();
    if (error) throw error;
    return row;
  });

export const updateMemorizedPayee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), patch: z.object(payeeShape).partial() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("memorized_payees")
      .update({ ...data.patch, modified_by: context.userId })
      .eq("id", data.id)
      .select("*, category:categories(id, name, kind, color, icon)")
      .single();
    if (error) throw error;
    return row;
  });

export const deleteMemorizedPayees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("memorized_payees").delete().in("id", data.ids);
    if (error) throw error;
    return { ok: true };
  });

export const bulkUpdateMemorizedPayees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ ids: z.array(z.string().uuid()).min(1), patch: z.object(payeeShape).partial() })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("memorized_payees")
      .update({ ...data.patch, modified_by: context.userId })
      .in("id", data.ids);
    if (error) throw error;
    return { ok: true };
  });

export const listCategoriesForPayees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const { data, error } = await context.supabase
      .from("categories")
      .select("*")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .limit(2000);
    if (error) throw error;
    return data ?? [];
  });

export const listAccountsForPayees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const { data, error } = await context.supabase
      .from("accounts")
      .select("id, name, currency, institution")
      .eq("household_id", householdId)
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

export const quickSavePayee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      merchant: z.string().min(1).max(200),
      category_id: z.string().uuid().nullable().optional(),
      txn_type: z.enum(["expense", "income", "transfer"]).optional(),
      aliases: z.array(z.string()).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    const { data: existing } = await context.supabase
      .from("memorized_payees")
      .select("id, aliases")
      .eq("household_id", householdId)
      .ilike("merchant", data.merchant.trim())
      .maybeSingle();

    if (existing) {
      const curAliases = Array.isArray(existing.aliases) ? existing.aliases : [];
      const newAliases = Array.from(new Set([...curAliases, ...(data.aliases ?? [])]));
      const { data: updated, error } = await context.supabase
        .from("memorized_payees")
        .update({
          category_id: data.category_id ?? undefined,
          txn_type: data.txn_type ?? "expense",
          aliases: newAliases,
          modified_by: context.userId,
        })
        .eq("id", existing.id)
        .select("id, merchant, category_id, txn_type")
        .single();
      if (error) throw error;
      return updated;
    }

    const { data: created, error } = await context.supabase
      .from("memorized_payees")
      .insert({
        household_id: householdId,
        merchant: data.merchant.trim(),
        category_id: data.category_id ?? null,
        txn_type: data.txn_type ?? "expense",
        aliases: data.aliases ?? [],
        created_by: context.userId,
        modified_by: context.userId,
      })
      .select("id, merchant, category_id, txn_type")
      .single();

    if (error) throw error;
    return created;
  });
