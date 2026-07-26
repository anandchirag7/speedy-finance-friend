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

const inputSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .default({});

export const getReportsData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const from = data.from ?? defaultFrom.toISOString().slice(0, 10);
    const to = data.to ?? today.toISOString().slice(0, 10);

    const s = context.supabase;
    const [
      accountsRes,
      categoriesRes,
      txnsRes,
      billsRes,
      billPaymentsRes,
      budgetsRes,
      budgetCatsRes,
      payeesRes,
      snapshotsRes,
      profileRes,
    ] = await Promise.all([
      s.from("accounts").select("*").eq("household_id", householdId),
      s.from("categories").select("*").eq("household_id", householdId),
      s
        .from("transactions")
        .select("*, category:categories(name, kind, parent_id), account:accounts!transactions_account_id_fkey(name, currency, category)")
        .eq("household_id", householdId)
        .gte("txn_date", from)
        .lte("txn_date", to)
        .order("txn_date", { ascending: false })
        .limit(20000),
      s.from("bills").select("*").eq("household_id", householdId),
      s.from("bill_payments").select("*").eq("household_id", householdId).gte("paid_on", from).lte("paid_on", to),
      s.from("budgets").select("*").eq("household_id", householdId),
      s.from("budget_categories").select("*"),
      s.from("memorized_payees").select("*").eq("household_id", householdId),
      s
        .from("net_worth_snapshots")
        .select("*")
        .eq("household_id", householdId)
        .gte("snapshot_date", from)
        .lte("snapshot_date", to)
        .order("snapshot_date", { ascending: true }),
      s.from("profiles").select("display_name, currency").eq("id", context.userId).maybeSingle(),
    ]);

    return {
      from,
      to,
      profile: profileRes.data ?? null,
      accounts: accountsRes.data ?? [],
      categories: categoriesRes.data ?? [],
      transactions: txnsRes.data ?? [],
      bills: billsRes.data ?? [],
      billPayments: billPaymentsRes.data ?? [],
      budgets: budgetsRes.data ?? [],
      budgetCategories: budgetCatsRes.data ?? [],
      payees: payeesRes.data ?? [],
      snapshots: snapshotsRes.data ?? [],
    };
  });

export type ReportsData = Awaited<ReturnType<typeof getReportsData>>;
