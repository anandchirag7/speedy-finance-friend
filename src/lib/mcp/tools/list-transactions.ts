import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "list_transactions",
  title: "List transactions",
  description:
    "List the signed-in user's transactions, newest first. Filter by date range, type, account or free-text search on note/merchant.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).default(25),
    since_date: z.string().optional().describe("Only transactions on or after this date (YYYY-MM-DD)."),
    until_date: z.string().optional().describe("Only transactions on or before this date (YYYY-MM-DD)."),
    type: z.enum(["income", "expense", "transfer"]).optional(),
    account_id: z.string().uuid().optional(),
    search: z.string().optional().describe("Substring match on note or merchant."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, since_date, until_date, type, account_id, search }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    let q = supabase
      .from("transactions")
      .select(
        "id, txn_date, type, amount, note, merchant, cleared_status, category:categories(name), account:accounts!transactions_account_id_fkey(name)",
      )
      .eq("household_id", householdId)
      .order("txn_date", { ascending: false })
      .limit(limit);
    if (since_date) q = q.gte("txn_date", since_date);
    if (until_date) q = q.lte("txn_date", until_date);
    if (type) q = q.eq("type", type);
    if (account_id) q = q.eq("account_id", account_id);
    if (search) q = q.or(`note.ilike.%${search}%,merchant.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    return json(data ?? []);
  },
});
