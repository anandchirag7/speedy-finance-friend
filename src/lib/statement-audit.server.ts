/**
 * Server-only helpers for import auditing: duplicate explanations, re-parse
 * diffs, batch rollback and completion notifications.
 */

export type TxnLite = {
  id: string;
  txn_date: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  merchant: string | null;
  note: string | null;
  category_id: string | null;
  import_batch_id: string | null;
};

export type IncomingTxn = {
  key: string;
  date: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  description: string;
  merchant?: string | null;
  category_id?: string | null;
};

const DAY = 86_400_000;

function normText(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function daysApart(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 999;
  return Math.abs(t1 - t2) / DAY;
}

function money(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

/** Loads the existing transactions that could collide with an incoming batch. */
export async function loadWindow(
  supabase: any,
  householdId: string,
  accountId: string,
  rows: Array<{ date: string }>,
  padDays = 5,
): Promise<TxnLite[]> {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return [];
  const from = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - padDays * DAY)
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + padDays * DAY)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("transactions")
    .select("id, txn_date, amount, type, merchant, note, category_id, import_batch_id")
    .eq("household_id", householdId)
    .eq("account_id", accountId)
    .gte("txn_date", from)
    .lte("txn_date", to)
    .limit(20000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((t: any) => ({ ...t, amount: Number(t.amount) }));
}

export type DuplicateVerdict = {
  key: string;
  confidence: number;
  matchKeys: string[];
  reason: string;
  existing: { id: string; date: string; amount: number; merchant: string | null; note: string | null };
};

/**
 * Explains *why* an incoming row looks like a duplicate: which fields matched,
 * how confident the match is, and which stored transaction it collides with.
 */
export function explainDuplicates(incoming: IncomingTxn[], existing: TxnLite[]): DuplicateVerdict[] {
  const byExact = new Map<string, TxnLite[]>();
  const byAmount = new Map<string, TxnLite[]>();
  for (const t of existing) {
    const amtKey = `${money(t.amount)}|${t.type}`;
    const exact = `${t.txn_date}|${amtKey}`;
    (byExact.get(exact) ?? byExact.set(exact, []).get(exact)!).push(t);
    (byAmount.get(amtKey) ?? byAmount.set(amtKey, []).get(amtKey)!).push(t);
  }

  const out: DuplicateVerdict[] = [];
  for (const row of incoming) {
    const amtKey = `${money(row.amount)}|${row.type}`;
    const desc = normText(row.description);
    const payee = normText(row.merchant);

    const holder: { best?: DuplicateVerdict } = {};

    const consider = (t: TxnLite, sameDay: boolean) => {
      const keys = ["amount", "type"];
      let confidence = sameDay ? 0.62 : 0.45;
      if (sameDay) keys.unshift("date");
      else keys.push(`date ±${Math.round(daysApart(row.date, t.txn_date))}d`);

      const storedText = normText(t.note);
      if (desc && storedText && (storedText === desc || storedText.includes(desc) || desc.includes(storedText))) {
        confidence += 0.26;
        keys.push("description");
      }
      if (payee && normText(t.merchant) === payee) {
        confidence += 0.12;
        keys.push("payee");
      }
      if (row.category_id && t.category_id && row.category_id === t.category_id) {
        confidence += 0.02;
        keys.push("category");
      }
      confidence = Math.min(0.99, confidence);
      const cur = holder.best;
      if (!cur || confidence > cur.confidence) {
        holder.best = {
          key: row.key,
          confidence,
          matchKeys: keys,
          reason: `Matches an existing transaction on ${keys.join(" + ")}`,
          existing: {
            id: t.id,
            date: t.txn_date,
            amount: money(t.amount),
            merchant: t.merchant,
            note: t.note,
          },
        };
      }
    };

    for (const t of byExact.get(`${row.date}|${amtKey}`) ?? []) consider(t, true);
    if (!holder.best || holder.best.confidence < 0.8) {
      for (const t of byAmount.get(amtKey) ?? []) {
        const gap = daysApart(row.date, t.txn_date);
        if (gap === 0 || gap > 3) continue;
        consider(t, false);
      }
    }

    if (holder.best) out.push(holder.best);
  }
  return out;
}

export type DiffRow = {
  key: string;
  date: string;
  amount: number;
  type: string;
  description: string;
  status: "added" | "unchanged" | "changed";
  changes: Array<{ field: string; before: string; after: string }>;
  existingId?: string;
};

export type ReparseDiff = {
  added: DiffRow[];
  changed: DiffRow[];
  unchanged: DiffRow[];
  missing: Array<{ id: string; date: string; amount: number; merchant: string | null; note: string | null }>;
  counts: { added: number; changed: number; unchanged: number; missing: number; total: number };
};

/**
 * Before/after comparison between a freshly re-parsed statement and what is
 * already stored on the account.
 */
export function buildDiff(
  incoming: IncomingTxn[],
  existing: TxnLite[],
  opts: { batchId?: string | null } = {},
): ReparseDiff {
  const pool = new Map<string, TxnLite[]>();
  for (const t of existing) {
    const k = `${t.txn_date}|${money(t.amount)}|${t.type}`;
    (pool.get(k) ?? pool.set(k, []).get(k)!).push(t);
  }

  const added: DiffRow[] = [];
  const changed: DiffRow[] = [];
  const unchanged: DiffRow[] = [];
  const consumed = new Set<string>();

  for (const row of incoming) {
    const k = `${row.date}|${money(row.amount)}|${row.type}`;
    const candidates = (pool.get(k) ?? []).filter((t) => !consumed.has(t.id));
    const match =
      candidates.find((t) => normText(t.note) === normText(row.description)) ?? candidates[0];

    const base: DiffRow = {
      key: row.key,
      date: row.date,
      amount: money(row.amount),
      type: row.type,
      description: row.description,
      status: "added",
      changes: [],
    };

    if (!match) {
      added.push(base);
      continue;
    }
    consumed.add(match.id);

    const changes: DiffRow["changes"] = [];
    if (normText(match.note) !== normText(row.description)) {
      changes.push({ field: "Description", before: match.note ?? "—", after: row.description });
    }
    if (row.merchant !== undefined && normText(match.merchant) !== normText(row.merchant)) {
      changes.push({ field: "Payee", before: match.merchant ?? "—", after: row.merchant ?? "—" });
    }
    if (changes.length) {
      changed.push({ ...base, status: "changed", changes, existingId: match.id });
    } else {
      unchanged.push({ ...base, status: "unchanged", existingId: match.id });
    }
  }

  const missing = existing
    .filter((t) => !consumed.has(t.id) && (!opts.batchId || t.import_batch_id === opts.batchId))
    .map((t) => ({
      id: t.id,
      date: t.txn_date,
      amount: money(t.amount),
      merchant: t.merchant,
      note: t.note,
    }));

  const CAP = 500;
  return {
    added: added.slice(0, CAP),
    changed: changed.slice(0, CAP),
    unchanged: unchanged.slice(0, CAP),
    missing: missing.slice(0, CAP),
    counts: {
      added: added.length,
      changed: changed.length,
      unchanged: unchanged.length,
      missing: missing.length,
      total: incoming.length,
    },
  };
}

/** Recomputes and stores an account's running balance from its transactions. */
export async function recomputeAccountBalance(
  supabase: any,
  householdId: string,
  accountId: string,
): Promise<void> {
  const { data: acc } = await supabase
    .from("accounts")
    .select("opening_balance")
    .eq("id", accountId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!acc) return;
  const { data: txns } = await supabase
    .from("transactions")
    .select("type, amount, account_id, transfer_account_id")
    .eq("household_id", householdId)
    .or(`account_id.eq.${accountId},transfer_account_id.eq.${accountId}`);
  let balance = Number(acc.opening_balance ?? 0);
  for (const t of txns ?? []) {
    const amt = Number(t.amount);
    if (t.type === "income" && t.account_id === accountId) balance += amt;
    else if (t.type === "expense" && t.account_id === accountId) balance -= amt;
    else if (t.type === "transfer") {
      if (t.account_id === accountId) balance -= amt;
      if (t.transfer_account_id === accountId) balance += amt;
    }
  }
  await supabase.from("accounts").update({ current_balance: balance }).eq("id", accountId);
}

/**
 * Best-effort import notification email. Silently reports why it did not send
 * (no verified sending domain / preference off) instead of throwing.
 */
export async function sendImportEmail(opts: {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  ok: boolean;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) return { sent: false, reason: "Email sending is not configured for this app." };
  const domain = process.env['LOVABLE_EMAIL_DOMAIN'];
  if (!domain) {
    return { sent: false, reason: "No verified email domain is set up yet, so no email was sent." };
  }
  try {
    const { sendLovableEmail } = await import("@lovable.dev/email-js");
    const color = opts.ok ? "#0f766e" : "#b91c1c";
    const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
      <h2 style="color:${color};margin:0 0 12px">${opts.heading}</h2>
      <ul style="padding-left:18px;line-height:1.6">${opts.lines
        .map((l) => `<li>${l}</li>`)
        .join("")}</ul>
      <p style="color:#64748b;font-size:12px;margin-top:16px">Paisa · statement import notifications</p>
    </div>`;
    const res = await sendLovableEmail(
      {
        to: opts.to,
        from: `notifications@${domain}`,
        subject: opts.subject,
        html,
        text: `${opts.heading}\n\n${opts.lines.join("\n")}`,
        purpose: "statement-import-notification",
      },
      { apiKey },
    );
    return res?.success ? { sent: true } : { sent: false, reason: "The email provider rejected the message." };
  } catch (e: any) {
    return { sent: false, reason: e?.message ?? "Email sending failed." };
  }
}
