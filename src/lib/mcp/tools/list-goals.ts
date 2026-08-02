import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "list_goals",
  title: "List savings goals",
  description: "List the signed-in user's savings goals with target amounts, saved amounts and target dates.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    const { data, error } = await supabase.from("goals").select("*").eq("household_id", householdId);
    if (error) throw new ToolError(error.message);
    return json(data ?? []);
  },
});
