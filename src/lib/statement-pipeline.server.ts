/**
 * Server-only orchestration for the statement upload pipeline.
 *
 * Synchronous phase (fast, always < a few seconds):
 *   parse -> normalize -> dedupe -> user override lookup -> dictionary lookup
 * Background phase (detached invocation):
 *   batched AI classification of unknown patterns, streamed to the client via
 *   realtime updates on `statement_uploads`.
 */

import { normalizePattern } from "./statement-normalize";
import { extractRowsFromAOA, parsePdfWithAI, type ExtractedTxn } from "./statement-parse.server";
import { resolveFromLookups, type ResolvedMap } from "./statement-classify.server";

export type PipelineTxn = ExtractedTxn & { pattern: string };

export type PendingPattern = { pattern: string; samples: string[]; type: string; count: number };

async function getHouseholdId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.default_household_id) throw new Error("No household");
  return data.default_household_id as string;
}

async function parseFile(
  supabase: any,
  householdId: string,
  input: { bank: string; fileName: string; mimeType: string; base64: string },
): Promise<ExtractedTxn[]> {
  const lower = input.fileName.toLowerCase();
  const isPdf = input.mimeType === "application/pdf" || lower.endsWith(".pdf");
  const isExcel =
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    input.mimeType.includes("spreadsheet") ||
    input.mimeType.includes("excel");
  const isCsv = lower.endsWith(".csv") || lower.endsWith(".txt") || input.mimeType.includes("csv");
  const isOfx = lower.endsWith(".ofx") || lower.endsWith(".qfx");
  const isQif = lower.endsWith(".qif");

  if (isOfx || isQif) {
    const { parseOfx, parseQif } = await import("./statement-parse-ofx.server");
    const text = Buffer.from(input.base64, "base64").toString("utf-8");
    return isOfx ? parseOfx(text) : parseQif(text);
  }


  if (isExcel) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(Buffer.from(input.base64, "base64"), { type: "buffer", cellDates: false });
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name]!, {
        header: 1,
        raw: true,
        blankrows: false,
      }) as any[][];
      const rows = extractRowsFromAOA(aoa);
      if (rows.length) return rows;
    }
    return [];
  }

  if (isCsv) {
    const XLSX = await import("xlsx");
    const text = Buffer.from(input.base64, "base64").toString("utf-8");
    const wb = XLSX.read(text, { type: "string" });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, {
      header: 1,
      raw: true,
      blankrows: false,
    }) as any[][];
    return extractRowsFromAOA(aoa);
  }

  if (isPdf) {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const { data: cats } = await supabase
      .from("categories")
      .select("name")
      .eq("household_id", householdId);
    const { transactions } = await parsePdfWithAI(
      input.base64,
      input.fileName,
      input.bank,
      (cats ?? []).map((c: any) => c.name).join(", "),
      "",
      apiKey,
    );
    return transactions;
  }

  throw new Error("Unsupported file type. Upload CSV, XLS, XLSX, PDF, OFX or QIF.");
}

export async function runStatementUpload(opts: {
  supabase: any;
  userId: string;
  input: { accountId: string; bank: string; fileName: string; mimeType: string; base64: string };
  origin: string;
}): Promise<{
  uploadId: string;
  transactions: PipelineTxn[];
  resolved: ResolvedMap;
  pending: PendingPattern[];
  categories: Array<{ id: string; name: string; kind: string; parent_id: string | null }>;
  existingPayees: Array<{ id: string; merchant: string; category_id: string | null }>;
}> {
  const { supabase, userId, input, origin } = opts;
  const householdId = await getHouseholdId(supabase, userId);
  const jobToken = crypto.randomUUID();

  const { data: uploadRow, error: insertError } = await supabase
    .from("statement_uploads")
    .insert({
      user_id: userId,
      household_id: householdId,
      filename: input.fileName,
      status: "parsing",
      result: { job_token: jobToken },
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  const uploadId = uploadRow.id as string;

  const fail = async (message: string) => {
    await supabase
      .from("statement_uploads")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("id", uploadId);
  };

  try {
    const extracted = await parseFile(supabase, householdId, input);
    if (!extracted.length) throw new Error("No transactions found in this file.");

    await supabase
      .from("statement_uploads")
      .update({ status: "deduplicating", total_transactions: extracted.length })
      .eq("id", uploadId);

    // Normalize + dedupe
    const transactions: PipelineTxn[] = extracted.map((t) => ({
      ...t,
      pattern: normalizePattern(t.description),
    }));

    const groups = new Map<string, PendingPattern>();
    for (const t of transactions) {
      const g = groups.get(t.pattern);
      if (g) {
        g.count += 1;
        if (g.samples.length < 3 && !g.samples.includes(t.description)) g.samples.push(t.description);
      } else {
        groups.set(t.pattern, {
          pattern: t.pattern,
          samples: [t.description],
          type: t.type,
          count: 1,
        });
      }
    }
    const patterns = Array.from(groups.keys());

    const { resolved, unresolved } = await resolveFromLookups(supabase, userId, patterns);
    const pending = unresolved.map((p) => groups.get(p)!).filter(Boolean);

    const needsAi = pending.length > 0;
    await supabase
      .from("statement_uploads")
      .update({
        status: needsAi ? "classifying" : "complete",
        unique_patterns: patterns.length,
        processed_transactions: needsAi ? 0 : patterns.length,
        result: {
          job_token: jobToken,
          resolved,
          pending: pending.map((p) => p.pattern),
        },
      })
      .eq("id", uploadId);

    if (needsAi) {
      // Detached invocation: keeps working even if the user closes the tab.
      void fetch(`${origin}/api/public/hooks/statement-classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, jobToken, pending }),
      }).catch(() => undefined);
    }

    const [{ data: cats }, { data: payeeRows }] = await Promise.all([
      supabase
        .from("categories")
        .select("id, name, kind, parent_id")
        .eq("household_id", householdId),
      supabase
        .from("memorized_payees")
        .select("id, merchant, category_id")
        .eq("household_id", householdId),
    ]);

    return {
      uploadId,
      transactions,
      resolved,
      pending,
      categories: (cats ?? []) as any,
      existingPayees: (payeeRows ?? []) as any,
    };
  } catch (e: any) {
    await fail(e?.message ?? "Statement processing failed");
    throw e;
  }
}

export async function saveCorrections(
  supabase: any,
  userId: string,
  corrections: Array<{ normalizedPattern: string; payeeName: string; category?: string | null }>,
) {
  const overrides = corrections.map((c) => ({
    user_id: userId,
    normalized_pattern: c.normalizedPattern,
    payee_name: c.payeeName,
    category: c.category ?? null,
  }));

  const { error } = await supabase
    .from("user_payee_overrides")
    .upsert(overrides, { onConflict: "user_id,normalized_pattern" });
  if (error) throw new Error(error.message);

  // Promote confirmed names into the shared dictionary (best effort).
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("global_merchant_dictionary").upsert(
      corrections.map((c) => ({
        normalized_pattern: c.normalizedPattern,
        canonical_payee_name: c.payeeName,
        suggested_category: c.category ?? null,
        confidence_source: "user_confirmed" as const,
      })),
      { onConflict: "normalized_pattern" },
    );
  } catch {
    // dictionary promotion is non-critical
  }

  return { saved: corrections.length };
}
