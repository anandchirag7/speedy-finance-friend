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

// ---------- rich list ----------
const listSchema = z
  .object({
    accountIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
    types: z.array(z.enum(["income", "expense", "transfer"])).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    minAmount: z.number().optional(),
    maxAmount: z.number().optional(),
    cleared: z.array(z.string()).optional(),
    reviewed: z.enum(["any", "yes", "no"]).default("any"),
    flagged: z.enum(["any", "yes", "no"]).default("any"),
    hasAttachment: z.enum(["any", "yes", "no"]).default("any"),
    search: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(1000).default(500),
  })
  .default({});

export const listTransactionsRich = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    let q = context.supabase
      .from("transactions")
      .select(
        `id, account_id, transfer_account_id, category_id, type, amount, txn_date,
         note, memo, merchant, payment_method, check_number, tags, tax_code,
         cleared_status, is_flagged, is_favorite, is_reviewed, is_read,
         attachment_count, comment_count, created_at,
         category:categories(id, name, kind, color, icon),
         account:accounts!transactions_account_id_fkey(id, name, currency, institution),
         transfer_account:accounts!transactions_transfer_account_id_fkey(id, name)`,
      )
      .eq("household_id", householdId)
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.accountIds?.length) q = q.in("account_id", data.accountIds);
    if (data.categoryIds?.length) q = q.in("category_id", data.categoryIds);
    if (data.types?.length) q = q.in("type", data.types);
    if (data.startDate) q = q.gte("txn_date", data.startDate);
    if (data.endDate) q = q.lte("txn_date", data.endDate);
    if (data.minAmount != null) q = q.gte("amount", data.minAmount);
    if (data.maxAmount != null) q = q.lte("amount", data.maxAmount);
    if (data.cleared?.length) q = q.in("cleared_status", data.cleared);
    if (data.reviewed !== "any") q = q.eq("is_reviewed", data.reviewed === "yes");
    if (data.flagged !== "any") q = q.eq("is_flagged", data.flagged === "yes");
    if (data.hasAttachment === "yes") q = q.gt("attachment_count", 0);
    if (data.hasAttachment === "no") q = q.eq("attachment_count", 0);
    if (data.tags?.length) q = q.overlaps("tags", data.tags);
    if (data.search?.trim()) {
      const term = data.search.trim().replace(/[%,]/g, "");
      q = q.or(
        `merchant.ilike.%${term}%,memo.ilike.%${term}%,note.ilike.%${term}%,check_number.ilike.%${term}%`,
      );
    }

    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

// ---------- inline update ----------
const patchSchema = z.object({
  id: z.string().uuid(),
  patch: z.object({
    category_id: z.string().uuid().nullable().optional(),
    merchant: z.string().max(200).nullable().optional(),
    memo: z.string().max(500).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
    payment_method: z.string().max(80).nullable().optional(),
    tax_code: z.string().max(80).nullable().optional(),
    check_number: z.string().max(40).nullable().optional(),
    tags: z.array(z.string()).optional(),
    amount: z.number().positive().optional(),
    txn_date: z.string().optional(),
    cleared_status: z.enum(["pending", "cleared", "reconciled"]).optional(),
    is_flagged: z.boolean().optional(),
    is_favorite: z.boolean().optional(),
    is_reviewed: z.boolean().optional(),
  }),
});

export const patchTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => patchSchema.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: saved, error } = await context.supabase
      .from("transactions")
      .update(data.patch)
      .eq("id", data.id)
      .eq("household_id", householdId)
      .select()
      .single();
    if (error) throw error;
    await context.supabase.from("transaction_activity").insert({
      household_id: householdId,
      transaction_id: data.id,
      actor_id: context.userId,
      action: "update",
      details: data.patch,
    });
    return saved;
  });

// ---------- bulk update ----------
const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  patch: patchSchema.shape.patch,
});

export const bulkPatchTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bulkSchema.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { error } = await context.supabase
      .from("transactions")
      .update(data.patch)
      .in("id", data.ids)
      .eq("household_id", householdId);
    if (error) throw error;
    const activity = data.ids.map((tid) => ({
      household_id: householdId,
      transaction_id: tid,
      actor_id: context.userId,
      action: "bulk_update",
      details: data.patch,
    }));
    await context.supabase.from("transaction_activity").insert(activity);
    return { ok: true, count: data.ids.length };
  });

export const bulkDeleteTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { error } = await context.supabase
      .from("transactions")
      .delete()
      .in("id", data.ids)
      .eq("household_id", householdId);
    if (error) throw error;
    return { ok: true, count: data.ids.length };
  });

// ---------- transaction detail (comments, attachments, activity) ----------
export const getTransactionDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const [{ data: txn }, { data: attachments }, { data: comments }, { data: activity }] = await Promise.all([
      context.supabase
        .from("transactions")
        .select(
          `*, category:categories(id, name, kind, color, icon),
           account:accounts!transactions_account_id_fkey(id, name, institution, currency)`,
        )
        .eq("id", data.id)
        .eq("household_id", householdId)
        .maybeSingle(),
      context.supabase
        .from("transaction_attachments")
        .select("*")
        .eq("transaction_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("transaction_comments")
        .select("*")
        .eq("transaction_id", data.id)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("transaction_activity")
        .select("*")
        .eq("transaction_id", data.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    return { txn, attachments: attachments ?? [], comments: comments ?? [], activity: activity ?? [] };
  });

// ---------- comments ----------
export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ transactionId: z.string().uuid(), body: z.string().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: c, error } = await context.supabase
      .from("transaction_comments")
      .insert({
        household_id: householdId,
        transaction_id: data.transactionId,
        author_id: context.userId,
        body: data.body,
      })
      .select()
      .single();
    if (error) throw error;
    // Refresh cached comment count
    const { count } = await context.supabase
      .from("transaction_comments")
      .select("id", { count: "exact", head: true })
      .eq("transaction_id", data.transactionId);
    await context.supabase
      .from("transactions")
      .update({ comment_count: count ?? 0 })
      .eq("id", data.transactionId)
      .eq("household_id", householdId);
    return c;
  });

// ---------- attachments (signed URLs) ----------
export const listAttachmentUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ paths: z.array(z.string()).max(50) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.paths.length === 0) return [] as { path: string; url: string | null }[];
    const { data: signed, error } = await context.supabase.storage
      .from("receipts")
      .createSignedUrls(data.paths, 60 * 60);
    if (error) throw error;
    return (signed ?? []).map((s: any) => ({ path: s.path, url: s.signedUrl }));
  });

export const registerAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        transactionId: z.string().uuid(),
        storagePath: z.string(),
        fileName: z.string(),
        mimeType: z.string().optional(),
        sizeBytes: z.number().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { data: att, error } = await context.supabase
      .from("transaction_attachments")
      .insert({
        household_id: householdId,
        transaction_id: data.transactionId,
        storage_path: data.storagePath,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        uploaded_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    // Refresh count
    const { count } = await context.supabase
      .from("transaction_attachments")
      .select("id", { count: "exact", head: true })
      .eq("transaction_id", data.transactionId);
    await context.supabase
      .from("transactions")
      .update({ attachment_count: count ?? 0 })
      .eq("id", data.transactionId)
      .eq("household_id", householdId);
    return att;
  });

// ---------- saved views ----------
export const listSavedViews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await getHouseholdId(context);
    const { data, error } = await context.supabase
      .from("transaction_views")
      .select("*")
      .eq("household_id", householdId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const saveView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(80),
        filters: z.record(z.string(), z.any()).default({}),
        layout: z.record(z.string(), z.any()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const row = { ...data, household_id: householdId, user_id: context.userId };
    const { data: saved, error } = await context.supabase
      .from("transaction_views")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    return saved;
  });

export const deleteView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const { error } = await context.supabase
      .from("transaction_views")
      .delete()
      .eq("id", data.id)
      .eq("household_id", householdId)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- AI insights ----------
const insightsInput = z.object({
  window: z.enum(["30d", "90d", "6m", "1y"]).default("30d"),
});

export const generateAIInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => insightsInput.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const now = new Date();
    const start = new Date(now);
    if (data.window === "30d") start.setDate(start.getDate() - 30);
    else if (data.window === "90d") start.setDate(start.getDate() - 90);
    else if (data.window === "6m") start.setMonth(start.getMonth() - 6);
    else start.setFullYear(start.getFullYear() - 1);
    const startStr = start.toISOString().slice(0, 10);

    const { data: rows } = await context.supabase
      .from("transactions")
      .select("type, amount, txn_date, merchant, category:categories(name)")
      .eq("household_id", householdId)
      .gte("txn_date", startStr)
      .limit(2000);

    const bag = (rows ?? []).map((r: any) => ({
      d: r.txn_date,
      t: r.type,
      a: Number(r.amount),
      m: r.merchant ?? "",
      c: (r as any).category?.name ?? "Uncategorized",
    }));

    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      return { insights: heuristicInsights(bag) };
    }

    const systemPrompt = `You are a personal finance analyst. Return 4-6 concise, high-signal, actionable insights.
Each item: {"severity":"info|warning|success","title":"...","detail":"..."}
Rules: no fluff, use ₹ for amounts, be specific with numbers/merchants/categories, one sentence detail max.`;

    const userPrompt = `Transactions (last ${data.window}, INR):\n${JSON.stringify(bag).slice(0, 15000)}`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "insights",
              schema: {
                type: "object",
                properties: {
                  insights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        severity: { type: "string", enum: ["info", "warning", "success"] },
                        title: { type: "string" },
                        detail: { type: "string" },
                      },
                      required: ["severity", "title", "detail"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["insights"],
                additionalProperties: false,
              },
              strict: true,
            },
          },
        }),
      });
      if (!res.ok) return { insights: heuristicInsights(bag) };
      const j = await res.json();
      const content = j?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content);
      return { insights: parsed.insights ?? heuristicInsights(bag) };
    } catch {
      return { insights: heuristicInsights(bag) };
    }
  });

function heuristicInsights(bag: { d: string; t: string; a: number; m: string; c: string }[]) {
  const insights: { severity: "info" | "warning" | "success"; title: string; detail: string }[] = [];
  const spend = bag.filter((r) => r.t === "expense");
  if (spend.length === 0)
    return [{ severity: "info" as const, title: "No spend recorded", detail: "Import transactions or add manually to see insights." }];
  const byCat: Record<string, number> = {};
  for (const r of spend) byCat[r.c] = (byCat[r.c] ?? 0) + r.a;
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  if (topCat)
    insights.push({
      severity: "info",
      title: `${topCat[0]} is your top spend`,
      detail: `You spent ₹${Math.round(topCat[1]).toLocaleString("en-IN")} on ${topCat[0]}.`,
    });
  const byMerch: Record<string, number> = {};
  for (const r of spend) if (r.m) byMerch[r.m] = (byMerch[r.m] ?? 0) + 1;
  const rec = Object.entries(byMerch).find(([, n]) => n >= 3);
  if (rec)
    insights.push({ severity: "warning", title: `Recurring: ${rec[0]}`, detail: `Seen ${rec[1]} times — check for a subscription.` });
  const big = spend.slice().sort((a, b) => b.a - a.a)[0];
  if (big)
    insights.push({
      severity: "info",
      title: `Largest expense: ${big.m || big.c}`,
      detail: `₹${Math.round(big.a).toLocaleString("en-IN")} on ${big.d}.`,
    });
  return insights;
}
