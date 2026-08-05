/**
 * Client-safe statement file inspection.
 *
 * Runs entirely in the browser before the file is ever uploaded so Step 1 can
 * show format, bank, period, currency, page count, estimated row count and a
 * confidence score without waiting on the server.
 */

export type StatementFormat = "csv" | "xlsx" | "xls" | "pdf" | "ofx" | "qif" | "unknown";

export type StatementIssue = {
  level: "error" | "warning";
  code:
    | "unsupported"
    | "empty"
    | "corrupt"
    | "encrypted"
    | "bank-mismatch"
    | "duplicate"
    | "large";
  message: string;
};

export type StatementDetection = {
  format: StatementFormat;
  sizeBytes: number;
  bank: string | null;
  bankConfidence: number;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  pages: number | null;
  estimatedRows: number | null;
  confidence: number;
  fingerprint: string;
  issues: StatementIssue[];
};

const SUPPORTED: Record<string, StatementFormat> = {
  csv: "csv",
  txt: "csv",
  xlsx: "xlsx",
  xls: "xls",
  pdf: "pdf",
  ofx: "ofx",
  qfx: "ofx",
  qif: "qif",
};

/** Bank fingerprints — matched against file name and text sample. */
const BANK_SIGNATURES: Array<{ bank: string; patterns: RegExp[] }> = [
  { bank: "HDFC Bank", patterns: [/hdfc/i, /\bHDFC0\w+/] },
  { bank: "ICICI Bank", patterns: [/icici/i, /\bICIC0\w+/] },
  { bank: "State Bank of India", patterns: [/\bsbi\b/i, /state bank of india/i, /\bSBIN0\w+/] },
  { bank: "Axis Bank", patterns: [/axis bank/i, /\bUTIB0\w+/] },
  { bank: "Kotak Mahindra", patterns: [/kotak/i, /\bKKBK0\w+/] },
  { bank: "IDFC First", patterns: [/idfc/i, /\bIDFB0\w+/] },
  { bank: "Yes Bank", patterns: [/yes bank/i, /\bYESB0\w+/] },
  { bank: "IndusInd", patterns: [/indusind/i, /\bINDB0\w+/] },
  { bank: "Punjab National Bank", patterns: [/punjab national/i, /\bpnb\b/i, /\bPUNB0\w+/] },
  { bank: "Bank of Baroda", patterns: [/bank of baroda/i, /\bBARB0\w+/] },
  { bank: "American Express", patterns: [/american express/i, /\bamex\b/i] },
  { bank: "Citibank", patterns: [/citibank/i, /\bciti\b/i] },
  { bank: "HSBC", patterns: [/hsbc/i] },
  { bank: "Standard Chartered", patterns: [/standard chartered/i, /\bscb\b/i] },
];

const CURRENCY_SIGNATURES: Array<[RegExp, string]> = [
  [/₹|\bINR\b|\bRs\.?\b/i, "INR"],
  [/\bUSD\b|\$\s?\d/, "USD"],
  [/€|\bEUR\b/, "EUR"],
  [/£|\bGBP\b/, "GBP"],
  [/\bAED\b/, "AED"],
  [/\bSGD\b/, "SGD"],
];

export function formatOf(file: File): StatementFormat {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED[ext] ?? "unknown";
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readSlice(file: File, bytes: number): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => resolve("");
    reader.readAsText(file.slice(0, bytes), "utf-8");
  });
}

/**
 * Read a spreadsheet in the browser and flatten its cells into a text sample so
 * bank / period / currency detection works the same way it does for CSV.
 */
async function readSpreadsheet(
  file: File,
): Promise<{ text: string; rows: number; sheets: number } | null> {
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true, sheetRows: 5000 });
    const parts: string[] = [];
    let rows = 0;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      parts.push(name);
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      });
      rows += Math.max(0, aoa.length - 1);
      for (const r of aoa) parts.push(r.map((c) => String(c ?? "")).join(","));
      if (parts.length > 20000) break;
    }
    return { text: parts.join("\n"), rows, sheets: wb.SheetNames.length };
  } catch {
    return null;
  }
}


/** Cheap stable fingerprint (name + size + head bytes) used for duplicate detection. */
function fingerprintOf(file: File, sample: string): string {
  let h = 2166136261;
  const seed = `${file.name}|${file.size}|${sample.slice(0, 4096)}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const DATE_RE =
  /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\s-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]?\d{2,4})\b/gi;

function toIso(raw: string): string | null {
  const s = raw.replace(/\s+/g, "-");
  const iso = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]!;
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    // Prefer DD/MM (Indian statements); fall back when clearly MM/DD.
    const day = d > 12 ? d : m > 12 ? m : d;
    const month = d > 12 ? m : m > 12 ? d : m;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dmon = /^(\d{1,2})-([a-z]{3})[a-z]*-?(\d{2,4})?$/i.exec(s);
  if (dmon) {
    const mi = months.indexOf(dmon[2]!.toLowerCase());
    if (mi >= 0) {
      const y = dmon[3] ? (dmon[3].length === 2 ? `20${dmon[3]}` : dmon[3]) : String(new Date().getFullYear());
      return `${y}-${String(mi + 1).padStart(2, "0")}-${dmon[1]!.padStart(2, "0")}`;
    }
  }
  return null;
}

function detectPeriod(sample: string): { start: string | null; end: string | null } {
  const found: string[] = [];
  for (const m of sample.matchAll(DATE_RE)) {
    const iso = toIso(m[0]!);
    if (iso && iso >= "1990-01-01" && iso <= "2100-01-01") found.push(iso);
    if (found.length > 4000) break;
  }
  if (!found.length) return { start: null, end: null };
  found.sort();
  return { start: found[0]!, end: found[found.length - 1]! };
}

/**
 * Inspect a statement file in the browser. Text formats (CSV/OFX/QIF) yield
 * high-confidence metadata; PDF yields page count + encryption state; binary
 * spreadsheets are reported honestly with low confidence.
 */
export async function inspectStatementFile(
  file: File,
  opts: { selectedBank?: string; seenFingerprints?: string[] } = {},
): Promise<StatementDetection> {
  const format = formatOf(file);
  const issues: StatementIssue[] = [];
  const isText = format === "csv" || format === "ofx" || format === "qif";
  const isSheet = format === "xlsx" || format === "xls";
  const headSample = await readSlice(file, isText || format === "pdf" ? 1_500_000 : 8192);
  const sheet = isSheet ? await readSpreadsheet(file) : null;
  const sample = sheet ? sheet.text : headSample;
  const fingerprint = fingerprintOf(file, headSample);


  if (format === "unknown") {
    issues.push({
      level: "error",
      code: "unsupported",
      message: "Unsupported file. Upload CSV, XLS, XLSX, PDF, OFX or QIF.",
    });
  }
  if (file.size === 0) {
    issues.push({ level: "error", code: "empty", message: "This file is empty." });
  }
  if (file.size > 25 * 1024 * 1024) {
    issues.push({
      level: "warning",
      code: "large",
      message: "Large file — parsing runs in the background and may take a little longer.",
    });
  }

  let pages: number | null = null;
  if (format === "pdf") {
    if (!sample.startsWith("%PDF")) {
      issues.push({ level: "error", code: "corrupt", message: "This PDF looks corrupted or truncated." });
    }
    if (/\/Encrypt\b/.test(sample)) {
      issues.push({
        level: "error",
        code: "encrypted",
        message: "This PDF is password protected. Remove the password and re-upload.",
      });
    }
    const countMatch = /\/Count\s+(\d{1,5})/.exec(sample);
    const typePages = sample.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    pages = countMatch ? Number(countMatch[1]) : typePages || null;
  }

  if (isSheet) {
    if (format === "xlsx" && !headSample.startsWith("PK")) {
      issues.push({ level: "error", code: "corrupt", message: "This XLSX file looks corrupted." });
    } else if (!sheet) {
      issues.push({
        level: "error",
        code: "corrupt",
        message: "Could not read this spreadsheet. It may be corrupted or password protected.",
      });
    } else {
      pages = sheet.sheets || null;
    }
  }


  // Bank detection
  let bank: string | null = null;
  let bankConfidence = 0;
  const haystack = `${file.name}\n${sample.slice(0, 200_000)}`;
  for (const sig of BANK_SIGNATURES) {
    const hits = sig.patterns.filter((p) => p.test(haystack)).length;
    if (hits) {
      const score = Math.min(0.95, 0.6 + hits * 0.15);
      if (score > bankConfidence) {
        bank = sig.bank;
        bankConfidence = score;
      }
    }
  }
  if (bank && opts.selectedBank && opts.selectedBank !== "Other" && opts.selectedBank !== bank) {
    issues.push({
      level: "warning",
      code: "bank-mismatch",
      message: `File looks like a ${bank} statement but ${opts.selectedBank} is selected.`,
    });
  }

  // Currency
  let currency: string | null = null;
  for (const [re, code] of CURRENCY_SIGNATURES) {
    if (re.test(sample)) {
      currency = code;
      break;
    }
  }

  // Estimated rows
  let estimatedRows: number | null = null;
  if (format === "csv") {
    const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const perByte = sample.length ? lines.length / sample.length : 0;
    estimatedRows = Math.max(0, Math.round(perByte * file.size) - 4);
  } else if (format === "ofx") {
    estimatedRows = (sample.match(/<STMTTRN>/gi) ?? []).length || null;
  } else if (format === "qif") {
    estimatedRows = (sample.match(/^\^/gm) ?? []).length || null;
  } else if (format === "pdf" && pages) {
    estimatedRows = pages * 28;
  } else if (isSheet) {
    estimatedRows = sheet ? sheet.rows || null : Math.max(1, Math.round(file.size / 220));
  }

  const period =
    isText || format === "pdf" || sheet ? detectPeriod(sample) : { start: null, end: null };


  if (opts.seenFingerprints?.includes(fingerprint)) {
    issues.push({
      level: "warning",
      code: "duplicate",
      message: "You already imported this exact file in this session.",
    });
  }

  const signals = [bank ? 1 : 0, currency ? 1 : 0, period.start ? 1 : 0, estimatedRows ? 1 : 0];
  const base = isText ? 0.55 : format === "pdf" ? 0.45 : 0.3;
  const confidence = issues.some((i) => i.level === "error")
    ? 0
    : Math.min(0.98, base + signals.reduce((a, b) => a + b, 0) * 0.11);

  return {
    format,
    sizeBytes: file.size,
    bank,
    bankConfidence,
    currency,
    periodStart: period.start,
    periodEnd: period.end,
    pages,
    estimatedRows,
    confidence,
    fingerprint,
    issues,
  };
}
