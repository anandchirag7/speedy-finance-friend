/**
 * Deterministic OFX/QFX and QIF statement parsers. No AI, no dependencies.
 */

import type { ExtractedTxn } from "./statement-parse.server";

function isoFromOfxDate(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function tagValues(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return m ? m[1]!.trim() : "";
}

/** Parse OFX 1.x (SGML) and 2.x (XML) statement transaction lists. */
export function parseOfx(text: string): ExtractedTxn[] {
  const out: ExtractedTxn[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0] ?? raw;
    const date = isoFromOfxDate(tagValues(block, "DTPOSTED") || tagValues(block, "DTUSER"));
    const amount = Number(tagValues(block, "TRNAMT").replace(/[, ]/g, ""));
    if (!date || !isFinite(amount) || amount === 0) continue;
    const description =
      [tagValues(block, "NAME"), tagValues(block, "MEMO"), tagValues(block, "PAYEE")]
        .filter(Boolean)
        .join(" ")
        .slice(0, 300) || "Transaction";
    const trnType = tagValues(block, "TRNTYPE").toUpperCase();
    const type: ExtractedTxn["type"] =
      trnType === "XFER" ? "transfer" : amount > 0 ? "income" : "expense";
    out.push({ date, description, amount: Math.abs(amount), type });
  }
  return out;
}

/** Parse QIF (Quicken Interchange Format) bank/CCard records. */
export function parseQif(text: string): ExtractedTxn[] {
  const out: ExtractedTxn[] = [];
  let cur: { date?: string; amount?: number; payee?: string; memo?: string } = {};

  const flush = () => {
    if (cur.date && cur.amount != null && isFinite(cur.amount) && cur.amount !== 0) {
      const description = [cur.payee, cur.memo].filter(Boolean).join(" ").slice(0, 300) || "Transaction";
      out.push({
        date: cur.date,
        description,
        amount: Math.abs(cur.amount),
        type: cur.amount > 0 ? "income" : "expense",
      });
    }
    cur = {};
  };

  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (l === "^") {
      flush();
      continue;
    }
    if (l.startsWith("!")) continue;
    const code = l[0];
    const value = l.slice(1).trim();
    if (code === "D") cur.date = isoFromQifDate(value) ?? undefined;
    else if (code === "T" || code === "U") cur.amount = Number(value.replace(/[, ]/g, ""));
    else if (code === "P") cur.payee = value;
    else if (code === "M") cur.memo = value;
  }
  flush();
  return out;
}

function isoFromQifDate(raw: string): string | null {
  const m = /^(\d{1,2})[\/\-.'](\d{1,2})[\/\-.'](\d{2,4})$/.exec(raw.replace(/\s/g, ""));
  if (m) {
    const yearRaw = m[3]!;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    // QIF is US-ordered (MM/DD) unless the first part clearly exceeds 12.
    const first = Number(m[1]);
    const second = Number(m[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const iso = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  return null;
}
