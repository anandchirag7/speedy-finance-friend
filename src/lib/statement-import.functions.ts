import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  extractRowsFromAOA,
  parsePdfWithAI,
  salvageJson,
  type ExtractedTxn,
} from "./statement-parse.server";

async function getHouseholdId(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data?.default_household_id) throw new Error("No household");
  return data.default_household_id as string;
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
  { words: ["SALARY", "PAYROLL", "WAGES", "BONUS"], categories: ["Salary", "Salary & Income", "Income"], type: "income" },
  { words: ["INTEREST", "DIVIDEND", "CASHBACK", "REFUND"], categories: ["Income", "Interest", "Refund", "Other Income"], type: "income" },
  { words: ["SWIGGY", "ZOMATO", "DOMINOS", "MCDONALD", "STARBUCKS", "RESTAURANT", "CAFE", "BAKERY", "FOOD"], categories: ["Food & Dining", "Food", "Dining", "Restaurants"] },
  { words: ["BLINKIT", "INSTAMART", "ZEPTO", "BIGBASKET", "GROCERY", "SUPERMARKET", "MART"], categories: ["Groceries", "Food & Dining"] },
  { words: ["UBER", "OLA", "RAPIDO", "METRO", "FUEL", "PETROL", "DIESEL", "PARKING", "FASTAG"], categories: ["Transport", "Fuel", "Travel"] },
  { words: ["AMAZON", "FLIPKART", "MYNTRA", "AJIO", "NYKAA", "SHOP", "MOTHERCARE", "RETAIL", "STORE"], categories: ["Shopping", "Kids & Family"] },
  { words: ["NETFLIX", "SPOTIFY", "HOTSTAR", "PRIME", "BOOKMYSHOW", "YOUTUBE"], categories: ["Entertainment", "Subscriptions"] },
  { words: ["AIRTEL", "JIO", "VI ", "VODAFONE", "MOBILE", "BROADBAND", "WIFI"], categories: ["Bills & Utilities", "Bills", "Utilities", "Phone"] },
  { words: ["ELECTRICITY", "WATER", "GAS", "BESCOM", "TATA POWER"], categories: ["Bills & Utilities", "Utilities", "Bills"] },
  { words: ["RENT", "MAINTENANCE", "SOCIETY"], categories: ["Housing & Rent", "Housing", "Rent"] },
  { words: ["OFFUS EMI", "MER EMI", "SMART EMI", "EMI", "LOAN"], categories: ["Loans & EMI", "Loan", "Debt"], type: "transfer" },
  { words: ["CREDIT CARD", "CC PAYMENT", "BPPY CC", "CRED"], categories: ["Transfers", "Credit Card", "Loan"], type: "transfer" },
  { words: ["HOSPITAL", "PHARMACY", "MEDICAL", "APOLLO", "MANIPAL", "PRACTO", "MEDPLUS", "CLINIC"], categories: ["Health & Medical", "Health", "Medical"] },
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



// ---------- Server functions ----------

const parseInput = z.object({
  accountId: z.string().uuid(),
  bank: z.string().min(1).max(100),
  fileName: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});

// ---------- AI Statement Metadata Inspection ----------

const inspectAiInput = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sampleText: z.string(),
});

export const inspectStatementWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inspectAiInput.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    const baseURL = process.env.OLLAMA_BASE_URL || "https://ai.gateway.lovable.dev/v1";
    const model = process.env.OLLAMA_MODEL || "google/gemini-2.5-flash";

    if (!apiKey && !process.env.OLLAMA_BASE_URL) return null;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Lovable-API-Key"] = apiKey;

    try {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: `You are an expert financial document parser. Analyze the provided bank or credit card statement content (file name and raw sample text) and extract statement metadata.
Return ONLY a valid JSON object matching this exact schema without markdown wrap or extra commentary:
{
  "bank": string or null (e.g. "HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank", "Kotak Mahindra", "American Express", "Citibank", "IDFC First", "Yes Bank", "IndusInd", "HSBC", "Standard Chartered"),
  "currency": string or null (e.g. "INR", "USD", "EUR", "GBP", "AED", "SGD"),
  "periodStart": string or null (ISO date "YYYY-MM-DD" representing statement start date or earliest transaction date),
  "periodEnd": string or null (ISO date "YYYY-MM-DD" representing statement end date or latest transaction date),
  "estimatedRows": number or null (estimated total count of financial transaction line items)
}

Rules:
- Search for dates in headers, titles, or date columns (e.g. "01/04/2024 to 30/04/2024", "Statement Date: 15-May-2024").
- Standardize all dates to YYYY-MM-DD format.
- If bank name is obvious from header or filename, use standard commercial bank name.`,
            },
            {
              role: "user",
              content: `Filename: ${data.fileName}\nContent Sample:\n${data.sampleText.slice(0, 6000)}`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) return { bank: null, currency: null, periodStart: null, periodEnd: null, estimatedRows: null };
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? "";
      let parsed = salvageJson(text) ?? (typeof json === "object" ? json : null);

      if (typeof parsed === "string") {
        parsed = salvageJson(parsed);
      }

      if (!parsed) return { bank: null, currency: null, periodStart: null, periodEnd: null, estimatedRows: null };

      // Normalize ISO dates if needed
      const normalizeDate = (d: any): string | null => {
        if (typeof d !== "string" || !d.trim()) return null;
        const str = d.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const dt = new Date(str);
        if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
        return null;
      };

      return {
        bank: typeof parsed.bank === "string" && parsed.bank.trim() ? parsed.bank.trim() : null,
        currency: typeof parsed.currency === "string" && parsed.currency.trim() ? parsed.currency.trim().toUpperCase() : null,
        periodStart: normalizeDate(parsed.periodStart),
        periodEnd: normalizeDate(parsed.periodEnd),
        estimatedRows: typeof parsed.estimatedRows === "number" ? parsed.estimatedRows : (typeof parsed.estimatedRows === "string" ? parseInt(parsed.estimatedRows, 10) || null : null),
      };
    } catch {
      return { bank: null, currency: null, periodStart: null, periodEnd: null, estimatedRows: null };
    }
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
      let wb: any;
      try {
        wb = XLSX.read(buf, { type: "buffer", cellDates: false });
      } catch {
        // Fallback for banks exporting text/HTML with .xls extension
        const text = buf.toString("utf-8");
        wb = XLSX.read(text, { type: "string" });
      }
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false }) as any[][];
        const rows = extractRowsFromAOA(aoa);
        extracted.push(...rows);
        if (extracted.length) break;
      }
    } else if (isCsv) {
      const XLSX = await import("xlsx");
      const text = Buffer.from(data.base64, "base64").toString("utf-8");
      let aoa: any[][] = [];
      try {
        const wb = XLSX.read(text, { type: "string" });
        aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false }) as any[][];
      } catch {
        // Line-by-line fallback for text files
        aoa = text.split(/\r?\n/).map((line) => line.split(/\t+|,/));
      }
      extracted = extractRowsFromAOA(aoa);
    } else if (isPdf) {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey && !process.env.OLLAMA_BASE_URL) throw new Error("Missing LOVABLE_API_KEY or OLLAMA_BASE_URL");
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
    const baseURL = process.env.OLLAMA_BASE_URL || "https://ai.gateway.lovable.dev/v1";
    const model = process.env.OLLAMA_MODEL || "google/gemini-2.5-flash";

    if (!apiKey && !process.env.OLLAMA_BASE_URL) throw new Error("Missing LOVABLE_API_KEY or OLLAMA_BASE_URL");

    const lines = data.clusters
      .map((c, i) => `${i}| ${c.name} | ${c.count} txns | e.g. ${c.sample.slice(0, 120)}`)
      .join("\n");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Lovable-API-Key"] = apiKey;

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
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
        split_parent_id: z.string().uuid().nullable().optional(),
        transfer_account_id: z.string().uuid().nullable().optional(),
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
  /** Idempotency: the token minted when the statement was parsed. */
  importToken: z.string().uuid().optional(),
  uploadId: z.string().uuid().optional(),
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

    // ---- Idempotency guard ----
    // A cancelled/retried import must never insert twice: the token minted at
    // parse time is claimed exactly once.
    let claimedUploadId: string | null = null;
    if (data.importToken) {
      const { data: upload, error: upErr } = await context.supabase
        .from("statement_uploads")
        .select("id, imported_at, inserted_count")
        .eq("import_token", data.importToken)
        .maybeSingle();
      if (upErr) throw new Error(upErr.message);
      if (upload?.imported_at) {
        return {
          ok: true,
          inserted: 0,
          alreadyImported: true,
          previouslyInserted: Number(upload.inserted_count ?? 0),
        };
      }
      claimedUploadId = (upload?.id as string) ?? data.uploadId ?? null;
    }



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

    // ---- Transaction inserts & EMI Hierarchy linking ----
    const batchId = data.importToken ?? crypto.randomUUID();
    const rawTxns = [...data.transactions];

    const cleanStr = (s: string) => (s ?? "").replace(/[^a-zA-Z0-9]+/g, " ").toUpperCase();

    // Helper to test if a row is an EMI loan disbursement credit
    const isEmiCredit = (t: any) => {
      const s = cleanStr(`${t.description ?? ""} ${t.merchant ?? ""} ${t.note ?? ""}`);
      return /AGGREGATOR.*EMI|OFFUS.*CREDIT|SMART.*EMI|EMI.*CONVERSION|LOAN.*CREDIT/i.test(s);
    };

    // Helper to test if a row is an EMI processing fee or installment row
    const isEmiChild = (t: any) => {
      const s = cleanStr(`${t.description ?? ""} ${t.merchant ?? ""} ${t.note ?? ""}`);
      return /OFFUS.*EMI|MER.*EMI|SMART.*EMI|EMI.*PRIN|EMI.*INT|PROCNG.*FEE|INSTALMENT|INSTALLMENT/i.test(s);
    };

    // Link parent debit purchase with child EMI transactions (disbursement, fee, installments)
    const emiGroups = new Map<number, number[]>(); // parentIdx -> childIndices[]
    for (let i = 0; i < rawTxns.length; i++) {
      if (isEmiCredit(rawTxns[i])) {
        const creditAmt = rawTxns[i].amount;
        let parentIdx = -1;
        let bestDiff = Infinity;

        // Search across all transactions in the batch for the matching purchase debit
        for (let j = 0; j < rawTxns.length; j++) {
          if (j === i) continue;
          if (isEmiChild(rawTxns[j]) || isEmiCredit(rawTxns[j])) continue;
          const candidateStr = cleanStr(`${(rawTxns[j] as any).description ?? rawTxns[j].note ?? ""} ${rawTxns[j].merchant ?? ""}`);
          const isParentType = rawTxns[j].type === "expense" || candidateStr.includes("MOTHERCARE");
          if (isParentType) {
            const diff = Math.abs(rawTxns[j].amount - creditAmt);
            if (diff < 500 && diff < bestDiff) {
              bestDiff = diff;
              parentIdx = j;
            }
          }
        }

        if (parentIdx >= 0) {
          if (!emiGroups.has(parentIdx)) emiGroups.set(parentIdx, []);
          emiGroups.get(parentIdx)!.push(i);

          // Tag any processing fee or installment rows in the batch
          for (let k = 0; k < rawTxns.length; k++) {
            if (k !== parentIdx && k !== i && isEmiChild(rawTxns[k])) {
              emiGroups.get(parentIdx)!.push(k);
            }
          }
        }
      }
    }

    try {
      // 1. Separate parents and standalone transactions from children that require split_parent_id
      const childIndices = new Set<number>();
      emiGroups.forEach((children) => children.forEach((c) => childIndices.add(c)));

      const parentTxns: any[] = [];
      const parentIndexMap = new Map<number, number>(); // originalIndex -> parentTxnsIndex

      rawTxns.forEach((t, idx) => {
        if (!childIndices.has(idx)) {
          parentIndexMap.set(idx, parentTxns.length);
          const isEmiParent = emiGroups.has(idx);
          parentTxns.push({
            ...t,
            account_id: data.accountId,
            household_id: householdId,
            created_by: context.userId,
            tags: isEmiParent ? ["EMI"] : [],
            import_batch_id: batchId,
            split_parent_id: t.split_parent_id ?? null,
            transfer_account_id: t.transfer_account_id ?? null,
          });
        }
      });

      // Insert parent/standalone transactions first and get inserted IDs
      const insertedParentsMap = new Map<number, string>(); // originalIndex -> insertedId
      const CHUNK = 500;
      for (let i = 0; i < parentTxns.length; i += CHUNK) {
        const slice = parentTxns.slice(i, i + CHUNK);
        const { data: inserted, error } = await context.supabase
          .from("transactions")
          .insert(slice)
          .select("id");
        if (error) throw error;
        (inserted ?? []).forEach((row: any, sliceIdx: number) => {
          const origIdx = Array.from(parentIndexMap.entries()).find(
            ([_, pIdx]) => pIdx === i + sliceIdx,
          )?.[0];
          if (origIdx != null) insertedParentsMap.set(origIdx, row.id);
        });
      }

      // 2. Insert child transactions with split_parent_id pointing to inserted parent ID
      const childTxns: any[] = [];
      emiGroups.forEach((childrenIndices, parentOrigIdx) => {
        const parentDbId = insertedParentsMap.get(parentOrigIdx);
        if (parentDbId) {
          childrenIndices.forEach((cIdx) => {
            const t = rawTxns[cIdx];
            childTxns.push({
              ...t,
              account_id: data.accountId,
              household_id: householdId,
              created_by: context.userId,
              tags: ["EMI"],
              import_batch_id: batchId,
              split_parent_id: parentDbId,
            });
          });
        }
      });

      for (let i = 0; i < childTxns.length; i += CHUNK) {
        const slice = childTxns.slice(i, i + CHUNK);
        const { error } = await context.supabase.from("transactions").insert(slice);
        if (error) throw error;
      }
    } catch (e: any) {
      // All-or-nothing: roll back
      await context.supabase.from("transactions").delete().eq("import_batch_id", batchId);
      throw new Error(
        `Import failed and was rolled back — no transactions were saved. ${e?.message ?? ""}`.trim(),
      );
    }

    if (claimedUploadId) {
      await context.supabase
        .from("statement_uploads")
        .update({
          status: "complete",
          imported_at: new Date().toISOString(),
          inserted_count: data.transactions.length,
          error: null,
        })
        .eq("id", claimedUploadId);
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
    return { ok: true, inserted: data.transactions.length, alreadyImported: false, batchId };
  });

