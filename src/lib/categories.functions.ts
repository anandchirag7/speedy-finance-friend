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

const csvRowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  parent: z.string().trim().max(100).nullable().optional(),
  kind: z.enum(["income", "expense", "transfer", "investment"]),
  scope: z.enum(["personal", "business"]).default("personal"),
  description: z.string().trim().max(500).nullable().optional(),
  group_label: z.string().trim().max(80).nullable().optional(),
  tax_code: z.string().trim().max(80).nullable().optional(),
  is_hidden: z.boolean().default(false),
});

/**
 * Bulk import categories from a parsed CSV. Parents are resolved by name
 * (existing rows first, then rows created in this same import). Matching
 * name + parent updates in place instead of duplicating.
 */
export const importCategoriesCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ rows: z.array(csvRowSchema).min(1).max(5000) }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: existing, error: e1 } = await context.supabase
      .from("categories")
      .select("id, name, parent_id")
      .eq("household_id", householdId);
    if (e1) throw e1;

    const key = (name: string, parentId: string | null) =>
      `${(parentId ?? "root").toLowerCase()}|${name.trim().toLowerCase()}`;
    const byKey = new Map<string, string>();
    const rootsByName = new Map<string, string>();
    for (const c of (existing ?? []) as any[]) {
      byKey.set(key(c.name, c.parent_id ?? null), c.id);
      if (!c.parent_id) rootsByName.set(c.name.trim().toLowerCase(), c.id);
    }
    // Any category can be a parent — index every name for fallback lookup.
    const anyByName = new Map<string, string>();
    for (const c of (existing ?? []) as any[]) {
      const n = c.name.trim().toLowerCase();
      if (!anyByName.has(n)) anyByName.set(n, c.id);
    }

    // Process parents before children so nested rows can resolve.
    const ordered = [...data.rows].sort((a, b) => Number(!!a.parent) - Number(!!b.parent));

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of ordered) {
      let parentId: string | null = null;
      if (row.parent) {
        const pn = row.parent.trim().toLowerCase();
        parentId = rootsByName.get(pn) ?? anyByName.get(pn) ?? null;
        if (!parentId) {
          skipped++;
          errors.push(`"${row.name}": parent "${row.parent}" not found.`);
          continue;
        }
      }

      const payload = {
        household_id: householdId,
        name: row.name.trim(),
        kind: row.kind,
        scope: row.scope,
        parent_id: parentId,
        description: row.description ?? null,
        group_label: row.group_label ?? null,
        tax_code: row.tax_code ?? null,
        is_hidden: row.is_hidden,
      };

      const existingId = byKey.get(key(row.name, parentId));
      if (existingId) {
        const { error } = await context.supabase
          .from("categories")
          .update(payload)
          .eq("id", existingId)
          .eq("household_id", householdId);
        if (error) {
          skipped++;
          errors.push(`"${row.name}": ${error.message}`);
          continue;
        }
        updated++;
        continue;
      }

      const { data: inserted, error } = await context.supabase
        .from("categories")
        .insert({ ...payload, is_system: false })
        .select("id, name, parent_id")
        .single();
      if (error || !inserted) {
        skipped++;
        errors.push(`"${row.name}": ${error?.message ?? "insert failed"}`);
        continue;
      }
      created++;
      byKey.set(key(inserted.name, inserted.parent_id ?? null), inserted.id);
      const n = String(inserted.name).trim().toLowerCase();
      if (!inserted.parent_id) rootsByName.set(n, inserted.id);
      if (!anyByName.has(n)) anyByName.set(n, inserted.id);
    }

    return { created, updated, skipped, errors: errors.slice(0, 50) };
  });
