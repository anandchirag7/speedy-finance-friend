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

export const RESET_SCOPES = [
  "transactions",
  "accounts",
  "bills",
  "budgets",
  "goals",
  "payees",
  "categories",
  "investments",
  "snapshots",
  "dashboards",
  "reports",
  "chat",
  "import_rules",
  "recurring",
] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

const scopeSchema = z.object({
  scopes: z.array(z.enum(RESET_SCOPES)).min(1),
  confirm: z.literal("DELETE"),
  counts: z.record(z.string(), z.number()).optional(),
});

async function del(supabase: any, table: string, apply: (q: any) => any) {
  const { error } = await apply(supabase.from(table).delete());
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function count(sb: any, table: string, apply: (q: any) => any) {
  const { count: c, error } = await apply(sb.from(table).select("id", { count: "exact", head: true }));
  if (error) return 0;
  return c ?? 0;
}

async function logAudit(sb: any, row: Record<string, unknown>) {
  const { data, error } = await sb.from("data_reset_audit").insert(row).select("id").maybeSingle();
  if (error) return null;
  return (data?.id as string) ?? null;
}

async function finishAudit(sb: any, id: string | null, patch: Record<string, unknown>) {
  if (!id) return;
  await sb.from("data_reset_audit").update({ ...patch, completed_at: new Date().toISOString() }).eq("id", id);
}

/** Counts of everything that would be removed for the selected household scopes. */
export const previewHouseholdReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ scopes: z.array(z.enum(RESET_SCOPES)) }).parse(d))
  .handler(async ({ context, data }) => {
    const hh = await getHouseholdId(context);
    const sb = context.supabase;
    const scopes = new Set<ResetScope>(data.scopes);
    if (scopes.has("accounts")) {
      scopes.add("transactions");
      scopes.add("investments");
      scopes.add("recurring");
    }
    const byHh = (q: any) => q.eq("household_id", hh);
    const uid = (q: any) => q.eq("user_id", context.userId);
    const items: { key: ResetScope; label: string; count: number }[] = [];
    const add = async (key: ResetScope, label: string, fn: () => Promise<number>) => {
      if (scopes.has(key)) items.push({ key, label, count: await fn() });
    };

    await add("accounts", "Accounts", () => count(sb, "accounts", byHh));
    await add("transactions", "Transactions", () => count(sb, "transactions", byHh));
    await add("bills", "Bills", () => count(sb, "bills", byHh));
    await add("budgets", "Budgets", () => count(sb, "budgets", byHh));
    await add("goals", "Goals", () => count(sb, "goals", byHh));
    await add("payees", "Memorized payees", () => count(sb, "memorized_payees", byHh));
    await add("categories", "Categories", () => count(sb, "categories", byHh));
    await add("investments", "Holdings", () => count(sb, "holdings", (q: any) => q));
    await add("snapshots", "Net worth snapshots", () => count(sb, "net_worth_snapshots", byHh));
    await add("dashboards", "Dashboards & views", async () =>
      (await count(sb, "dashboards", uid)) + (await count(sb, "transaction_views", uid)),
    );
    await add("reports", "Report presets & exports", async () =>
      (await count(sb, "report_presets", uid)) + (await count(sb, "report_jobs", uid)),
    );
    await add("chat", "Assistant messages", () => count(sb, "chat_messages", byHh));
    await add("import_rules", "Import rules", () => count(sb, "import_rules", byHh));
    await add("recurring", "Recurring templates", () => count(sb, "recurring_templates", byHh));

    const extras: { label: string; count: number }[] = [];
    if (scopes.has("bills")) extras.push({ label: "Bill payments & reminder logs", count: await count(sb, "bill_payments", byHh) });
    if (scopes.has("transactions"))
      extras.push(
        { label: "Attachments", count: await count(sb, "transaction_attachments", byHh) },
        { label: "Comments", count: await count(sb, "transaction_comments", byHh) },
      );

    return {
      items,
      extras: extras.filter((e) => e.count > 0),
      total: items.reduce((s, i) => s + i.count, 0) + extras.reduce((s, e) => s + e.count, 0),
    };
  });

/** Counts of everything that would be removed for a single account. */
export const previewAccountReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        account_id: z.string().uuid(),
        transactions: z.boolean().default(true),
        bills: z.boolean().default(false),
        payees: z.boolean().default(false),
        investments: z.boolean().default(false),
        recurring: z.boolean().default(false),
        deleteAccount: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const hh = await getHouseholdId(context);
    const sb = context.supabase;
    const id = data.account_id;
    const all = data.deleteAccount;
    const items: { label: string; count: number }[] = [];

    if (data.transactions || all)
      items.push({
        label: "Transactions",
        count: await count(sb, "transactions", (q: any) =>
          q.eq("household_id", hh).or(`account_id.eq.${id},transfer_account_id.eq.${id}`),
        ),
      });
    if (data.bills || all)
      items.push({ label: "Bills", count: await count(sb, "bills", (q: any) => q.eq("household_id", hh).eq("account_id", id)) });
    if (data.payees || all)
      items.push({
        label: "Memorized payees",
        count: await count(sb, "memorized_payees", (q: any) => q.eq("household_id", hh).eq("account_id", id)),
      });
    if (data.investments || all)
      items.push({ label: "Holdings", count: await count(sb, "holdings", (q: any) => q.eq("account_id", id)) });
    if (data.recurring || all)
      items.push({
        label: "Recurring templates",
        count: await count(sb, "recurring_templates", (q: any) => q.eq("household_id", hh).eq("account_id", id)),
      });
    if (all) items.push({ label: "The account itself", count: 1 });

    return { items, total: items.reduce((s, i) => s + i.count, 0) };
  });

/** Reset history for the current household. */
export const listResetAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const hh = await getHouseholdId(context);
    const { data, error } = await context.supabase
      .from("data_reset_audit")
      .select("id, kind, scopes, account_name, deleted, status, error, created_at, completed_at, actor_id")
      .eq("household_id", hh)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });

export const resetHouseholdData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scopeSchema.parse(d))
  .handler(async ({ context, data }) => {
    const hh = await getHouseholdId(context);
    const sb = context.supabase;
    const scopes = new Set<ResetScope>(data.scopes);
    const done: string[] = [];
    const byHh = (q: any) => q.eq("household_id", hh);
    const auditId = await logAudit(sb, {
      household_id: hh,
      actor_id: context.userId,
      kind: "household",
      scopes: data.scopes,
      counts: data.counts ?? {},
      status: "running",
    });
    try {


    // account ids (needed for account-keyed child tables)
    const { data: accts } = await sb.from("accounts").select("id").eq("household_id", hh);
    const accountIds = (accts ?? []).map((a: any) => a.id);
    const inAccounts = (q: any, col = "account_id") =>
      accountIds.length ? q.in(col, accountIds) : q.eq(col, "00000000-0000-0000-0000-000000000000");

    // deleting accounts implies deleting everything hanging off them
    if (scopes.has("accounts")) {
      scopes.add("transactions");
      scopes.add("investments");
      scopes.add("recurring");
    }

    if (scopes.has("bills") || scopes.has("transactions")) {
      await del(sb, "bill_payments", byHh);
    }
    if (scopes.has("bills")) {
      await del(sb, "bill_reminder_sends", byHh);
      await del(sb, "bills", byHh);
      done.push("bills & reminders");
    }

    if (scopes.has("transactions")) {
      await del(sb, "transaction_comments", byHh);
      await del(sb, "transaction_activity", byHh);
      await del(sb, "transaction_attachments", byHh);
      await del(sb, "transactions", byHh);
      done.push("transactions");
    }

    if (scopes.has("investments")) {
      const { data: holds } = await sb.from("holdings").select("id");
      const holdingIds = (holds ?? []).map((h: any) => h.id);
      if (holdingIds.length) await del(sb, "holding_transactions", (q: any) => q.in("holding_id", holdingIds));
      await del(sb, "holdings", (q: any) => inAccounts(q));
      done.push("investments & holdings");
    }

    if (scopes.has("recurring")) {
      await del(sb, "recurring_templates", byHh);
      done.push("recurring templates");
    }

    if (scopes.has("budgets")) {
      const { data: buds } = await sb.from("budgets").select("id").eq("household_id", hh);
      const budgetIds = (buds ?? []).map((b: any) => b.id);
      if (budgetIds.length) await del(sb, "budget_categories", (q: any) => q.in("budget_id", budgetIds));
      await del(sb, "budgets", byHh);
      done.push("budgets");
    }

    if (scopes.has("goals")) {
      const { data: gs } = await sb.from("goals").select("id").eq("household_id", hh);
      const goalIds = (gs ?? []).map((g: any) => g.id);
      if (goalIds.length) await del(sb, "goal_accounts", (q: any) => q.in("goal_id", goalIds));
      await del(sb, "goals", byHh);
      done.push("goals");
    }

    if (scopes.has("payees")) {
      await del(sb, "payee_rules", byHh);
      await del(sb, "memorized_payees", byHh);
      done.push("memorized payees & rules");
    }

    if (scopes.has("categories")) {
      await del(sb, "categories", byHh);
      done.push("categories");
    }

    if (scopes.has("snapshots")) {
      await del(sb, "net_worth_snapshots", byHh);
      done.push("net worth history");
    }

    if (scopes.has("dashboards")) {
      await del(sb, "dashboards", (q: any) => q.eq("user_id", context.userId));
      await del(sb, "transaction_views", (q: any) => q.eq("user_id", context.userId));
      done.push("dashboards & saved views");
    }

    if (scopes.has("reports")) {
      await del(sb, "report_jobs", (q: any) => q.eq("user_id", context.userId));
      await del(sb, "report_presets", (q: any) => q.eq("user_id", context.userId));
      done.push("report presets & exports");
    }

    if (scopes.has("chat")) {
      await del(sb, "chat_messages", byHh);
      await del(sb, "chat_threads", byHh);
      done.push("assistant chats");
    }

    if (scopes.has("import_rules")) {
      await del(sb, "import_rules", byHh);
      done.push("import rules");
    }

    if (scopes.has("accounts")) {
      await del(sb, "accounts", byHh);
      done.push("accounts");
    } else if (scopes.has("transactions") && accountIds.length) {
      // reset balances back to opening balance
      const { data: rows } = await sb.from("accounts").select("id, opening_balance").eq("household_id", hh);
      for (const r of rows ?? []) {
        await sb.from("accounts").update({ current_balance: r.opening_balance ?? 0 }).eq("id", r.id);
      }
    }

    await finishAudit(sb, auditId, { status: "success", deleted: done });
    return { ok: true, deleted: done, auditId };
    } catch (e: any) {
      await finishAudit(sb, auditId, { status: "failed", deleted: done, error: String(e?.message ?? e) });
      throw e;
    }
  });


export const resetAccountData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        account_id: z.string().uuid(),
        confirm: z.literal("DELETE"),
        transactions: z.boolean().default(true),
        bills: z.boolean().default(false),
        payees: z.boolean().default(false),
        investments: z.boolean().default(false),
        recurring: z.boolean().default(false),
        deleteAccount: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const hh = await getHouseholdId(context);
    const sb = context.supabase;
    const id = data.account_id;
    const done: string[] = [];

    const { data: acct, error: acctErr } = await sb
      .from("accounts")
      .select("id, name, opening_balance")
      .eq("id", id)
      .eq("household_id", hh)
      .maybeSingle();
    if (acctErr) throw acctErr;
    if (!acct) throw new Error("Account not found");

    const scopeList = (["transactions", "bills", "payees", "investments", "recurring"] as const).filter(
      (k) => data[k] || data.deleteAccount,
    );
    const auditId = await logAudit(sb, {
      household_id: hh,
      actor_id: context.userId,
      kind: data.deleteAccount ? "account_delete" : "account",
      scopes: scopeList,
      account_id: id,
      account_name: (acct as any).name ?? null,
      status: "running",
    });
    try {


    if (data.transactions || data.deleteAccount) {
      const { data: txns } = await sb
        .from("transactions")
        .select("id")
        .eq("household_id", hh)
        .or(`account_id.eq.${id},transfer_account_id.eq.${id}`);
      const ids = (txns ?? []).map((t: any) => t.id);
      if (ids.length) {
        await del(sb, "bill_payments", (q: any) => q.in("transaction_id", ids));
        await del(sb, "transaction_comments", (q: any) => q.in("transaction_id", ids));
        await del(sb, "transaction_activity", (q: any) => q.in("transaction_id", ids));
        await del(sb, "transaction_attachments", (q: any) => q.in("transaction_id", ids));
        await del(sb, "transactions", (q: any) => q.in("id", ids));
      }
      done.push(`${ids.length} transactions`);
    }

    if (data.bills || data.deleteAccount) {
      const { data: bills } = await sb.from("bills").select("id").eq("household_id", hh).eq("account_id", id);
      const billIds = (bills ?? []).map((b: any) => b.id);
      if (billIds.length) {
        await del(sb, "bill_reminder_sends", (q: any) => q.in("bill_id", billIds));
        await del(sb, "bill_payments", (q: any) => q.in("bill_id", billIds));
        await del(sb, "bills", (q: any) => q.in("id", billIds));
      }
      done.push(`${billIds.length} bills`);
    }

    if (data.payees || data.deleteAccount) {
      const { data: ps } = await sb.from("memorized_payees").select("id").eq("household_id", hh).eq("account_id", id);
      const payeeIds = (ps ?? []).map((p: any) => p.id);
      if (payeeIds.length) {
        await del(sb, "payee_rules", (q: any) => q.in("payee_id", payeeIds));
        await del(sb, "memorized_payees", (q: any) => q.in("id", payeeIds));
      }
      done.push(`${payeeIds.length} memorized payees`);
    }

    if (data.investments || data.deleteAccount) {
      const { data: holds } = await sb.from("holdings").select("id").eq("account_id", id);
      const holdingIds = (holds ?? []).map((h: any) => h.id);
      if (holdingIds.length) {
        await del(sb, "holding_transactions", (q: any) => q.in("holding_id", holdingIds));
        await del(sb, "holdings", (q: any) => q.in("id", holdingIds));
      }
      done.push(`${holdingIds.length} holdings`);
    }

    if (data.recurring || data.deleteAccount) {
      await del(sb, "recurring_templates", (q: any) => q.eq("household_id", hh).eq("account_id", id));
      done.push("recurring templates");
    }

    if (data.deleteAccount) {
      await del(sb, "accounts", (q: any) => q.eq("id", id).eq("household_id", hh));
      done.push("account");
    } else {
      await sb.from("accounts").update({ current_balance: acct.opening_balance ?? 0 }).eq("id", id);
    }

    return { ok: true, deleted: done, accountDeleted: data.deleteAccount };
  });
