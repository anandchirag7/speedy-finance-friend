import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "list_categories",
  title: "List categories",
  description:
    "List the signed-in user's income and expense categories, including parent relationships, for categorizing transactions.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, kind, parent_id")
      .eq("household_id", householdId)
      .order("name")
      .limit(500);
    if (error) throw new ToolError(error.message);
    return json(data ?? []);
  },
});
