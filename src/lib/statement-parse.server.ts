/**
 * Server-only statement parsing: deterministic CSV/Excel extraction plus
 * AI-assisted PDF extraction. Shared by the legacy import flow and the
 * fast upload pipeline.
 */

export type ExtractedTxn = {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer";
};

/**
 * Recover a JSON object from a possibly-truncated LLM response.
 */
export function salvageJson(raw: string): any | null {
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


const DATE_KEYS = ["date", "txn date", "transaction date", "value date", "posting date", "post date", "tran date", "trans date", "booking date"];
const DESC_KEYS = ["description", "narration", "particulars", "details", "transaction details", "remarks", "narrative", "reference", "memo", "payee"];
const DEBIT_KEYS = ["debit", "withdrawal", "withdrawal amount", "debit amount", "dr", "amount debit", "money out", "paid out", "spent"];
const CREDIT_KEYS = ["credit", "deposit", "deposit amount", "credit amount", "cr", "amount credit", "money in", "paid in", "received"];
const AMOUNT_KEYS = ["amount", "transaction amount", "amt", "value"];
const TYPE_KEYS = [
  "type",
  "dr/cr",
  "cr/dr",
  "drcr",
  "transaction type",
  "debit / credit",
  "debit/credit",
  "dr / cr",
  "cr / dr",
  "debit or credit",
  "dr or cr",
  "cr or dr",
];

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
  const nh = headers.map((h) => norm(h));
  for (const cand of candidates) {
    const i = nh.findIndex((h) => (h ?? "") === cand);
    if (i >= 0) return headers[i];
  }
  for (const cand of candidates) {
    const i = nh.findIndex((h) => (h ?? "").includes(cand));
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

export function extractRowsFromAOA(aoa: any[][]): ExtractedTxn[] {
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
        let foundType = false;
        if (ti >= 0) {
          const tv = norm(row[ti]);
          if (tv.startsWith("cr") || tv.includes("credit") || tv.includes("income")) {
            type = "income";
            foundType = true;
          } else if (tv.startsWith("dr") || tv.includes("debit") || tv.includes("expense")) {
            type = "expense";
            foundType = true;
          }
        }
        if (!foundType) {
          // Check explicit Cr tag in type column, last cell, or row text
          const lastCell = String(row[row.length - 1] ?? "").trim().toLowerCase();
          const rowStr = row.map((c) => String(c ?? "").trim()).join(" ");

          const isExplicitCr =
            lastCell === "cr" ||
            lastCell === "credit" ||
            /\bcr\b/i.test(rowStr) ||
            /cr$/i.test(rowStr.trim()) ||
            /\bcredit\b/i.test(rowStr);

          if (isExplicitCr) {
            type = "income";
          } else {
            type = "expense";
          }
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

// ---------- PDF: still needs AI for extraction ----------

export async function parsePdfWithAI(
  base64: string,
  fileName: string,
  bank: string,
  categoryList: string,
  payeeList: string,
  apiKey?: string,
): Promise<{ transactions: ExtractedTxn[] }> {
  const baseURL = process.env.OLLAMA_BASE_URL || "https://ai.gateway.lovable.dev/v1";
  const model = process.env.OLLAMA_MODEL || "google/gemini-2.5-flash";

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

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Lovable-API-Key"] = apiKey;

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
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
