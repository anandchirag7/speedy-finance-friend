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

// ---------- Fast local payee clustering ----------

/** Aggressively normalize a raw description so near-duplicates collapse before we call the LLM. */
function normalizeDescForCluster(s: string): string {
  return s
    .toUpperCase()
    // strip long digit runs (txn ids, card tails, ref numbers)
    .replace(/\b\d{4,}\b/g, " ")
    // strip dates
    .replace(/\b\d{1,2}[\/\-][A-Z0-9]{2,}[\/\-]?\d{0,4}\b/g, " ")
    // strip common noise tokens
    .replace(/\b(UPI|NEFT|IMPS|RTGS|POS|ATM|TXN|REF|TRF|PAYMENT|PMT|PUR|DEBIT|CREDIT|INR|RS)\b/g, " ")
    .replace(/[^A-Z0-9&@ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const PAYMENT_NOISE = new Set([
  "UPI", "NEFT", "IMPS", "RTGS", "POS", "ATM", "TXN", "REF", "TRF", "PAYMENT", "PMT", "PUR", "DEBIT", "CREDIT",
  "INR", "RS", "DR", "CR", "ACH", "NACH", "ECS", "BIL", "BILL", "ONLINE", "BANK", "TRANSFER", "WDL", "WITHDRAWAL",
  "CARD", "VISA", "MASTERCARD", "RUPAY", "PAYTM", "PHONEPE", "GPAY", "GOOGLE", "BHIM", "PAY", "PVT", "LTD", "LIMITED",
  "PRIVATE", "INDIA", "IND", "MUMBAI", "BANGALORE", "BENGALURU", "DELHI", "CHENNAI", "HYDERABAD", "PUNE", "KOLKATA",
]);

const CATEGORY_HINTS: Array<{ words: string[]; categories: string[]; type?: "expense" | "income" | "transfer" }> = [
  { words: ["SALARY", "PAYROLL", "WAGES", "BONUS"], categories: ["Salary", "Income"], type: "income" },
  { words: ["INTEREST", "DIVIDEND", "CASHBACK", "REFUND"], categories: ["Income", "Interest", "Refund"], type: "income" },
  { words: ["SWIGGY", "ZOMATO", "DOMINOS", "MCDONALD", "STARBUCKS", "RESTAURANT", "CAFE"], categories: ["Food", "Dining", "Restaurants"] },
  { words: ["UBER", "OLA", "RAPIDO", "METRO", "FUEL", "PETROL", "DIESEL", "PARKING"], categories: ["Transport", "Travel", "Fuel"] },
  { words: ["AMAZON", "FLIPKART", "MYNTRA", "AJIO", "NYKAA", "SHOP"], categories: ["Shopping"] },
  { words: ["NETFLIX", "SPOTIFY", "HOTSTAR", "PRIME", "BOOKMYSHOW", "YOUTUBE"], categories: ["Entertainment", "Subscriptions"] },
  { words: ["AIRTEL", "JIO", "VI ", "VODAFONE", "MOBILE", "BROADBAND", "WIFI"], categories: ["Bills", "Utilities", "Phone"] },
  { words: ["ELECTRICITY", "WATER", "GAS", "BESCOM", "TATA POWER"], categories: ["Utilities", "Bills"] },
  { words: ["RENT", "MAINTENANCE", "SOCIETY"], categories: ["Rent", "Housing"] },
  { words: ["EMI", "LOAN", "CREDIT CARD", "CC PAYMENT"], categories: ["Loan", "Debt", "Credit Card"], type: "transfer" },
  { words: ["HOSPITAL", "PHARMACY", "MEDICAL", "APOLLO", "PRACTO"], categories: ["Health", "Medical"] },
  { words: ["SCHOOL", "COLLEGE", "TUITION", "COURSE", "UDEMY"], categories: ["Education"] },
];

function comparable(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function payeeKey(s: string): string {
  return comparable(s).replace(/\b(PVT|LTD|LIMITED|PRIVATE|INDIA|ONLINE|PAYMENTS?|BANK)\b/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\b(Upi|Imps|Neft|Rtgs|Atm|Emi|Hdfc|Icici|Sbi|Idfc|Pvt|Ltd)\b/g, (m) => m.toUpperCase());
}

function tokens(s: string): string[] {
  return comparable(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !PAYMENT_NOISE.has(t));
}

/**
 * Deterministically pull the most prominent (merchant-like) tokens out of a raw
 * narration. This is the clustering primitive — no AI involved.
 */
function prominentTokens(desc: string): string[] {
  const withHandlesExpanded = comparable(desc).replace(/\b([A-Z0-9._-]{3,})@[A-Z0-9._-]+\b/g, " $1 ");
  const segments = withHandlesExpanded
    .split(/[\/|*:_\-]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  let best: string[] = [];
  let bestScore = -1;
  for (const segment of segments.length ? segments : [withHandlesExpanded]) {
    const ts = tokens(segment);
    if (!ts.length) continue;
    const alpha = ts.filter((t) => /[A-Z]/.test(t)).length;
    const score = alpha * 3 + Math.min(ts.join(" ").length, 24) - (segment.match(/\d/g)?.length ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = ts.slice(0, 4);
    }
  }
  if (!best.length) best = tokens(normalizeDescForCluster(desc)).slice(0, 4);
  return best;
}

/**
 * Stable grouping key: the 1-2 most significant alphabetic tokens of the
 * narration. "SWIGGY BANGALORE 8891" and "UPI/SWIGGY ORDER/xyz" collapse to
 * the same key without any model call.
 */
function coreKey(desc: string): string {
  const ts = prominentTokens(desc).filter((t) => /^[A-Z][A-Z0-9&]*$/.test(t));
  if (!ts.length) return "";
  const ranked = [...ts].sort((a, b) => b.length - a.length);
  const primary = ranked[0];
  const secondary = ts.find((t) => t !== primary && t.length >= 4);
  return [primary, secondary].filter(Boolean).sort().join(" ");
}

function cleanPayeeName(desc: string): string {
  const best = prominentTokens(desc).join(" ");
  return titleCase(best || desc.slice(0, 60)).slice(0, 80);
}

function guessCategory(name: string, descriptions: string[], categories: Array<{ name: string; kind: string }>): string {
  const haystack = comparable(`${name} ${descriptions.join(" ")}`);
  const categoryNames = categories.map((c) => c.name);
  for (const hint of CATEGORY_HINTS) {
    if (!hint.words.some((w) => haystack.includes(w))) continue;
    const match = categoryNames.find((cat) => hint.categories.some((target) => cat.toLowerCase().includes(target.toLowerCase())));
    if (match) return match;
  }
  return "";
}

function inferType(descriptions: string[], typeByDesc: Map<string, "expense" | "income" | "transfer">): "expense" | "income" | "transfer" {
  const counts = { expense: 0, income: 0, transfer: 0 };
  for (const d of descriptions) counts[typeByDesc.get(d) ?? "expense"]++;
  if (counts.income > counts.expense && counts.income >= counts.transfer) return "income";
  if (counts.transfer > counts.expense && counts.transfer >= counts.income) return "transfer";
  const haystack = comparable(descriptions.join(" "));
  const hinted = CATEGORY_HINTS.find((h) => h.type && h.words.some((w) => haystack.includes(w)))?.type;
  return hinted ?? "expense";
}


type ExistingPayeeRich = { name: string; aliases: string[] };

type MatcherIndex = {
  fingerprintMap: Map<string, string>; // normalized alias -> payee name
  tokenIndex: Map<string, Set<string>>; // token -> candidate payee names
  byName: Map<string, { name: string; key: string; tokens: string[] }>;
};

function buildMatcherIndex(existing: ExistingPayeeRich[]): MatcherIndex {
  const fingerprintMap = new Map<string, string>();
  const tokenIndex = new Map<string, Set<string>>();
  const byName = new Map<string, { name: string; key: string; tokens: string[] }>();
  for (const p of existing) {
    const name = p.name;
    if (!name) continue;
    const nameTokens = tokens(name);
    const key = payeeKey(name);
    byName.set(name, { name, key, tokens: nameTokens });
    // seed tokens from name
    for (const t of nameTokens) {
      let set = tokenIndex.get(t);
      if (!set) { set = new Set(); tokenIndex.set(t, set); }
      set.add(name);
    }
    // seed fingerprints + tokens from aliases
    for (const a of p.aliases ?? []) {
      const fp = normalizeDescForCluster(a);
      if (fp) fingerprintMap.set(fp, name);
      for (const t of tokens(a)) {
        let set = tokenIndex.get(t);
        if (!set) { set = new Set(); tokenIndex.set(t, set); }
        set.add(name);
      }
    }
  }
  return { fingerprintMap, tokenIndex, byName };
}

function matchExistingPayee(desc: string, idx: MatcherIndex): string | null {
  // Stage 1: exact fingerprint hit — fastest, and handles "same statement next month".
  const fp = normalizeDescForCluster(desc);
  if (fp && idx.fingerprintMap.has(fp)) return idx.fingerprintMap.get(fp)!;

  // Stage 2: inverted-index candidates only.
  const descTokens = tokens(desc);
  if (!descTokens.length) return null;
  const candidates = new Set<string>();
  for (const t of descTokens) {
    const s = idx.tokenIndex.get(t);
    if (s) for (const n of s) candidates.add(n);
    if (candidates.size > 32) break; // cap
  }
  if (!candidates.size) return null;

  const descKey = payeeKey(desc);
  const descTokenSet = new Set(descTokens);
  let best: { name: string; score: number } | null = null;
  for (const name of candidates) {
    const p = idx.byName.get(name);
    if (!p || !p.key) continue;
    if (descKey.includes(p.key) || p.key.includes(descKey)) return p.name;
    const overlap = p.tokens.filter((t) => descTokenSet.has(t)).length;
    const score = overlap / Math.max(1, p.tokens.length);
    if (overlap > 0 && score > (best?.score ?? 0)) best = { name: p.name, score };
  }
  return best && best.score >= 0.67 ? best.name : null;
}

function clusterPayeesFast(
  descriptions: string[],
  categories: Array<{ name: string; kind: string }>,
  existingPayees: ExistingPayeeRich[],
  typeByDesc = new Map<string, "expense" | "income" | "transfer">(),
): Promise<Array<{ name: string; descriptions: string[]; suggestedCategory: string; type: "expense" | "income" | "transfer"; isExisting: boolean }>> {
  if (!descriptions.length) return Promise.resolve([]);

  const idx = buildMatcherIndex(existingPayees);
  const groups = new Map<string, { name: string; descriptions: Set<string>; isExisting: boolean }>();

  for (const d of descriptions) {
    const existing = matchExistingPayee(d, idx);
    const name = existing ?? cleanPayeeName(d);
    const key = existing
      ? `payee:${payeeKey(name)}`
      : coreKey(d) || payeeKey(name) || normalizeDescForCluster(d) || d.toUpperCase().slice(0, 60);
    const current = groups.get(key);
    if (current) {
      current.descriptions.add(d);
      if (existing && !current.isExisting) {
        current.name = existing;
        current.isExisting = true;
      }
    } else {
      groups.set(key, {
        name,
        descriptions: new Set([d]),
        isExisting: !!existing,
      });
    }
  }

  return Promise.resolve(Array.from(groups.values()).map((v) => {
    const descs = Array.from(v.descriptions);
    return {
      name: v.name,
      descriptions: descs,
      suggestedCategory: guessCategory(v.name, descs, categories),
      type: inferType(descs, typeByDesc),
      isExisting: v.isExisting,
    };
  }).sort((a, b) => b.descriptions.length - a.descriptions.length || a.name.localeCompare(b.name)));
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

/**
 * Step 1: fast deterministic extraction (CSV/Excel) or AI extraction (PDF).
 * No payee clustering — returns raw transactions + reference data for step 2.
 */
export const extractStatementRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => parseInput.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    const { data: cats } = await context.supabase
      .from("categories")
      .select("id, name, kind, parent_id")
      .eq("household_id", householdId);

    const { data: existingPayeesRows } = await context.supabase
      .from("memorized_payees")
      .select("id, merchant, category_id")
      .eq("household_id", householdId);
    const existingPayees = existingPayeesRows ?? [];

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
        if (extracted.length) break;
      }
    } else if (isCsv) {
      const XLSX = await import("xlsx");
      const text = Buffer.from(data.base64, "base64").toString("utf-8");
      const wb = XLSX.read(text, { type: "string" });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false }) as any[][];
      extracted = extractRowsFromAOA(aoa);
    } else if (isPdf) {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
      const categoryList = (cats ?? []).map((c: any) => c.name).join(", ");
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

    return {
      transactions: extracted,
      categories: (cats ?? []) as Array<{ id: string; name: string; kind: string; parent_id: string | null }>,
      existingPayees: existingPayees as Array<{ id: string; merchant: string; category_id: string | null }>,
    };
  });

const clusterInput = z.object({
  descriptions: z.array(z.string()).min(1).max(20000).default([]),
  transactions: z.array(z.object({
    description: z.string(),
    type: z.enum(["income", "expense", "transfer"]).optional(),
  })).optional(),
});

/**
 * Step 2: cluster unique descriptions into payees locally.
 */
export const clusterStatementPayees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clusterInput.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    const { data: cats } = await context.supabase
      .from("categories")
      .select("name, kind")
      .eq("household_id", householdId);
    const { data: existingPayeesRows } = await context.supabase
      .from("memorized_payees")
      .select("merchant, aliases")
      .eq("household_id", householdId);

    const sourceDescriptions = data.transactions?.length
      ? data.transactions.map((t) => t.description)
      : data.descriptions;
    const uniqueDescriptions = Array.from(new Set(sourceDescriptions));
    const typeByDesc = new Map<string, "expense" | "income" | "transfer">();
    for (const txn of data.transactions ?? []) {
      if (txn.type) typeByDesc.set(txn.description, txn.type);
    }
    const clusters = await clusterPayeesFast(
      uniqueDescriptions,
      (cats ?? []).map((c: any) => ({ name: c.name, kind: c.kind })),
      (existingPayeesRows ?? []).map((p: any) => ({
        name: p.merchant,
        aliases: Array.isArray(p.aliases) ? p.aliases : [],
      })),
      typeByDesc,
    );

    return { payees: clusters };
  });

const polishInput = z.object({
  clusters: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        sample: z.string().max(200).default(""),
        count: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1)
    .max(400),
});

/**
 * Step 3 (optional, user-triggered): AI *only* renames the already-formed
 * clusters and suggests merges. Payload is one line per cluster, so this stays
 * fast even for statements with thousands of rows.
 */
export const polishPayeeNames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => polishInput.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const lines = data.clusters
      .map((c, i) => `${i}| ${c.name} | ${c.count} txns | e.g. ${c.sample.slice(0, 120)}`)
      .join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You clean up merchant/payee names extracted from Indian bank statements.
Input lines: "index| current name | txn count | e.g. raw narration".
Return ONLY JSON:
{ "renames": { "<index>": "Proper Merchant Name" }, "merges": [[<index>, <index>, ...]] }
Rules:
- Use the real, well-known brand or person name (e.g. "SWIGGY LTD BANGALORE" -> "Swiggy", "AMAZON PAY IND" -> "Amazon").
- Keep names short (<= 40 chars), title case, no transaction ids, no city/bank noise.
- Only include an index in "renames" if the name actually improves.
- Put indexes that are clearly the SAME merchant into a merges group; keep merges conservative.
- Never invent merchants that are not implied by the input.`,
          },
          { role: "user", content: lines },
        ],
        response_format: { type: "json_object" },
        max_tokens: 8000,
      }),
    });
    if (!res.ok) throw new Error(`AI gateway failed [${res.status}]`);
    const j = await res.json();
    const content: string = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = salvageJson(content) ?? {};
    }

    const renames: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsed?.renames ?? {})) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx >= data.clusters.length) continue;
      const name = String(v ?? "").trim().slice(0, 80);
      if (name) renames[idx] = name;
    }
    const merges: number[][] = Array.isArray(parsed?.merges)
      ? parsed.merges
          .map((g: any) =>
            Array.isArray(g)
              ? Array.from(
                  new Set(
                    g
                      .map((n: any) => Number(n))
                      .filter((n: number) => Number.isInteger(n) && n >= 0 && n < data.clusters.length),
                  ),
                )
              : [],
          )
          .filter((g: number[]) => g.length > 1)
      : [];

    return { renames, merges };
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
  // Map of merchant name -> confirmed raw descriptions to learn as aliases.
  payeeAliases: z.record(z.string(), z.array(z.string())).default({}),
});

const MAX_ALIASES_PER_PAYEE = 50;

function dedupeAliases(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const fp = normalizeDescForCluster(raw);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    out.push(fp);
    if (out.length >= MAX_ALIASES_PER_PAYEE) break;
  }
  return out;
}

function matchTokensFor(name: string, aliases: string[]): string[] {
  const bag = new Set<string>();
  for (const t of tokens(name)) bag.add(t);
  for (const a of aliases) for (const t of tokens(a)) bag.add(t);
  return Array.from(bag);
}

export const bulkInsertTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => bulkInput.parse(d))
  .handler(async ({ context, data }) => {
    const householdId = await getHouseholdId(context);

    // ---- Payee alias learning ----
    // Fetch every payee we might touch (new + those receiving new aliases) in one call.
    const aliasKeys = Object.keys(data.payeeAliases ?? {}).map((k) => k.trim()).filter(Boolean);
    const newPayeeNames = data.newPayees.map((p) => p.merchant.trim()).filter(Boolean);
    const namesToLoad = Array.from(new Set([...aliasKeys, ...newPayeeNames]));

    let existingByName = new Map<string, { id: string; aliases: string[]; match_tokens: string[] }>();
    if (namesToLoad.length) {
      const { data: existing, error: exErr } = await context.supabase
        .from("memorized_payees")
        .select("id, merchant, aliases, match_tokens")
        .eq("household_id", householdId)
        .in("merchant", namesToLoad);
      if (exErr) throw exErr;
      for (const p of existing ?? []) {
        existingByName.set(p.merchant, {
          id: p.id,
          aliases: Array.isArray(p.aliases) ? p.aliases : [],
          match_tokens: Array.isArray(p.match_tokens) ? p.match_tokens : [],
        });
      }
    }

    // Insert new payees (skip ones that already exist).
    const insertRows = data.newPayees
      .filter((p) => !existingByName.has(p.merchant.trim()))
      .map((p) => {
        const name = p.merchant.trim();
        const seedAliases = dedupeAliases(data.payeeAliases[name] ?? []);
        return {
          merchant: name,
          category_id: p.category_id ?? null,
          txn_type: p.txn_type,
          household_id: householdId,
          created_by: context.userId,
          modified_by: context.userId,
          tags: [],
          splits: [],
          restrict_account_ids: [],
          currency: "INR",
          aliases: seedAliases,
          match_tokens: matchTokensFor(name, seedAliases),
        };
      });
    if (insertRows.length) {
      const { data: inserted, error } = await context.supabase
        .from("memorized_payees")
        .insert(insertRows)
        .select("id, merchant, aliases, match_tokens");
      if (error) throw error;
      for (const p of inserted ?? []) {
        existingByName.set(p.merchant, {
          id: p.id,
          aliases: Array.isArray(p.aliases) ? p.aliases : [],
          match_tokens: Array.isArray(p.match_tokens) ? p.match_tokens : [],
        });
      }
    }

    // Merge new aliases into every touched payee (new + pre-existing).
    for (const [name, descs] of Object.entries(data.payeeAliases ?? {})) {
      const key = name.trim();
      const target = existingByName.get(key);
      if (!target || !descs?.length) continue;
      const merged = dedupeAliases([...target.aliases, ...descs]);
      // Skip write when nothing new was learned.
      if (merged.length === target.aliases.length &&
          merged.every((a, i) => a === target.aliases[i])) continue;
      const nextTokens = matchTokensFor(key, merged);
      const { error: upErr } = await context.supabase
        .from("memorized_payees")
        .update({ aliases: merged, match_tokens: nextTokens, modified_by: context.userId })
        .eq("id", target.id);
      if (upErr) throw upErr;
    }

    // ---- Transaction inserts ----
    const rows = data.transactions.map((t) => ({
      ...t,
      account_id: data.accountId,
      household_id: householdId,
      created_by: context.userId,
      tags: [],
    }));

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

