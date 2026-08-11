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

    const { data: cats, error: e1 } = await context.supabase
      .from("categories")
      .select("*")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (e1) throw e1;

    const counts: Record<string, number> = {};
    try {
      const { data: txns } = await context.supabase
        .from("transactions")
        .select("category_id")
        .eq("household_id", householdId)
        .not("category_id", "is", null)
        .limit(2000);

      for (const t of txns ?? []) {
        if (t?.category_id) {
          counts[t.category_id] = (counts[t.category_id] ?? 0) + 1;
        }
      }
    } catch (err) {
      // Safe fallback
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

const DEFAULT_CATEGORIES = [
  { name: "Food & Dining", kind: "expense", subs: ["Groceries", "Eating Out", "Food Delivery"] },
  { name: "Transport", kind: "expense", subs: ["Fuel", "Auto/Cab", "Public Transport", "Vehicle Maintenance"] },
  { name: "Housing", kind: "expense", subs: ["Rent", "Maintenance/Society", "Electricity", "Water", "Gas"] },
  { name: "Household Help", kind: "expense", subs: ["Maid", "Cook", "Driver"] },
  { name: "Communication", kind: "expense", subs: ["Mobile", "Internet", "DTH/OTT"] },
  { name: "Health", kind: "expense", subs: ["Doctor", "Medicines", "Health Insurance"] },
  { name: "Education", kind: "expense", subs: ["Fees", "Tuition", "Books"] },
  { name: "Family & Festivals", kind: "expense", subs: ["Weddings", "Festival Shopping", "Gifting", "Pooja/Religious"] },
  { name: "EMIs & Loans", kind: "expense", subs: [] },
  { name: "Investments & Savings", kind: "expense", subs: ["SIP", "Lumpsum", "PPF", "NPS"] },
  { name: "Personal Care", kind: "expense", subs: [] },
  { name: "Shopping", kind: "expense", subs: ["Clothing", "Electronics", "Online Shopping"] },
  { name: "Travel & Vacation", kind: "expense", subs: [] },
  { name: "Entertainment", kind: "expense", subs: [] },
  { name: "Taxes", kind: "expense", subs: [] },
  { name: "Insurance Premiums", kind: "expense", subs: [] },
  { name: "Charity/Donation", kind: "expense", subs: [] },
  { name: "Miscellaneous", kind: "expense", subs: [] },
  { name: "Salary", kind: "income", subs: [] },
  { name: "Business Income", kind: "income", subs: [] },
  { name: "Interest", kind: "income", subs: [] },
  { name: "Dividends", kind: "income", subs: [] },
  { name: "Rental Income", kind: "income", subs: [] },
  { name: "Other Income", kind: "income", subs: [] },
];

export const seedDefaultCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);

    // Try RPC first
    const { error: rpcError } = await context.supabase.rpc("seed_default_categories", {
      _household_id: householdId,
    });

    if (!rpcError) return { ok: true };

    // Fallback: Direct table insertion
    for (const item of DEFAULT_CATEGORIES) {
      const { data: parent, error: pErr } = await context.supabase
        .from("categories")
        .insert({
          household_id: householdId,
          name: item.name,
          kind: item.kind,
          is_system: true,
        })
        .select("id")
        .single();

      if (pErr) continue;

      if (item.subs.length > 0 && parent?.id) {
        const subRows = item.subs.map((s) => ({
          household_id: householdId,
          parent_id: parent.id,
          name: s,
          kind: item.kind,
          is_system: true,
        }));
        await context.supabase.from("categories").insert(subRows);
      }
    }

    return { ok: true };
  });

const csvRowSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(["income", "expense", "transfer", "investment"]).default("expense"),
  scope: z.enum(["personal", "business"]).default("personal"),
  parent_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  group_label: z.string().nullable().optional(),
  tax_code: z.string().nullable().optional(),
});

export const bulkImportCategoriesFromCSV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ rows: z.array(csvRowSchema) }).parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    // Fetch existing categories to resolve parent IDs and avoid duplicates
    const { data: existing } = await context.supabase
      .from("categories")
      .select("id, name, kind, household_id")
      .eq("household_id", householdId);

    const catMap = new Map<string, string>();
    for (const c of existing ?? []) {
      catMap.set(c.name.toLowerCase().trim(), c.id);
    }

    // Step 1: Insert parent rows (where parent_name is empty)
    const parentsToInsert = data.rows.filter((r) => !r.parent_name || !r.parent_name.trim());
    let insertedCount = 0;

    for (const row of parentsToInsert) {
      const key = row.name.toLowerCase().trim();
      const existingId = catMap.get(key);
      if (existingId) {
        // Update existing parent if needed
        await context.supabase
          .from("categories")
          .update({
            kind: row.kind,
            scope: row.scope,
            description: row.description ?? undefined,
          })
          .eq("id", existingId);
      } else {
        const { data: saved } = await context.supabase
          .from("categories")
          .insert({
            household_id: householdId,
            name: row.name.trim(),
            kind: row.kind,
            scope: row.scope,
            description: row.description ?? null,
            color: row.color ?? null,
            icon: row.icon ?? null,
            group_label: row.group_label ?? null,
            tax_code: row.tax_code ?? null,
          })
          .select("id, name")
          .single();
        if (saved?.id) {
          catMap.set(saved.name.toLowerCase().trim(), saved.id);
          insertedCount++;
        }
      }
    }

    // Step 2: Insert subcategories (where parent_name is provided)
    const subsToInsert = data.rows.filter((r) => r.parent_name && r.parent_name.trim());

    for (const row of subsToInsert) {
      const parentKey = row.parent_name!.toLowerCase().trim();
      const parentId = catMap.get(parentKey) ?? null;
      const key = row.name.toLowerCase().trim();
      const existingId = catMap.get(key);

      if (existingId) {
        await context.supabase
          .from("categories")
          .update({
            parent_id: parentId,
            kind: row.kind,
            scope: row.scope,
            description: row.description ?? undefined,
          })
          .eq("id", existingId);
      } else {
        const { data: saved } = await context.supabase
          .from("categories")
          .insert({
            household_id: householdId,
            parent_id: parentId,
            name: row.name.trim(),
            kind: row.kind,
            scope: row.scope,
            description: row.description ?? null,
            color: row.color ?? null,
            icon: row.icon ?? null,
            group_label: row.group_label ?? null,
            tax_code: row.tax_code ?? null,
          })
          .select("id, name")
          .single();
        if (saved?.id) {
          catMap.set(saved.name.toLowerCase().trim(), saved.id);
          insertedCount++;
        }
      }
    }

    return { importedCount: insertedCount, totalProcessed: data.rows.length };
  });
