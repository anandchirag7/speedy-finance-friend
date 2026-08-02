import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { json, resolveHousehold } from "../supabase";

export default defineTool({
  name: "create_transaction",
  title: "Create transaction",
  description:
    "Record a new income or expense transaction in the signed-in user's ledger. Use list_accounts and list_categories first to get valid ids.",
  inputSchema: {
    account_id: z.string().uuid().describe("Account the transaction belongs to."),
    type: z.enum(["income", "expense"]),
    amount: z.number().positive().describe("Positive amount in the account's currency."),
    txn_date: z.string().describe("Transaction date, YYYY-MM-DD."),
    category_id: z.string().uuid().optional(),
    merchant: z.string().trim().min(1).optional().describe("Payee / merchant name."),
    note: z.string().trim().min(1).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const { supabase, householdId } = await resolveHousehold(ctx);
    const { data, error } = await supabase
      .from("transactions")
      .insert({
        household_id: householdId,
        account_id: input.account_id,
        type: input.type,
        amount: input.amount,
        txn_date: input.txn_date,
        category_id: input.category_id ?? null,
        merchant: input.merchant ?? null,
        note: input.note ?? null,
        created_by: ctx.getUserId() ?? null,
      })
      .select("id, txn_date, type, amount, merchant, note")
      .maybeSingle();
    if (error) throw new ToolError(error.message);
    return json(data);
  },
});
