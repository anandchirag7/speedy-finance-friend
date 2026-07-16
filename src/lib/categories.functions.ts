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

export const listCategoriesWithUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const [{ data: cats, error: e1 }, { data: txns, error: e2 }] = await Promise.all([
      context.supabase
        .from("categories")
        .select("*")
        .eq("household_id", householdId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      context.supabase
        .from("transactions")
        .select("category_id")
        .eq("household_id", householdId)
        .not("category_id", "is", null),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const counts: Record<string, number> = {};
    for (const t of txns ?? []) {
      const id = (t as any).category_id as string;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return (cats ?? []).map((c: any) => ({ ...c, usage_count: counts[c.id] ?? 0 }));
  });

const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  kind: z.enum(["income", "expense", "transfer", "investment"]),
  scope: z.enum(["personal", "business"]).default("personal"),
  parent_id: z.string().uuid().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  group_label: z.string().max(80).nullable().optional(),
  tax_code: z.string().max(80).nullable().optional(),
  is_hidden: z.boolean().default(false),
  sort_order: z.number().int().default(0),
});

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => categorySchema.parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const row = { ...data, household_id: householdId };
    const { data: saved, error } = await context.supabase
      .from("categories")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    return saved;
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { error } = await context.supabase
      .from("categories")
      .delete()
      .eq("id", data.id)
      .eq("household_id", householdId);
    if (error) throw error;
    return { ok: true };
  });

export const toggleCategoryHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), is_hidden: z.boolean() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { error } = await context.supabase
      .from("categories")
      .update({ is_hidden: data.is_hidden })
      .eq("id", data.id)
      .eq("household_id", householdId);
    if (error) throw error;
    return { ok: true };
  });

export const duplicateCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: src, error: e1 } = await context.supabase
      .from("categories")
      .select("*")
      .eq("id", data.id)
      .eq("household_id", householdId)
      .maybeSingle();
    if (e1) throw e1;
    if (!src) throw new Error("Category not found");
    const { id, created_at, ...rest } = src;
    const copy = { ...rest, name: `${src.name} (Copy)`, is_system: false };
    const { data: saved, error } = await context.supabase
      .from("categories")
      .insert(copy)
      .select()
      .single();
    if (error) throw error;
    return saved;
  });
