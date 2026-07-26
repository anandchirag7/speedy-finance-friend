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

const ruleShape = {
  payee_id: z.string().uuid(),
  txn_type: z.enum(["expense", "income", "transfer", "deposit", "withdrawal", "investment"]),
  category_id: z.string().uuid().nullable().optional(),
  transfer_account_id: z.string().uuid().nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  tags: z.array(z.string()).default([]),
  default_amount: z.number().nullable().optional(),
  min_amount: z.number().nullable().optional(),
  max_amount: z.number().nullable().optional(),
  priority: z.number().int().default(0),
  is_active: z.boolean().default(true),
};

export const listPayeeRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ payee_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("payee_rules")
      .select("*, category:categories(id, name, kind, color, icon), transfer_account:accounts!payee_rules_transfer_account_id_fkey(id, name)")
      .eq("payee_id", data.payee_id)
      .order("txn_type", { ascending: true })
      .order("priority", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const createPayeeRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object(ruleShape).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: row, error } = await context.supabase
      .from("payee_rules")
      .insert({ ...data, household_id: householdId })
      .select("*, category:categories(id, name, kind, color, icon), transfer_account:accounts!payee_rules_transfer_account_id_fkey(id, name)")
      .single();
    if (error) throw error;
    return row;
  });

export const updatePayeeRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), patch: z.object(ruleShape).partial() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("payee_rules")
      .update(data.patch)
      .eq("id", data.id)
      .select("*, category:categories(id, name, kind, color, icon), transfer_account:accounts!payee_rules_transfer_account_id_fkey(id, name)")
      .single();
    if (error) throw error;
    return row;
  });

export const deletePayeeRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("payee_rules").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
