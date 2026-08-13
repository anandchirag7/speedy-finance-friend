/**
 * Deterministic clustering + similarity utilities for the statement import
 * pipeline. Pure and dependency-free: safe on both client and server.
 *
 * Key rule: we only ever compare UNIQUE normalized descriptions, never raw
 * transactions, and comparisons happen inside token-blocked candidate groups —
 * never O(n^2) across the whole statement.
 */

import { titleCase } from "./statement-normalize";

export type MatchSource =
  | "alias"
  | "payee"
  | "rule"
  | "dictionary"
  | "cluster"
  | "ai"
  | "manual"
  | "pending";

export type ClusterStatus = "auto" | "suggested" | "review" | "approved" | "ignored";

export type ClusterTxn = {
  key: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  pattern: string;
  transfer_account_id?: string | null;
};

export type Member = {
  description: string;
  pattern: string;
  count: number;
  total: number;
  sample: ClusterTxn;
};

export type Cluster = {
  id: string;
  patterns: string[];
  name: string;
  originalName: string;
  members: Member[];
  tokens: string[];
  category_id: string | null;
  type: "income" | "expense" | "transfer";
  source: MatchSource;
  confidence: number;
  status: ClusterStatus;
  saveAsPayee: boolean;
  isExisting: boolean;
  existingPayeeId: string | null;
  isTransfer: boolean;
  pendingAi: boolean;
  transfer_account_id?: string | null;
};

// ---------------------------------------------------------------- similarity

/** Normalized Levenshtein similarity, early-exit on length gap. */
export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  if (Math.abs(la - lb) / Math.max(la, lb) > 0.5) return 0;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return 1 - prev[lb]! / Math.max(la, lb);
}

export function tokensOf(pattern: string): string[] {
  return pattern.split(/\s+/).filter((t) => t.length > 1);
}

/** Jaccard over token sets. */
export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const t of new Set(b)) if (sa.has(t)) inter++;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

/** Token-set ratio: how much of the smaller set is contained in the larger. */
export function tokenSetRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const t of new Set(b)) if (sa.has(t)) inter++;
  return inter / Math.min(sa.size, new Set(b).size);
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const p = ` ${s} `;
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** Character n-gram (trigram) Dice coefficient. */
export function trigramRatio(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const g of tb) if (ta.has(g)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/** Blended similarity score between two normalized merchant patterns. */
export function patternSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  const set = tokenSetRatio(ta, tb);
  const jac = jaccard(ta, tb);
  const lev = levenshteinRatio(a, b);
  const tri = trigramRatio(a, b);
  // A shared leading merchant token is the strongest deterministic signal.
  const headBonus = ta[0] && ta[0] === tb[0] ? 0.12 : 0;
  return Math.min(1, 0.4 * set + 0.2 * jac + 0.2 * lev + 0.2 * tri + headBonus);
}

// ------------------------------------------------------------------ grouping

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

const SIM_THRESHOLD = 0.82;
const MAX_BLOCK = 60; // cap fuzzy comparisons inside a token block

/**
 * Group unique patterns into merchant clusters.
 * Blocking key = first meaningful token; fuzzy comparison happens only inside
 * a block, and cluster cohesion is validated against the block representative
 * to prevent transitive chaining ("A~B, B~C" merging unrelated A and C).
 */
export function groupPatterns(patterns: string[]): string[][] {
  const uf = new UnionFind(patterns.length);
  const blocks = new Map<string, number[]>();
  patterns.forEach((p, i) => {
    const toks = tokensOf(p);
    const keys = new Set<string>();
    if (toks[0]) keys.add(toks[0].slice(0, 6));
    if (toks[1]) keys.add(toks[1].slice(0, 6));
    if (!keys.size) keys.add(p.slice(0, 6) || "misc");
    for (const k of keys) {
      const arr = blocks.get(k);
      if (arr) arr.push(i);
      else blocks.set(k, [i]);
    }
  });

  for (const idxs of blocks.values()) {
    if (idxs.length < 2 || idxs.length > MAX_BLOCK) continue;
    // Representative = shortest pattern (usually the cleanest merchant name).
    const rep = idxs.reduce((a, b) => (patterns[a]!.length <= patterns[b]!.length ? a : b));
    for (const i of idxs) {
      if (i === rep) continue;
      if (patternSimilarity(patterns[rep]!, patterns[i]!) >= SIM_THRESHOLD) uf.union(rep, i);
    }
  }

  const groups = new Map<number, string[]>();
  patterns.forEach((p, i) => {
    const root = uf.find(i);
    const arr = groups.get(root);
    if (arr) arr.push(p);
    else groups.set(root, [p]);
  });
  return Array.from(groups.values());
}

// --------------------------------------------------------------- cluster build

export type ResolvedEntry = { payee: string; category: string | null; source: string };

function sourceOf(raw: string | undefined): MatchSource {
  switch (raw) {
    case "user_override":
    case "alias":
      return "alias";
    case "payee":
      return "payee";
    case "rule":
      return "rule";
    case "ai":
    case "ai_inferred":
      return "ai";
    case "user_confirmed":
    case "dictionary":
    case "seed":
      return "dictionary";
    default:
      return raw ? "dictionary" : "pending";
  }
}

const CONFIDENCE: Record<MatchSource, number> = {
  alias: 1,
  payee: 0.96,
  rule: 0.94,
  dictionary: 0.9,
  cluster: 0.76,
  ai: 0.72,
  manual: 1,
  pending: 0.3,
};

export function statusFor(source: MatchSource, confidence: number): ClusterStatus {
  if (source === "manual") return "approved";
  if (source === "alias" || source === "payee" || source === "rule") return "auto";
  if (confidence >= 0.85) return "auto";
  if (source === "ai") return "suggested";
  return "review";
}

/**
 * Build the confirm-step clusters from parsed transactions.
 * Deterministic grouping first; unresolved patterns are additionally grouped by
 * similarity so AI only ever sees one entry per real merchant.
 */
export function buildClusters(opts: {
  transactions: ClusterTxn[];
  resolved: Record<string, ResolvedEntry>;
  existingPayees: Array<{ id: string; merchant: string; category_id: string | null }>;
  categoryIdByName: Map<string, string>;
}): Cluster[] {
  const { transactions, resolved, existingPayees, categoryIdByName } = opts;

  // 1 · aggregate by unique description within a pattern
  const byPattern = new Map<string, Map<string, Member>>();
  const typeVotes = new Map<string, Record<string, number>>();
  for (const t of transactions) {
    const p = t.pattern || "MISC";
    let members = byPattern.get(p);
    if (!members) {
      members = new Map();
      byPattern.set(p, members);
      typeVotes.set(p, { income: 0, expense: 0, transfer: 0 });
    }
    const m = members.get(t.description);
    if (m) {
      m.count += 1;
      m.total += Math.abs(t.amount);
    } else {
      members.set(t.description, {
        description: t.description,
        pattern: p,
        count: 1,
        total: Math.abs(t.amount),
        sample: t,
      });
    }
    typeVotes.get(p)![t.type] += 1;
  }

  const patterns = Array.from(byPattern.keys());
  const resolvedPatterns = patterns.filter((p) => resolved[p]);
  const unresolvedPatterns = patterns.filter((p) => !resolved[p]);

  // 2 · resolved patterns keep their own identity; unresolved ones get clustered
  const groups: string[][] = [
    ...resolvedPatterns.map((p) => [p]),
    ...groupPatterns(unresolvedPatterns),
  ];

  const payeeByName = new Map<string, (typeof existingPayees)[number]>();
  for (const p of existingPayees) {
    if (p.merchant) payeeByName.set(p.merchant.toLowerCase(), p);
    if ((p as any).aliases && Array.isArray((p as any).aliases)) {
      for (const alias of (p as any).aliases) {
        if (alias) payeeByName.set(alias.toLowerCase(), p);
      }
    }
  }

  return groups.map((group, gi) => {
    const members = group.flatMap((p) => Array.from(byPattern.get(p)?.values() ?? []));
    const votes = group.reduce(
      (acc, p) => {
        const v = typeVotes.get(p)!;
        acc.income += v.income;
        acc.expense += v.expense;
        acc.transfer += v.transfer;
        return acc;
      },
      { income: 0, expense: 0, transfer: 0 },
    );
    const type = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "expense") as Cluster["type"];

    const hit = group.map((p) => resolved[p]).find(Boolean);
    const rep = group.reduce((a, b) => (a.length <= b.length ? a : b));
    let existing = group.map((p) => payeeByName.get(p.toLowerCase())).find(Boolean) ?? null;
    if (!existing) {
      for (const m of members) {
        const found = payeeByName.get(m.description.toLowerCase());
        if (found) {
          existing = found;
          break;
        }
      }
    }
    const name = hit?.payee ?? existing?.merchant ?? titleCase(rep);

    let source: MatchSource = hit ? sourceOf(hit.source) : group.length > 1 ? "cluster" : "pending";
    if (!hit && existing) source = "payee";
    const confidence = CONFIDENCE[source];

    return {
      id: `c${gi}`,
      patterns: group,
      name,
      originalName: name,
      members: members.sort((a, b) => b.count - a.count),
      tokens: tokensOf(rep).slice(0, 6),
      category_id:
        existing?.category_id ??
        (hit?.category ? categoryIdByName.get(hit.category.toLowerCase()) ?? null : null),
      type,
      source,
      confidence,
      status: statusFor(source, confidence),
      saveAsPayee: !existing,
      isExisting: !!existing,
      existingPayeeId: existing?.id ?? null,
      isTransfer: type === "transfer",
      pendingAi: !hit,
    } satisfies Cluster;
  });
}

export const clusterTxnCount = (c: Cluster) => c.members.reduce((s, m) => s + m.count, 0);
export const clusterTotal = (c: Cluster) => c.members.reduce((s, m) => s + m.total, 0);

export type ClusterStats = {
  transactions: number;
  clusters: number;
  autoMatched: number;
  aiSuggested: number;
  needsReview: number;
  approved: number;
  existing: number;
  newPayees: number;
  ignored: number;
};

export function summarize(clusters: Cluster[]): ClusterStats {
  const stats: ClusterStats = {
    transactions: 0,
    clusters: clusters.length,
    autoMatched: 0,
    aiSuggested: 0,
    needsReview: 0,
    approved: 0,
    existing: 0,
    newPayees: 0,
    ignored: 0,
  };
  for (const c of clusters) {
    stats.transactions += clusterTxnCount(c);
    if (c.status === "ignored") stats.ignored++;
    else if (c.status === "approved") stats.approved++;
    else if (c.status === "review") stats.needsReview++;
    else if (c.source === "ai") stats.aiSuggested++;
    else stats.autoMatched++;
    if (c.isExisting) stats.existing++;
    else stats.newPayees++;
  }
  return stats;
}

/** Merge clusters into the first selected one, preserving all aliases. */
export function mergeClusters(all: Cluster[], ids: string[]): Cluster[] {
  if (ids.length < 2) return all;
  const set = new Set(ids);
  const picked = all.filter((c) => set.has(c.id));
  const keep = picked.reduce((a, b) => (clusterTxnCount(a) >= clusterTxnCount(b) ? a : b));
  const merged: Cluster = {
    ...keep,
    patterns: Array.from(new Set(picked.flatMap((c) => c.patterns))),
    members: picked.flatMap((c) => c.members).sort((a, b) => b.count - a.count),
    tokens: Array.from(new Set(picked.flatMap((c) => c.tokens))).slice(0, 8),
    pendingAi: picked.every((c) => c.pendingAi),
    status: "approved",
    source: keep.source === "pending" ? "manual" : keep.source,
  };
  return all.filter((c) => !set.has(c.id)).concat(merged);
}

/** Move selected descriptions out of a cluster into a brand-new cluster. */
export function splitCluster(all: Cluster[], id: string, descriptions: string[]): Cluster[] {
  const src = all.find((c) => c.id === id);
  if (!src || !descriptions.length) return all;
  const move = new Set(descriptions);
  const moved = src.members.filter((m) => move.has(m.description));
  const kept = src.members.filter((m) => !move.has(m.description));
  if (!moved.length) return all;
  const fresh: Cluster = {
    ...src,
    id: `c-split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    members: moved,
    patterns: Array.from(new Set(moved.map((m) => m.pattern))),
    name: titleCase(moved[0]!.pattern) || moved[0]!.description.slice(0, 48),
    source: "manual",
    confidence: 1,
    status: "approved",
    pendingAi: false,
    saveAsPayee: true,
    isExisting: false,
    existingPayeeId: null,
  };
  const next = all.map((c) => (c.id === id ? { ...c, members: kept } : c));
  return next.filter((c) => c.members.length > 0).concat(fresh);
}

/** Similarity of each member against the cluster representative (split UI). */
export function memberCohesion(c: Cluster): Map<string, number> {
  const rep = c.patterns.reduce((a, b) => (a.length <= b.length ? a : b), c.patterns[0] ?? "");
  const out = new Map<string, number>();
  for (const m of c.members) out.set(m.description, patternSimilarity(rep, m.pattern));
  return out;
}

/** Move selected descriptions from one cluster into another existing cluster. */
export function moveMembers(
  all: Cluster[],
  fromId: string,
  descriptions: string[],
  toId: string,
): Cluster[] {
  if (fromId === toId || !descriptions.length) return all;
  const src = all.find((c) => c.id === fromId);
  const dst = all.find((c) => c.id === toId);
  if (!src || !dst) return all;
  const move = new Set(descriptions);
  const moved = src.members.filter((m) => move.has(m.description));
  if (!moved.length) return all;
  const kept = src.members.filter((m) => !move.has(m.description));

  const mergedMembers = [...dst.members];
  for (const m of moved) {
    const hit = mergedMembers.findIndex((x) => x.description === m.description);
    if (hit >= 0) {
      const cur = mergedMembers[hit]!;
      mergedMembers[hit] = { ...cur, count: cur.count + m.count, total: cur.total + m.total };
    } else {
      mergedMembers.push(m);
    }
  }
  mergedMembers.sort((a, b) => b.count - a.count);

  return all
    .map((c) => {
      if (c.id === fromId) return { ...c, members: kept, patterns: Array.from(new Set(kept.map((m) => m.pattern))) };
      if (c.id === toId)
        return {
          ...c,
          members: mergedMembers,
          patterns: Array.from(new Set(mergedMembers.map((m) => m.pattern))),
          status: "approved" as ClusterStatus,
          source: c.source === "pending" ? ("manual" as MatchSource) : c.source,
        };
      return c;
    })
    .filter((c) => c.members.length > 0);
}

/** Determine confidence tier for smart auto-approve (tier1 = >85% / rule hit, tier2 = 50-85%, tier3 = <50% / uncategorized). */
export function getClusterTier(c: Cluster): "tier1" | "tier2" | "tier3" {
  if (c.status === "approved") return "tier1";
  if (c.source === "alias" || c.source === "rule" || c.source === "payee" || c.confidence >= 0.85) {
    return "tier1";
  }
  if (c.category_id && c.confidence >= 0.5) {
    return "tier2";
  }
  return "tier3";
}

/** Batch approve all high-confidence clusters (Tier 1 & Tier 2) in 1 click. */
export function approveHighConfidenceClusters(clusters: Cluster[], includeTier2 = true): Cluster[] {
  return clusters.map((c) => {
    if (c.status === "ignored") return c;
    const tier = getClusterTier(c);
    if (tier === "tier1" || (includeTier2 && tier === "tier2")) {
      return { ...c, status: "approved" as ClusterStatus };
    }
    return c;
  });
}

export type CategoryClusterGroup = {
  categoryId: string | null;
  categoryName: string;
  clusters: Cluster[];
  totalAmount: number;
  totalTxns: number;
};

/** Group clusters by their assigned category for Category View Mode. */
export function groupClustersByCategory(
  clusters: Cluster[],
  categories: Array<{ id: string; name: string }>,
): CategoryClusterGroup[] {
  const catMap = new Map<string, string>();
  for (const cat of categories) catMap.set(cat.id, cat.name);

  const groups = new Map<string | null, Cluster[]>();
  for (const c of clusters) {
    const key = c.category_id;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const result: CategoryClusterGroup[] = [];
  for (const [catId, list] of groups.entries()) {
    const name = catId ? catMap.get(catId) ?? "Other Category" : "Uncategorized";
    let amount = 0;
    let txns = 0;
    for (const cl of list) {
      amount += clusterTotal(cl);
      txns += clusterTxnCount(cl);
    }
    result.push({
      categoryId: catId,
      categoryName: name,
      clusters: list,
      totalAmount: amount,
      totalTxns: txns,
    });
  }

  // Put Uncategorized first, then sort by transaction volume
  return result.sort((a, b) => {
    if (!a.categoryId) return -1;
    if (!b.categoryId) return 1;
    return b.totalTxns - a.totalTxns;
  });
}
