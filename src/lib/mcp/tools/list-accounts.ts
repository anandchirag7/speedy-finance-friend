import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "list_accounts",
  title: "List accounts",
  description:
    "List the signed-in user's financial accounts with balances, institution, currency and whether each is a liability.",
  inputSchema: {
    include_inactive: z.boolean().default(false).describe("Include closed/inactive accounts."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ include_inactive }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    let q = supabase
      .from("accounts")
      .select("id, name, institution, category, currency, current_balance, is_liability, is_active")
      .eq("household_id", householdId)
      .order("name");
    if (!include_inactive) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    return json(data ?? []);
  },
});
