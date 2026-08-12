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

const PAGE = 1000;

export const listCategoriesWithUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);

    // PostgREST caps rows per request, so page through both tables explicitly.
    const cats: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await context.supabase
        .from("categories")
        .select("*")
        .eq("household_id", householdId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      cats.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    const counts: Record<string, number> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await context.supabase
        .from("transactions")
        .select("category_id")
        .eq("household_id", householdId)
        .not("category_id", "is", null)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const t of data ?? []) {
        const id = (t as any).category_id as string;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      if (!data || data.length < PAGE) break;
    }

    return cats.map((c: any) => ({ ...c, usage_count: counts[c.id] ?? 0 }));
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
    const existing: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: e1 } = await context.supabase
        .from("categories")
        .select("id, name, parent_id")
        .eq("household_id", householdId)
        .range(from, from + PAGE - 1);
      if (e1) throw e1;
      existing.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }


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

    // Group rows into depth levels so each level can be written in one batch.
    // Depth 0 = no parent, depth n = parent appears as a row at depth n-1.
    const rowsByNameLower = new Map<string, (typeof data.rows)[number]>();
    for (const r of data.rows) {
      const n = r.name.trim().toLowerCase();
      if (!rowsByNameLower.has(n)) rowsByNameLower.set(n, r);
    }
    const depthOf = (row: (typeof data.rows)[number], seen = new Set<string>()): number => {
      if (!row.parent) return 0;
      const pn = row.parent.trim().toLowerCase();
      if (seen.has(pn)) return 0; // cycle guard
      const parentRow = rowsByNameLower.get(pn);
      if (!parentRow) return 0; // parent must already exist in DB
      seen.add(pn);
      return 1 + depthOf(parentRow, seen);
    };
    const levels: (typeof data.rows)[] = [];
    for (const row of data.rows) {
      const d = Math.min(depthOf(row), 20);
      (levels[d] ??= []).push(row);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    const CHUNK = 500;

    for (const level of levels) {
      if (!level?.length) continue;
      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      for (const row of level) {
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
        if (existingId) toUpdate.push({ ...payload, id: existingId });
        else toInsert.push({ ...payload, is_system: false });
      }

      // Batched updates via primary-key upsert.
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        const chunk = toUpdate.slice(i, i + CHUNK);
        const { error } = await context.supabase.from("categories").upsert(chunk, { onConflict: "id" });
        if (error) {
          skipped += chunk.length;
          errors.push(`Update batch failed: ${error.message}`);
          continue;
        }
        updated += chunk.length;
      }

      // Batched inserts; returned ids feed the next depth level.
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const { data: inserted, error } = await context.supabase
          .from("categories")
          .insert(chunk)
          .select("id, name, parent_id");
        if (error || !inserted) {
          skipped += chunk.length;
          errors.push(`Insert batch failed: ${error?.message ?? "insert failed"}`);
          continue;
        }
        created += inserted.length;
        for (const ins of inserted as any[]) {
          byKey.set(key(ins.name, ins.parent_id ?? null), ins.id);
          const n = String(ins.name).trim().toLowerCase();
          if (!ins.parent_id) rootsByName.set(n, ins.id);
          if (!anyByName.has(n)) anyByName.set(n, ins.id);
        }
      }
    }

    return { created, updated, skipped, errors: errors.slice(0, 50) };
  });

