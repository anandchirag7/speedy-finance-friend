import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { json, resolveHousehold } from "../supabase";

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default defineTool({
  name: "spending_by_category",
  title: "Spending by category",
  description:
    "Aggregate the signed-in user's expenses grouped by category for a period. Defaults to the current month.",
  inputSchema: {
    since_date: z.string().optional().describe("YYYY-MM-DD, defaults to the first of the current month."),
    until_date: z.string().optional().describe("YYYY-MM-DD, defaults to today."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ since_date, until_date }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    let q = supabase
      .from("transactions")
      .select("amount, category:categories(name)")
      .eq("household_id", householdId)
      .eq("type", "expense")
      .gte("txn_date", since_date ?? startOfMonth());
    if (until_date) q = q.lte("txn_date", until_date);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const agg: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ amount: number; category: { name?: string } | null }>) {
      const name = row.category?.name ?? "Uncategorized";
      agg[name] = (agg[name] ?? 0) + Number(row.amount);
    }
    const rows = Object.entries(agg)
      .sort((a, b) => b[1] - a[1])
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }));
    return json({ from: since_date ?? startOfMonth(), to: until_date ?? null, currency: "INR", categories: rows });
  },
});
