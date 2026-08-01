/**
 * Pure, dependency-free normalization used by the statement upload pipeline.
 * No network calls, no AI — thousands of rows normalize in milliseconds.
 */

/** Canonical category list used for AI classification + dictionary entries. */
export const PIPELINE_CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Fuel",
  "Travel",
  "Shopping",
  "Bills & Utilities",
  "Housing & Rent",
  "Health & Medical",
  "Personal Care",
  "Education",
  "Kids & Family",
  "Entertainment",
  "Subscriptions",
  "Insurance",
  "Investments",
  "Loans & EMI",
  "Fees & Charges",
  "Taxes",
  "Gifts & Donations",
  "Business",
  "Cash & ATM",
  "Transfers",
  "Salary & Income",
  "Other Income",
  "Uncategorized",
] as const;

export type PipelineCategory = (typeof PIPELINE_CATEGORIES)[number];

/** Prefixes banks staple onto narrations. */
const PREFIXES =
  /^(?:UPI|NEFT|IMPS|RTGS|ECS|ACH|ACHD|ACHC|POS|ATW|ATM|CHQ|MMT|INF|IB|NWD|BIL|BRN|VPS|EDC|TPT|SI)\b[\s\-:/]*/i;

/** Noise tokens that never help identify a merchant. */
const NOISE_TOKENS = new Set([
  "UPI",
  "NEFT",
  "IMPS",
  "RTGS",
  "ECS",
  "ACH",
  "POS",
  "ATM",
  "TXN",
  "TRAN",
  "TRANS",
  "REF",
  "REFNO",
  "TRF",
  "TRANSFER",
  "PAYMENT",
  "PAYMENTS",
  "PMT",
  "PUR",
  "PURCHASE",
  "DEBIT",
  "CREDIT",
  "DR",
  "CR",
  "INR",
  "RS",
  "ONLINE",
  "BANK",
  "CARD",
  "VISA",
  "MASTERCARD",
  "RUPAY",
  "PVT",
  "PVTLTD",
  "LTD",
  "LIMITED",
  "PRIVATE",
  "COLLECT",
  "COLLECTION",
  "MANDATE",
  "AUTOPAY",
  "AUTO",
  "PAY",
  "PAID",
  "TO",
  "FROM",
  "VIA",
  "THE",
  "AND",
  "OF",
  "FOR",
]);

/** Geography / generic tail tokens: kept out of the pattern so the same
 * merchant in two cities collapses to one entry. */
const GEO_TOKENS = new Set([
  "INDIA",
  "IND",
  "IN",
  "MUMBAI",
  "DELHI",
  "NEWDELHI",
  "BANGALORE",
  "BENGALURU",
  "BLR",
  "CHENNAI",
  "HYDERABAD",
  "HYD",
  "PUNE",
  "KOLKATA",
  "GURGAON",
  "GURUGRAM",
  "NOIDA",
  "AHMEDABAD",
  "JAIPUR",
  "KOCHI",
  "SURAT",
  "LUCKNOW",
  "INDORE",
  "CHANDIGARH",
  "NAGPUR",
  "COIMBATORE",
  "ORDER",
  "ORDERS",
  "STORE",
  "STORES",
  "BILLDESK",
  "RAZORPAY",
  "PAYU",
  "CCAVENUE",
  "MERCHANT",
  "SERVICES",
  "SERVICE",
  "TECHNOLOGIES",
  "TECHNOLOGY",
  "SOLUTIONS",
  "ENTERPRISES",
  "PH",
]);


/**
 * Turn a raw bank narration into a stable, comparable merchant pattern.
 *
 * Applies, in order: prefix stripping, IFSC/branch-code stripping, UPI handle
 * reduction, date stripping, reference/transaction-id stripping, long numeric
 * run stripping, punctuation collapse, noise-token removal, uppercase + trim.
 */
export function normalizePattern(raw: string): string {
  if (!raw) return "";

  let s = String(raw).toUpperCase();

  // Strip repeated leading channel prefixes: "UPI-NEFT-ACME" -> "ACME"
  for (let i = 0; i < 4; i++) {
    const next = s.replace(PREFIXES, "");
    if (next === s) break;
    s = next;
  }

  // Bank/branch (IFSC-like) codes: HDFC0000104, XXXX0000104, SBIN0001234
  s = s.replace(/\b[A-Z]{2,6}[0O]{2,}\d{3,}\b/g, " ");
  s = s.replace(/\bX{3,}\d*\b/g, " ");

  // UPI handles: keep the handle name, drop the PSP suffix -> "SWIGGY@OKICICI" -> "SWIGGY"
  s = s.replace(/\b([A-Z][A-Z0-9.\-_]{2,})@[A-Z0-9.\-_]+\b/g, " $1 ");
  // Bare numeric VPAs (phone@upi) are pure noise
  s = s.replace(/\b\d[\d.\-_]{5,}@[A-Z0-9.\-_]+\b/g, " ");

  // Dates in any common shape
  s = s.replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, " ");
  s = s.replace(/\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g, " ");
  s = s.replace(
    /\b\d{1,2}[-\s](?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-\s]?\d{0,4}\b/g,
    " ",
  );

  // Explicit reference markers and everything glued to them
  s = s.replace(/\b(?:REF|REFNO|RRN|UTR|TXN|TID|MID|SEQ|NO|ID)[\s:#\-/]*[A-Z0-9]{4,}\b/g, " ");

  // Long numeric / alphanumeric runs = transaction ids, card tails, account numbers
  s = s.replace(/\b\d{4,}\b/g, " ");
  s = s.replace(/\b(?=[A-Z0-9]{6,}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g, " ");

  // Punctuation -> space (keep & and spaces)
  s = s.replace(/[^A-Z0-9& ]+/g, " ");

  // Drop noise tokens and 1-char fragments
  const kept = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));

  let out = kept.join(" ").replace(/\s+/g, " ").trim();

  // Nothing meaningful left — fall back to a coarse cleanup of the original so
  // distinct narrations don't all collapse into one empty bucket.
  if (!out) {
    out = String(raw)
      .toUpperCase()
      .replace(/[^A-Z0-9& ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return out.slice(0, 120);
}

/** Split an array into fixed-size chunks. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run async tasks with a bounded number of in-flight promises. */
export async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}
