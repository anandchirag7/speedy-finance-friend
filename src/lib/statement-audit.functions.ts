import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function householdOf(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.default_household_id) throw new Error("No household");
  return data.default_household_id as string;
}

const txnShape = z.object({
  key: z.string(),
  date: z.string(),
  amount: z.number(),
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string().default(""),
  merchant: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

/**
 * Explains every duplicate collision for a pending import: which fields
 * matched, the match confidence and the stored transaction it collides with.
 */
export const explainImportDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        transactions: z.array(txnShape).min(1).max(10000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await householdOf(context);
    const { loadWindow, explainDuplicates } = await import("./statement-audit.server");
    const existing = await loadWindow(context.supabase, householdId, data.accountId, data.transactions);
    const verdicts = explainDuplicates(data.transactions as any, existing);
    return { verdicts, comparedAgainst: existing.length };
  });

/** Before/after diff of a re-parsed statement against what is already stored. */
export const diffReparsedStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        uploadId: z.string().uuid().optional(),
        transactions: z.array(txnShape).min(1).max(10000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await householdOf(context);
    const { loadWindow, buildDiff } = await import("./statement-audit.server");

    let batchId: string | null = null;
    if (data.uploadId) {
      const { data: up } = await context.supabase
        .from("statement_uploads")
        .select("import_token")
        .eq("id", data.uploadId)
        .maybeSingle();
      batchId = (up?.import_token as string) ?? null;
    }

    const existing = await loadWindow(context.supabase, householdId, data.accountId, data.transactions);
    return buildDiff(data.transactions as any, existing, { batchId });
  });

/** Import batches that can still be rolled back. */
export const listImportBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await householdOf(context);
    const { data, error } = await context.supabase
      .from("statement_uploads")
      .select("id, filename, import_token, imported_at, inserted_count")
      .eq("household_id", householdId)
      .not("imported_at", "is", null)
      .order("imported_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Rolls back a whole import batch: every transaction inserted by that import is
 * deleted, the upload row is reopened and account balances are recomputed.
 */
export const undoImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ batchId: z.string().uuid().optional(), uploadId: z.string().uuid().optional() })
      .refine((v) => !!(v.batchId || v.uploadId), "batchId or uploadId is required")
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await householdOf(context);

    let batchId = data.batchId ?? null;
    let uploadId = data.uploadId ?? null;
    if (!batchId && uploadId) {
      const { data: up } = await context.supabase
        .from("statement_uploads")
        .select("import_token")
        .eq("id", uploadId)
        .maybeSingle();
      batchId = (up?.import_token as string) ?? null;
    }
    if (!batchId) throw new Error("This import cannot be rolled back — no batch reference was recorded.");
    if (!uploadId) {
      const { data: up } = await context.supabase
        .from("statement_uploads")
        .select("id")
        .eq("import_token", batchId)
        .maybeSingle();
      uploadId = (up?.id as string) ?? null;
    }

    const { data: rows, error: readErr } = await context.supabase
      .from("transactions")
      .select("id, account_id")
      .eq("household_id", householdId)
      .eq("import_batch_id", batchId);
    if (readErr) throw new Error(readErr.message);

    const accountIds = Array.from(new Set((rows ?? []).map((r: any) => r.account_id as string)));
    const { error: delErr } = await context.supabase
      .from("transactions")
      .delete()
      .eq("household_id", householdId)
      .eq("import_batch_id", batchId);
    if (delErr) throw new Error(delErr.message);

    const { recomputeAccountBalance } = await import("./statement-audit.server");
    for (const accountId of accountIds) {
      await recomputeAccountBalance(context.supabase, householdId, accountId);
    }

    if (uploadId) {
      await context.supabase
        .from("statement_uploads")
        .update({
          imported_at: null,
          inserted_count: 0,
          error: "Import rolled back by user",
        })
        .eq("id", uploadId);
    }

    return { deleted: (rows ?? []).length, accounts: accountIds.length };
  });

/** Email notification preference for import events. */
export const getImportNotifyPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("import_email_notifications, notification_email")
      .eq("id", context.userId)
      .maybeSingle();
    return {
      import_email_notifications: !!data?.import_email_notifications,
      notification_email: (data?.notification_email as string | null) ?? null,
      account_email: (context.claims as any)?.email ?? null,
    };
  });

export const saveImportNotifyPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        import_email_notifications: z.boolean(),
        notification_email: z.string().email().max(200).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("profiles").update(data).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Fires an optional email for a parsing / archiving / import outcome. Always
 * resolves — the in-app toast is the primary channel, email is a bonus.
 */
export const notifyImportEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        event: z.enum(["parsed", "archived", "imported", "rolled_back", "failed"]),
        ok: z.boolean().default(true),
        title: z.string().min(1).max(200),
        lines: z.array(z.string().max(300)).max(12).default([]),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("import_email_notifications, notification_email")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.import_email_notifications) {
      return { sent: false, reason: "Email notifications are off." };
    }
    const to = (profile.notification_email as string | null) ?? (context.claims as any)?.email;
    if (!to) return { sent: false, reason: "No notification email address is set." };

    const { sendImportEmail } = await import("./statement-audit.server");
    return sendImportEmail({
      to,
      subject: `${data.ok ? "" : "Action needed: "}${data.title}`,
      heading: data.title,
      lines: data.lines,
      ok: data.ok,
    });
  });
