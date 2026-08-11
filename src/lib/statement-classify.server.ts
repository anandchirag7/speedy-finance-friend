/**
 * Server-only merchant resolution for the statement upload pipeline.
 *
 * Layer 1: user overrides (personal, always wins)
 * Layer 2: global merchant dictionary (shared, seeded + AI-grown)
 * Layer 3: batched AI classification (runs in the background, never blocks)
 */

import {
  chunk,
  lookupKeys,
  titleCase,
  withConcurrency,
  PIPELINE_CATEGORIES,
} from "./statement-normalize";

export type ResolvedMerchant = {
  payee: string;
  category: string | null;
  source: "user" | "dictionary" | "ai" | "pending";
};

export type ResolvedMap = Record<string, ResolvedMerchant>;

/** Resolve patterns against user overrides + global dictionary (no AI). */
export async function resolveFromLookups(
  supabase: any,
  userId: string,
  patterns: string[],
): Promise<{ resolved: ResolvedMap; unresolved: string[] }> {
  const resolved: ResolvedMap = {};
  if (!patterns.length) return { resolved, unresolved: [] };

  // Every candidate key for every pattern (pattern, first-3, first-2, first token)
  const keySet = new Set<string>();
  const keysByPattern = new Map<string, string[]>();
  for (const p of patterns) {
    const keys = lookupKeys(p);
    keysByPattern.set(p, keys);
    for (const k of keys) keySet.add(k);
  }
  const allKeys = Array.from(keySet);

  const overrideMap = new Map<string, { payee: string | null; category: string | null }>();
  const memorizedMap = new Map<string, { payee: string; category: string | null }>();
  const dictMap = new Map<string, { payee: string; category: string | null }>();

  for (const part of chunk(allKeys, 400)) {
    const [{ data: overrides }, { data: memorized }, { data: dict }] = await Promise.all([
      supabase
        .from("user_payee_overrides")
        .select("normalized_pattern, payee_name, category")
        .eq("user_id", userId)
        .in("normalized_pattern", part),
      supabase
        .from("memorized_payees")
        .select("merchant, name, aliases, category_id"),
      supabase
        .from("global_merchant_dictionary")
        .select("normalized_pattern, canonical_payee_name, suggested_category")
        .in("normalized_pattern", part),
    ]);
    for (const o of overrides ?? []) {
      overrideMap.set(o.normalized_pattern, { payee: o.payee_name, category: o.category });
    }
    for (const m of memorized ?? []) {
      const payeeName = m.merchant || m.name;
      if (payeeName) {
        if (m.aliases && Array.isArray(m.aliases)) {
          for (const alias of m.aliases) {
            if (alias) memorizedMap.set(alias.trim().toUpperCase(), { payee: payeeName, category: m.category_id });
          }
        }
        if (m.merchant) memorizedMap.set(m.merchant.trim().toUpperCase(), { payee: payeeName, category: m.category_id });
      }
    }
    for (const d of dict ?? []) {
      dictMap.set(d.normalized_pattern, {
        payee: d.canonical_payee_name,
        category: d.suggested_category,
      });
    }
  }

  const unresolved: string[] = [];

  for (const p of patterns) {
    const keys = keysByPattern.get(p) ?? [p];
    let hit: ResolvedMerchant | null = null;
    for (const k of keys) {
      const o = overrideMap.get(k);
      if (o?.payee) {
        hit = { payee: o.payee, category: o.category ?? null, source: "user" };
        break;
      }
      const m = memorizedMap.get(k.toUpperCase());
      if (m?.payee) {
        hit = { payee: m.payee, category: m.category ?? null, source: "user" };
        break;
      }
    }
    if (!hit) {
      for (const k of keys) {
        const d = dictMap.get(k);
        if (d) {
          hit = { payee: d.payee, category: d.category ?? null, source: "dictionary" };
          break;
        }
      }
    }
    if (hit) resolved[p] = hit;
    else unresolved.push(p);
  }

  return { resolved, unresolved };
}

const AI_MODEL = "google/gemini-2.5-flash-lite";
const BATCH_SIZE = 80;
const CONCURRENCY = 4;

type Sample = { pattern: string; samples: string[]; type: string };

/** Ask the model to name + categorise one batch of unknown patterns. */
async function classifyBatch(batch: Sample[], apiKey?: string): Promise<ResolvedMap> {
  const baseURL = process.env.OLLAMA_BASE_URL || "https://ai.gateway.lovable.dev/v1";
  const model = process.env.OLLAMA_MODEL || AI_MODEL;

  const system = `You label bank statement merchant patterns.
For each input pattern return the clean, human-readable merchant/payee name and one category.
Allowed categories: ${PIPELINE_CATEGORIES.join(", ")}.
Rules:
- Use the well-known brand name when recognisable ("SWIGGY" -> "Swiggy", "HDFCLIFE" -> "HDFC Life").
- Person-to-person transfers: use the person's name in Title Case, category "Transfers".
- Salary credits: category "Salary & Income". Bank charges/fees: "Fees & Charges".
- Never invent patterns and never drop one. Output compact JSON only:
{"results":[{"pattern":"<exact input pattern>","payee":"<name>","category":"<category>"}]}`;

  const user = JSON.stringify({
    patterns: batch.map((b) => ({ pattern: b.pattern, examples: b.samples.slice(0, 2), type: b.type })),
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Lovable-API-Key"] = apiKey;

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8000,
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = await res.json();
  const content: string = json.choices?.[0]?.message?.content ?? "{}";
  const { salvageJson } = await import("./statement-parse.server");
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = salvageJson(content) ?? { results: [] };
  }

  const out: ResolvedMap = {};
  const allowed = new Set<string>(PIPELINE_CATEGORIES as readonly string[]);
  for (const r of Array.isArray(parsed.results) ? parsed.results : []) {
    const pattern = String(r?.pattern ?? "").trim();
    const payee = String(r?.payee ?? "").trim();
    if (!pattern || !payee) continue;
    const category = allowed.has(String(r?.category)) ? String(r.category) : null;
    out[pattern] = { payee: payee.slice(0, 120), category, source: "ai" };
  }
  return out;
}

/**
 * Classify unknown patterns in batches, persisting each finished batch to the
 * global dictionary and pushing progress onto the upload row so the UI can
 * stream it over realtime.
 */
export async function classifyPendingPatterns(opts: {
  admin: any;
  uploadId: string;
  pending: Sample[];
  apiKey?: string;
}): Promise<ResolvedMap> {
  const { admin, uploadId, pending, apiKey } = opts;
  const batches = chunk(pending, BATCH_SIZE);
  const merged: ResolvedMap = {};
  let done = 0;

  await withConcurrency(batches, CONCURRENCY, async (batch) => {
    let labelled: ResolvedMap = {};
    try {
      labelled = await classifyBatch(batch, apiKey);
    } catch {
      labelled = {};
    }

    // Fill gaps deterministically so no pattern is left without a name
    for (const item of batch) {
      if (!labelled[item.pattern]) {
        labelled[item.pattern] = {
          payee: titleCase(item.pattern),
          category: null,
          source: "ai",
        };
      }
    }

    Object.assign(merged, labelled);
    done += batch.length;

    const rows = Object.entries(labelled).map(([normalized_pattern, v]) => ({
      normalized_pattern,
      canonical_payee_name: v.payee,
      suggested_category: v.category,
      confidence_source: "ai_classified" as const,
    }));
    if (rows.length) {
      await admin
        .from("global_merchant_dictionary")
        .upsert(rows, { onConflict: "normalized_pattern", ignoreDuplicates: true });
    }

    // Progress ping (merged snapshot written at the end for consistency)
    await admin
      .from("statement_uploads")
      .update({ processed_transactions: done })
      .eq("id", uploadId);
  });

  return merged;
}
