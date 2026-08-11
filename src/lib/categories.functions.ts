import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getHouseholdId(ctx: { supabase: any; userId: string }): Promise<string> {
  try {
    const { data } = await ctx.supabase
      .from("profiles")
      .select("default_household_id")
      .eq("id", ctx.userId)
      .maybeSingle();

    if (data?.default_household_id) {
      return data.default_household_id as string;
    }

    const { data: member } = await ctx.supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", ctx.userId)
      .limit(1)
      .maybeSingle();

    if (member?.household_id) {
      return member.household_id as string;
    }
  } catch (err) {
    console.warn("getHouseholdId lookup warning:", err);
  }

  return ctx.userId;
}

export const listCategoriesWithUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);

    const { data: cats, error } = await context.supabase
      .from("categories")
      .select("*")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;

    return (cats ?? []).map((c: any) => ({ ...c, usage_count: 0 }));
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
  .validator((data: unknown) => categorySchema.parse(data))
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
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
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
  .validator((data: unknown) =>
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
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
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
  .validator((data: unknown) => z.object({ rows: z.array(csvRowSchema) }).parse(data))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    // Fetch existing categories (including parent_id so we can detect broken links)
    const { data: existing } = await context.supabase
      .from("categories")
      .select("id, name, parent_id")
      .eq("household_id", householdId);

    // name (lowercase) → { id, parent_id }
    const catMap = new Map<string, { id: string; parent_id: string | null }>();
    for (const c of existing ?? []) {
      catMap.set(c.name.toLowerCase().trim(), { id: c.id, parent_id: c.parent_id });
    }

    // Track which rows still need to be inserted
    let pending = data.rows.filter(
      (r) => !catMap.has(r.name.toLowerCase().trim()),
    );
    let totalInserted = 0;
    let totalUpdated = 0;
    const CHUNK_SIZE = 500;
    const MAX_PASSES = 10;

    // ── Phase 1: Multi-pass INSERT new categories ──
    // Each pass inserts rows whose parent is already resolved (or has no parent).
    // Pass 0 = roots, pass 1 = children, pass 2 = grandchildren, etc.
    for (let pass = 0; pass < MAX_PASSES && pending.length > 0; pass++) {
      const canInsert = pending.filter((r) => {
        if (!r.parent_name || !r.parent_name.trim()) return true;
        return catMap.has(r.parent_name.toLowerCase().trim());
      });

      if (canInsert.length === 0) {
        console.warn(
          `CSV import: ${pending.length} rows have unresolvable parent_name values, skipping.`,
        );
        break;
      }

      const payloads = canInsert.map((row) => {
        const parentKey = row.parent_name?.toLowerCase().trim();
        const parentId = parentKey ? catMap.get(parentKey)?.id ?? null : null;
        return {
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
        };
      });

      for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
        const chunk = payloads.slice(i, i + CHUNK_SIZE);
        const { data: saved, error } = await context.supabase
          .from("categories")
          .insert(chunk)
          .select("id, name");

        if (error) {
          console.warn(`CSV import pass ${pass} warning:`, error.message);
        } else if (saved) {
          for (const s of saved) {
            catMap.set(s.name.toLowerCase().trim(), { id: s.id, parent_id: null });
          }
          totalInserted += saved.length;
        }
      }

      const insertedNames = new Set(
        canInsert.map((r) => r.name.toLowerCase().trim()),
      );
      pending = pending.filter(
        (r) => !insertedNames.has(r.name.toLowerCase().trim()),
      );
    }

    // ── Phase 2: UPDATE existing categories that have broken parent_id ──
    // For CSV rows that already existed in DB but have parent_id=null while CSV specifies a parent
    const rowsNeedingParentFix = data.rows.filter((r) => {
      if (!r.parent_name || !r.parent_name.trim()) return false;
      const key = r.name.toLowerCase().trim();
      const entry = catMap.get(key);
      if (!entry) return false; // not in DB at all (shouldn't happen after phase 1)
      // Only fix if current parent_id is null
      return !entry.parent_id;
    });

    for (const row of rowsNeedingParentFix) {
      const parentKey = row.parent_name!.toLowerCase().trim();
      const parentEntry = catMap.get(parentKey);
      if (!parentEntry) continue; // parent doesn't exist, can't fix

      const childKey = row.name.toLowerCase().trim();
      const childEntry = catMap.get(childKey);
      if (!childEntry) continue;

      const { error } = await context.supabase
        .from("categories")
        .update({ parent_id: parentEntry.id })
        .eq("id", childEntry.id)
        .eq("household_id", householdId);

      if (!error) {
        childEntry.parent_id = parentEntry.id;
        totalUpdated++;
      }
    }

    return {
      importedCount: totalInserted,
      updatedCount: totalUpdated,
      totalProcessed: data.rows.length,
      skipped: pending.length,
    };
  });

