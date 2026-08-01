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
});

async function del(supabase: any, table: string, apply: (q: any) => any) {
  const { error } = await apply(supabase.from(table).delete());
  if (error) throw new Error(`${table}: ${error.message}`);
}

export const resetHouseholdData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scopeSchema.parse(d))
  .handler(async ({ context, data }) => {
    const hh = await getHouseholdId(context);
    const sb = context.supabase;
    const scopes = new Set<ResetScope>(data.scopes);
    const done: string[] = [];
    const byHh = (q: any) => q.eq("household_id", hh);

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

    return { ok: true, deleted: done };
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
      .select("id, opening_balance")
      .eq("id", id)
      .eq("household_id", hh)
      .maybeSingle();
    if (acctErr) throw acctErr;
    if (!acct) throw new Error("Account not found");

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
