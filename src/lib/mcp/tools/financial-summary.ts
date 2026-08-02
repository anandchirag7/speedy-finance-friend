import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "financial_summary",
  title: "Financial summary",
  description:
    "Snapshot of the signed-in user's finances: net worth (assets minus liabilities) and income, expense and savings for a period (defaults to the current month).",
  inputSchema: {
    since_date: z.string().optional().describe("YYYY-MM-DD, defaults to the first of the current month."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ since_date }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId, displayName } = await resolveHousehold(ctx);

    const monthStart = new Date();
    monthStart.setDate(1);
    const from = since_date ?? monthStart.toISOString().slice(0, 10);

    const [accountsRes, txnRes] = await Promise.all([
      supabase
        .from("accounts")
        .select("current_balance, is_liability, excluded_from_net_worth, is_active, currency")
        .eq("household_id", householdId),
      supabase.from("transactions").select("type, amount").eq("household_id", householdId).gte("txn_date", from),
    ]);
    if (accountsRes.error) throw new ToolError(accountsRes.error.message);
    if (txnRes.error) throw new ToolError(txnRes.error.message);

    let assets = 0;
    let liabilities = 0;
    for (const a of (accountsRes.data ?? []) as Array<Record<string, unknown>>) {
      if (!a.is_active || a.excluded_from_net_worth || a.currency !== "INR") continue;
      const balance = Number(a.current_balance ?? 0);
      if (a.is_liability) liabilities += Math.abs(balance);
      else assets += balance;
    }

    let income = 0;
    let expense = 0;
    for (const t of (txnRes.data ?? []) as Array<{ type: string; amount: number }>) {
      if (t.type === "income") income += Number(t.amount);
      else if (t.type === "expense") expense += Number(t.amount);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return json({
      user: displayName,
      currency: "INR",
      net_worth: round(assets - liabilities),
      assets: round(assets),
      liabilities: round(liabilities),
      period_from: from,
      income: round(income),
      expense: round(expense),
      savings: round(income - expense),
    });
  },
});
