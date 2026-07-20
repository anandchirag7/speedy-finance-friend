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
 * Recover a JSON object from a possibly-truncated LLM response.
 */
function salvageJson(raw: string): any | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const s = raw.slice(start);
  const st: string[] = [];
  let inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") { st.push(c); continue; }
    if (c === "}" || c === "]") { st.pop(); lastSafe = i + 1; continue; }
    if (c === "," && st.length > 0) lastSafe = i;
  }
  if (lastSafe <= 0) return null;
  const truncated = s.slice(0, lastSafe);
  const stack2: string[] = [];
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
    else if (c === "{" || c === "[") stack2.push(c);
    else if (c === "}" || c === "]") stack2.pop();
  }
  let closed = truncated;
  for (let i = stack2.length - 1; i >= 0; i--) closed += stack2[i] === "{" ? "}" : "]";
  try { return JSON.parse(closed); } catch { return null; }
}

// ---------- Deterministic CSV/Excel row extraction ----------

type RawRow = Record<string, any>;
type ExtractedTxn = {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer";
};

const DATE_KEYS = ["date", "txn date", "transaction date", "value date", "posting date", "post date", "tran date", "trans date", "booking date"];
const DESC_KEYS = ["description", "narration", "particulars", "details", "transaction details", "remarks", "narrative", "reference", "memo", "payee"];
const DEBIT_KEYS = ["debit", "withdrawal", "withdrawal amount", "debit amount", "dr", "amount debit", "money out", "paid out", "spent"];
const CREDIT_KEYS = ["credit", "deposit", "deposit amount", "credit amount", "cr", "amount credit", "money in", "paid in", "received"];
const AMOUNT_KEYS = ["amount", "transaction amount", "amt", "value"];
const TYPE_KEYS = ["type", "dr/cr", "cr/dr", "drcr", "transaction type"];

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase().replace(/[_\-\s]+/g, " ");
}

function parseNumber(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  // (123.45) => -123.45
  const neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s);
  s = s.replace(/[()₹$€£¥,\s]/g, "").replace(/-$/, "");
  // strip currency codes
  s = s.replace(/^(inr|usd|eur|gbp|rs\.?)/i, "");
  const n = Number(s);
  if (!isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function parseDate(v: any): string | null {
  if (v == null || v === "") return null;
  // Excel numeric date
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // ISO
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    let [_, a, b, y] = m;
    let yr = Number(y);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    // Assume DD/MM/YYYY (Indian). If a > 12, definitely day.
    let day = Number(a), mon = Number(b);
    if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  // DD-Mon-YYYY
  const m2 = s.match(/^(\d{1,2})[\-\s]([A-Za-z]{3,})[\-\s](\d{2,4})/);
  if (m2) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const idx = months.indexOf(m2[2].slice(0,3).toLowerCase());
    if (idx >= 0) {
      let yr = Number(m2[3]);
      if (yr < 100) yr += yr < 50 ? 2000 : 1900;
      return `${yr}-${String(idx+1).padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function findKey(headers: string[], candidates: string[]): string | null {
  const nh = headers.map(norm);
  for (const cand of candidates) {
    const i = nh.findIndex((h) => h === cand);
    if (i >= 0) return headers[i];
  }
  for (const cand of candidates) {
    const i = nh.findIndex((h) => h.includes(cand));
    if (i >= 0) return headers[i];
  }
  return null;
}

/** Detect the header row in a sheet: pick the row that maximises known-column matches. */
function detectHeader(rows: any[][]): { headerIdx: number; headers: string[] } | null {
  let best = { idx: -1, score: 0, headers: [] as string[] };
  const scan = Math.min(rows.length, 25);
  for (let i = 0; i < scan; i++) {
    const row = (rows[i] ?? []).map((c) => String(c ?? "").trim());
    if (row.filter(Boolean).length < 3) continue;
    const nh = row.map(norm);
    let score = 0;
    const has = (arr: string[]) => arr.some((a) => nh.some((h) => h === a || h.includes(a)));
    if (has(DATE_KEYS)) score += 2;
    if (has(DESC_KEYS)) score += 2;
    if (has(DEBIT_KEYS)) score += 1;
    if (has(CREDIT_KEYS)) score += 1;
    if (has(AMOUNT_KEYS)) score += 1;
    if (score > best.score) best = { idx: i, score, headers: row };
  }
  if (best.score < 3) return null;
  return { headerIdx: best.idx, headers: best.headers };
}

function extractRowsFromAOA(aoa: any[][]): ExtractedTxn[] {
  const det = detectHeader(aoa);
  if (!det) return [];
  const { headerIdx, headers } = det;
  const dateKey = findKey(headers, DATE_KEYS);
  const descKey = findKey(headers, DESC_KEYS);
  const debitKey = findKey(headers, DEBIT_KEYS);
  const creditKey = findKey(headers, CREDIT_KEYS);
  const amountKey = findKey(headers, AMOUNT_KEYS);
  const typeKey = findKey(headers, TYPE_KEYS);
  if (!dateKey || !descKey || (!debitKey && !creditKey && !amountKey)) return [];

  const idx = (k: string | null) => (k ? headers.indexOf(k) : -1);
  const di = idx(dateKey), ei = idx(descKey), dbi = idx(debitKey), cri = idx(creditKey), ai = idx(amountKey), ti = idx(typeKey);

  const out: ExtractedTxn[] = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const date = parseDate(row[di]);
    const desc = String(row[ei] ?? "").trim();
    if (!date || !desc) continue;

    let amount: number | null = null;
    let type: "income" | "expense" | "transfer" = "expense";

    if (dbi >= 0 || cri >= 0) {
      const debit = dbi >= 0 ? parseNumber(row[dbi]) : null;
      const credit = cri >= 0 ? parseNumber(row[cri]) : null;
      if (debit && Math.abs(debit) > 0) { amount = Math.abs(debit); type = "expense"; }
      else if (credit && Math.abs(credit) > 0) { amount = Math.abs(credit); type = "income"; }
    }
    if (amount == null && ai >= 0) {
      const n = parseNumber(row[ai]);
      if (n != null && n !== 0) {
        amount = Math.abs(n);
        if (ti >= 0) {
          const tv = norm(row[ti]);
          if (tv.startsWith("cr") || tv.includes("credit") || tv.includes("income")) type = "income";
          else type = "expense";
        } else {
          type = n < 0 ? "expense" : "income";
        }
      }
    }
    if (amount == null || amount === 0) continue;

    // Skip balance / opening rows
    const dl = desc.toLowerCase();
    if (dl.includes("opening balance") || dl.includes("closing balance") || dl === "b/f" || dl === "c/f") continue;

    out.push({ date, description: desc, amount, type });
  }
  return out;
}

// ---------- LLM: cluster unique descriptions into payees ----------

async function clusterPayeesWithAI(
  descriptions: string[],
  categories: Array<{ name: string; kind: string }>,
  existingPayees: string[],
  apiKey: string,
): Promise<Array<{ name: string; descriptions: string[]; suggestedCategory: string; type: "expense" | "income" | "transfer"; isExisting: boolean }>> {
  if (!descriptions.length) return [];

  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < descriptions.length; i += CHUNK) chunks.push(descriptions.slice(i, i + CHUNK));

  const categoryList = categories.map((c) => c.name).join(", ");
  const payeeList = existingPayees.join(", ");

  const merged = new Map<string, { name: string; descriptions: Set<string>; suggestedCategory: string; type: "expense" | "income" | "transfer"; isExisting: boolean }>();

  const runChunk = async (chunk: string[]) => {
    const systemPrompt = `You cluster raw bank statement descriptions into clean merchant/vendor names.
Available categories: ${categoryList}
Existing memorized payees (reuse EXACT spelling when a description matches one of these): ${payeeList || "(none)"}

Return ONLY valid JSON:
{ "payees": [ { "name": "Amazon", "descriptions": ["AMZN Mktp IN*A12", "AMAZON PAY INDIA"], "suggestedCategory": "Shopping", "type": "expense", "isExisting": false } ] }

Rules:
- Cluster descriptions of the SAME real-world merchant into ONE payee.
- Use short, clean, human-readable payee names (title case). Strip transaction ids, city codes, POS numbers, dates.
- Every input description must appear in exactly one payee's descriptions[] array — do not drop any.
- type: expense (money out), income (money in), transfer (between own accounts).
- Match existing memorized payees exactly (case & spelling) and set isExisting=true when applicable.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Cluster these ${chunk.length} descriptions:\n${chunk.map((d, i) => `${i + 1}. ${d}`).join("\n")}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 16000,
      }),
    });
    if (!res.ok) {
      // fall through: treat each description as its own payee
      return chunk.map((d) => ({ name: d.slice(0, 60), descriptions: [d], suggestedCategory: "", type: "expense" as const, isExisting: false }));
    }
    const j = await res.json();
    const content: string = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = salvageJson(content) ?? {}; }
    const arr = Array.isArray(parsed?.payees) ? parsed.payees : [];
    if (!arr.length) return chunk.map((d) => ({ name: d.slice(0, 60), descriptions: [d], suggestedCategory: "", type: "expense" as const, isExisting: false }));
    return arr as Array<{ name: string; descriptions: string[]; suggestedCategory: string; type: "expense" | "income" | "transfer"; isExisting: boolean }>;
  };

  // Run chunks with limited concurrency (3)
  const results: Array<Awaited<ReturnType<typeof runChunk>>> = [];
  const CONC = 3;
  for (let i = 0; i < chunks.length; i += CONC) {
    const batch = chunks.slice(i, i + CONC);
    const r = await Promise.all(batch.map(runChunk));
    results.push(...r);
  }

  for (const clusters of results) {
    for (const c of clusters) {
      const key = (c.name || "").trim().toLowerCase();
      if (!key) continue;
      const existing = merged.get(key);
      if (existing) {
        for (const d of c.descriptions ?? []) existing.descriptions.add(d);
      } else {
        merged.set(key, {
          name: c.name.trim(),
          descriptions: new Set(c.descriptions ?? []),
          suggestedCategory: c.suggestedCategory ?? "",
          type: (c.type as any) ?? "expense",
          isExisting: !!c.isExisting,
        });
      }
    }
  }

  // Ensure every input description is present somewhere; add stragglers as their own payee
  const covered = new Set<string>();
  for (const v of merged.values()) for (const d of v.descriptions) covered.add(d);
  for (const d of descriptions) {
    if (!covered.has(d)) {
      const key = d.toLowerCase();
      merged.set(key, {
        name: d.slice(0, 60),
        descriptions: new Set([d]),
        suggestedCategory: "",
        type: "expense",
        isExisting: false,
      });
    }
  }

  return Array.from(merged.values()).map((v) => ({
    name: v.name,
    descriptions: Array.from(v.descriptions),
    suggestedCategory: v.suggestedCategory,
    type: v.type,
    isExisting: v.isExisting,
  }));
}

// ---------- PDF: still needs AI for extraction ----------

async function parsePdfWithAI(
  base64: string,
  fileName: string,
  bank: string,
  categoryList: string,
  payeeList: string,
  apiKey: string,
): Promise<{ transactions: ExtractedTxn[] }> {
  const systemPrompt = `You extract bank/credit-card statement transactions from a PDF.
Bank: ${bank}
Available categories: ${categoryList}
Existing memorized payees: ${payeeList || "(none)"}

Return ONLY valid JSON:
{ "transactions": [ { "date": "YYYY-MM-DD", "description": "raw narration", "amount": 1234.56, "type": "income" | "expense" | "transfer" } ] }
Rules:
- amount is always positive
- money out => expense, money in => income, own-account moves => transfer
- Ignore balance/header/footer rows
- Do not invent transactions`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract every transaction from this PDF statement." },
            { type: "file", file: { filename: fileName, file_data: `data:application/pdf;base64,${base64}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 32000,
    }),
  });
  if (!res.ok) throw new Error(`AI gateway failed [${res.status}]: ${await res.text()}`);
  const j = await res.json();
  const content: string = j.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try { parsed = JSON.parse(content); } catch { parsed = salvageJson(content) ?? { transactions: [] }; }
  const txns = Array.isArray(parsed.transactions) ? parsed.transactions : [];
  return {
    transactions: txns
      .filter((t: any) => t?.date && t?.description && t?.amount)
      .map((t: any) => ({
        date: String(t.date).slice(0, 10),
        description: String(t.description),
        amount: Math.abs(Number(t.amount)),
        type: (t.type as any) ?? "expense",
      })),
  };
}

// ---------- Server functions ----------

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

    const { data: cats } = await context.supabase
      .from("categories")
      .select("id, name, kind, parent_id")
      .eq("household_id", householdId);
    const categoryList = (cats ?? []).map((c: any) => c.name).join(", ");

    const { data: existingPayeesRows } = await context.supabase
      .from("memorized_payees")
      .select("id, merchant, category_id")
      .eq("household_id", householdId);
    const existingPayees = existingPayeesRows ?? [];

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const lower = data.fileName.toLowerCase();
    const isPdf = data.mimeType === "application/pdf" || lower.endsWith(".pdf");
    const isExcel =
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls") ||
      data.mimeType.includes("spreadsheet") ||
      data.mimeType.includes("excel");
    const isCsv = lower.endsWith(".csv") || data.mimeType.includes("csv");

    let extracted: ExtractedTxn[] = [];

    if (isExcel) {
      const XLSX = await import("xlsx");
      const buf = Buffer.from(data.base64, "base64");
      const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false }) as any[][];
        const rows = extractRowsFromAOA(aoa);
        extracted.push(...rows);
      }
    } else if (isCsv) {
      const XLSX = await import("xlsx");
      const text = Buffer.from(data.base64, "base64").toString("utf-8");
      const wb = XLSX.read(text, { type: "string" });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false }) as any[][];
      extracted = extractRowsFromAOA(aoa);
    } else if (isPdf) {
      const { transactions } = await parsePdfWithAI(
        data.base64,
        data.fileName,
        data.bank,
        categoryList,
        existingPayees.map((p: any) => p.merchant).join(", "),
        apiKey,
      );
      extracted = transactions;
    } else {
      throw new Error("Unsupported file type. Upload CSV, Excel, or PDF.");
    }

    if (!extracted.length) {
      return { transactions: [], payees: [], categories: cats ?? [], existingPayees };
    }

    // Cluster unique descriptions only — huge speedup on 1000+ row statements
    const uniqueDescriptions = Array.from(new Set(extracted.map((t) => t.description)));
    const clusters = await clusterPayeesWithAI(
      uniqueDescriptions,
      (cats ?? []).map((c: any) => ({ name: c.name, kind: c.kind })),
      existingPayees.map((p: any) => p.merchant),
      apiKey,
    );

    // Build description -> payee-name map
    const descToPayee = new Map<string, { name: string; category: string; type: "expense" | "income" | "transfer" }>();
    for (const c of clusters) {
      for (const d of c.descriptions) {
        descToPayee.set(d, { name: c.name, category: c.suggestedCategory, type: c.type });
      }
    }

    const transactions = extracted.map((t) => {
      const p = descToPayee.get(t.description);
      const payee = p?.name ?? t.description.slice(0, 60);
      const suggestedCategory = p?.category ?? "";
      // Prefer deterministic type from row; fall back to AI cluster type
      return {
        date: t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        suggestedCategory,
        payee,
      };
    });

    return {
      transactions,
      payees: clusters,
      categories: (cats ?? []) as Array<{ id: string; name: string; kind: string; parent_id: string | null }>,
      existingPayees: existingPayees as Array<{ id: string; merchant: string; category_id: string | null }>,
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
    .max(10000),
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

    // Chunked inserts to keep each request small
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await context.supabase.from("transactions").insert(slice);
      if (error) throw error;
    }

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
