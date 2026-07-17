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

/**
 * Attempt to recover a JSON object from a possibly-truncated LLM response.
 * Walks the string tracking brackets/strings and truncates at the last
 * safe boundary, then closes any open arrays/objects.
 */
function salvageJson(raw: string): any | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const s = raw.slice(start);
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1; // index (exclusive) right after a completed value at depth >=1
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") { stack.push(c); continue; }
    if (c === "}" || c === "]") {
      stack.pop();
      lastSafe = i + 1;
      continue;
    }
    if (c === "," && stack.length > 0) {
      lastSafe = i; // safe to cut before the comma
    }
  }
  const tryParse = (str: string) => {
    try { return JSON.parse(str); } catch { return undefined; }
  };
  const attempts: string[] = [];
  if (lastSafe > 0) {
    // Rebuild bracket stack up to lastSafe
    const truncated = s.slice(0, lastSafe);
    const st: string[] = [];
    let inS = false, es = false;
    for (let i = 0; i < truncated.length; i++) {
      const c = truncated[i];
      if (inS) {
        if (es) es = false;
        else if (c === "\\") es = true;
        else if (c === '"') inS = false;
        continue;
      }
      if (c === '"') inS = true;
      else if (c === "{" || c === "[") st.push(c);
      else if (c === "}" || c === "]") st.pop();
    }
    let closed = truncated;
    for (let i = st.length - 1; i >= 0; i--) closed += st[i] === "{" ? "}" : "]";
    attempts.push(closed);
  }
  for (const a of attempts) {
    const v = tryParse(a);
    if (v) return v;
  }
  return null;
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

    // Load existing memorized payees so AI can reuse names
    const { data: existingPayees } = await context.supabase
      .from("memorized_payees")
      .select("id, merchant, category_id")
      .eq("household_id", householdId);
    const payeeList = (existingPayees ?? []).map((p: any) => p.merchant).join(", ");

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

    if (textContent.length > 60000) textContent = textContent.slice(0, 60000);

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const systemPrompt = `You extract bank/credit-card statement transactions, categorize them, and cluster descriptions by merchant/vendor.
Bank: ${data.bank}
Available categories: ${categoryList}
Existing memorized payees (reuse EXACT spelling when a description matches one of these): ${payeeList || "(none)"}

Return ONLY valid JSON matching this shape:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "raw narration/description from statement",
      "amount": 1234.56,
      "type": "income" | "expense" | "transfer",
      "suggestedCategory": "one of the available categories or a reasonable new name",
      "payee": "clean merchant/vendor name for this transaction"
    }
  ],
  "payees": [
    {
      "name": "clean merchant/vendor name (title case, human friendly, e.g. 'Amazon', 'Netflix', 'Uber')",
      "descriptions": ["raw description 1", "raw description 2"],
      "suggestedCategory": "best matching category",
      "type": "expense" | "income" | "transfer",
      "isExisting": true | false
    }
  ]
}
Rules:
- amount is always positive
- type: money in => income, money out => expense, transfers => transfer
- Ignore opening/closing balance rows, headers, footers
- Cluster descriptions belonging to the SAME real-world merchant into ONE payee entry (e.g. "AMZN Mktp IN*A12BC", "AMAZON PAY INDIA", "AMZ*SELLERXYZ" => one payee "Amazon")
- Every transaction's "payee" must equal exactly one payee entry's "name"
- If a description clearly matches an existing memorized payee, use that exact name and set isExisting=true
- Use short, clean, human-readable payee names — strip transaction ids, city codes, POS terminal numbers
- Do not invent transactions`;

    const userParts: any[] = [];
    if (isPdf) {
      userParts.push({ type: "text", text: "Extract transactions and cluster payees from this statement PDF." });
      userParts.push({
        type: "file",
        file: { filename: data.fileName, file_data: `data:application/pdf;base64,${data.base64}` },
      });
    } else {
      userParts.push({
        type: "text",
        text: `Statement contents (${isExcel ? "excel-as-csv" : "csv"}):\n\n${textContent}`,
      });
    }

    const model = isPdf ? "google/gemini-2.5-flash" : "google/gemini-2.5-flash";

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
        max_tokens: 32000,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI gateway failed [${res.status}]: ${body}`);
    }
    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = salvageJson(content) ?? { transactions: [], payees: [] };
    }
    const txns = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    let payees = Array.isArray(parsed.payees) ? parsed.payees : [];

    // Fallback: if AI omitted payees, derive from unique descriptions
    if (!payees.length && txns.length) {
      const seen = new Map<string, any>();
      for (const t of txns) {
        const name = t.payee || t.description || "Unknown";
        if (!seen.has(name)) {
          seen.set(name, {
            name,
            descriptions: [t.description],
            suggestedCategory: t.suggestedCategory,
            type: t.type,
            isExisting: false,
          });
        } else {
          seen.get(name).descriptions.push(t.description);
        }
      }
      payees = Array.from(seen.values());
    }

    return {
      transactions: txns as Array<{
        date: string;
        description: string;
        amount: number;
        type: "income" | "expense" | "transfer";
        suggestedCategory: string;
        payee: string;
      }>,
      payees: payees as Array<{
        name: string;
        descriptions: string[];
        suggestedCategory: string;
        type: "expense" | "income" | "transfer";
        isExisting: boolean;
      }>,
      categories: (cats ?? []) as Array<{ id: string; name: string; kind: string; parent_id: string | null }>,
      existingPayees: (existingPayees ?? []) as Array<{ id: string; merchant: string; category_id: string | null }>,
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
        merchant: z.string().max(200).nullable().optional(),
        note: z.string().max(500).optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
  newPayees: z
    .array(
      z.object({
        merchant: z.string().min(1).max(200),
        category_id: z.string().uuid().nullable().optional(),
        txn_type: z.enum(["expense", "income", "transfer"]).default("expense"),
      }),
    )
    .default([]),
});

export const bulkInsertTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bulkInput.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    // Create new memorized payees (skip if merchant already exists)
    if (data.newPayees.length) {
      const names = data.newPayees.map((p) => p.merchant);
      const { data: existing } = await context.supabase
        .from("memorized_payees")
        .select("merchant")
        .eq("household_id", householdId)
        .in("merchant", names);
      const existingSet = new Set((existing ?? []).map((r: any) => r.merchant));
      const rows = data.newPayees
        .filter((p) => !existingSet.has(p.merchant))
        .map((p) => ({
          merchant: p.merchant,
          category_id: p.category_id ?? null,
          txn_type: p.txn_type,
          household_id: householdId,
          created_by: context.userId,
          modified_by: context.userId,
          tags: [],
          splits: [],
          restrict_account_ids: [],
          currency: "INR",
        }));
      if (rows.length) {
        const { error } = await context.supabase.from("memorized_payees").insert(rows);
        if (error) throw error;
      }
    }

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
