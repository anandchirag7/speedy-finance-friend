import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getHouseholdId(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data?.default_household_id) throw new Error("No household");
  return data.default_household_id as string;
}

const parseInput = z.object({
  accountId: z.string().uuid(),
  bank: z.string().min(1).max(100),
  fileName: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});

export const parseStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => parseInput.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    // Load categories for context
    const { data: cats } = await context.supabase
      .from("categories")
      .select("id, name, kind, parent_id")
      .eq("household_id", householdId);
    const categoryList = (cats ?? []).map((c: any) => c.name).join(", ");

    const lower = data.fileName.toLowerCase();
    const isPdf = data.mimeType === "application/pdf" || lower.endsWith(".pdf");
    const isExcel =
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls") ||
      data.mimeType.includes("spreadsheet") ||
      data.mimeType.includes("excel");
    const isCsv = lower.endsWith(".csv") || data.mimeType.includes("csv");

    let textContent = "";

    if (isExcel) {
      const XLSX = await import("xlsx");
      const buf = Buffer.from(data.base64, "base64");
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheets = wb.SheetNames.map((n) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]);
        return `--- Sheet: ${n} ---\n${csv}`;
      });
      textContent = sheets.join("\n\n");
    } else if (isCsv) {
      textContent = Buffer.from(data.base64, "base64").toString("utf-8");
    }

    // Truncate to prevent huge prompts
    if (textContent.length > 60000) textContent = textContent.slice(0, 60000);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const systemPrompt = `You extract bank/credit-card statement transactions and categorize them.
Bank: ${data.bank}
Available categories: ${categoryList}

Return ONLY valid JSON matching this shape:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "raw narration/description",
      "amount": 1234.56,
      "type": "income" | "expense" | "transfer",
      "suggestedCategory": "one of the available categories or a reasonable new name"
    }
  ]
}
Rules:
- amount is always positive
- type: money in => income, money out => expense, transfers between own accounts => transfer
- Ignore opening/closing balance rows, headers, footers
- Use ISO date format
- Do not invent transactions`;

    const userParts: any[] = [];
    if (isPdf) {
      userParts.push({
        type: "text",
        text: "Extract transactions from this statement PDF.",
      });
      userParts.push({
        type: "file",
        file: {
          filename: data.fileName,
          file_data: `data:application/pdf;base64,${data.base64}`,
        },
      });
    } else {
      userParts.push({
        type: "text",
        text: `Statement contents (${isExcel ? "excel-as-csv" : "csv"}):\n\n${textContent}`,
      });
    }

    const model = isPdf ? "google/gemini-2.5-flash" : "openai/gpt-5.5";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userParts },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI gateway failed [${res.status}]: ${body}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { transactions: [] };
    }
    const txns = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    return {
      transactions: txns as Array<{
        date: string;
        description: string;
        amount: number;
        type: "income" | "expense" | "transfer";
        suggestedCategory: string;
      }>,
      categories: (cats ?? []) as Array<{ id: string; name: string; kind: string; parent_id: string | null }>,
    };
  });

const bulkInput = z.object({
  accountId: z.string().uuid(),
  transactions: z
    .array(
      z.object({
        txn_date: z.string(),
        amount: z.number().positive(),
        type: z.enum(["income", "expense", "transfer"]),
        category_id: z.string().uuid().nullable().optional(),
        note: z.string().max(500).optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export const bulkInsertTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bulkInput.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);
    const rows = data.transactions.map((t) => ({
      ...t,
      account_id: data.accountId,
      household_id: householdId,
      created_by: context.userId,
      tags: [],
    }));
    const { error } = await context.supabase.from("transactions").insert(rows);
    if (error) throw error;

    // Recompute account balance
    const { data: acc } = await context.supabase
      .from("accounts")
      .select("opening_balance")
      .eq("id", data.accountId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (acc) {
      const { data: txns } = await context.supabase
        .from("transactions")
        .select("type, amount, account_id, transfer_account_id")
        .eq("household_id", householdId)
        .or(`account_id.eq.${data.accountId},transfer_account_id.eq.${data.accountId}`);
      let balance = Number(acc.opening_balance ?? 0);
      for (const t of txns ?? []) {
        const amt = Number(t.amount);
        if (t.type === "income" && t.account_id === data.accountId) balance += amt;
        else if (t.type === "expense" && t.account_id === data.accountId) balance -= amt;
        else if (t.type === "transfer") {
          if (t.account_id === data.accountId) balance -= amt;
          if (t.transfer_account_id === data.accountId) balance += amt;
        }
      }
      await context.supabase
        .from("accounts")
        .update({ current_balance: balance })
        .eq("id", data.accountId);
    }
    return { ok: true, inserted: rows.length };
  });
