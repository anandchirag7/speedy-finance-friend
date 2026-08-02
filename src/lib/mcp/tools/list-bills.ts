import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "list_bills",
  title: "List bills",
  description: "List the signed-in user's bills and reminders with due dates, amounts and recurrence.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    const { data, error } = await supabase.from("bills").select("*").eq("household_id", householdId);
    if (error) throw new ToolError(error.message);
    return json(data ?? []);
  },
});
