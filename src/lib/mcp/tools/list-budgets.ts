import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "list_budgets",
  title: "List budgets",
  description: "List the signed-in user's budgets with limits, period and linked categories.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    const { data, error } = await supabase
      .from("budgets")
      .select("*, budget_categories(category_id, categories(name))")
      .eq("household_id", householdId);
    if (error) throw new ToolError(error.message);
    return json(data ?? []);
  },
});
