// Reports catalog: 30+ report definitions with chart hints.

import type { ReportsData } from "./reports.functions";

export type ReportRow = (string | number)[];

export type ChartType = "bar" | "line" | "area" | "pie" | "hbar" | "combo";
export interface ChartHint {
  type: ChartType;
  title?: string;
  xCol: number;
  yCols: number[];
  yLabels?: string[];
  maxItems?: number;
  format?: "currency" | "percent" | "number";
}

export interface ReportOutput {
  columns: string[];
  rows: ReportRow[];
  kpis?: { label: string; value: string }[];
  numericColumns?: number[];
  emptyMessage?: string;
  footer?: ReportRow;
  chart?: ChartHint;
  chart2?: ChartHint;
}

export interface ReportDef {
  id: string;
  name: string;
  category:
    | "Cash Flow"
    | "Spending"
    | "Income"
    | "Net Worth"
    | "Accounts"
    | "Budgets"
    | "Bills"
    | "Payees"
    | "Transactions"
    | "Tax & Investments";
  description: string;
  compute: (data: ReportsData) => ReportOutput;
}

// ---------- helpers ----------
const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    isFinite(n) ? n : 0,
  );
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(isFinite(n) ? n : 0);
const monthKey = (d: string) => (d ?? "").slice(0, 7);
const weekKey = (d: string) => {
  const dt = new Date(d);
  const day = dt.getUTCDay();
  const diff = dt.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
};
const num = (x: any) => Number(x ?? 0);

function groupSum<T>(items: T[], keyFn: (t: T) => string, valFn: (t: T) => number) {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + valFn(it));
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

// Chart helpers: parse a currency/percent/number string back to a number for charting.
export function parseChartNumber(x: string | number): number {
  if (typeof x === "number") return isFinite(x) ? x : 0;
  const s = String(x ?? "");
  const m = s.replace(/[^\d.\-]/g, "");
  const n = parseFloat(m);
  return isFinite(n) ? n : 0;
}

// ---------- report definitions ----------
export const REPORTS: ReportDef[] = [
  // ============== CASH FLOW ==============
  {
    id: "cashflow-summary",
    name: "Cash Flow Summary",
    category: "Cash Flow",
    description: "Total income, spending, and net cash flow for the selected period.",
    compute: (d) => {
      let income = 0,
        expense = 0;
      for (const t of d.transactions) {
        if (t.type === "income") income += num(t.amount);
        else if (t.type === "expense") expense += num(t.amount);
      }
      const net = income - expense;
      const rate = income > 0 ? (net / income) * 100 : 0;
      return {
        columns: ["Metric", "Amount"],
        rows: [
          ["Total income", fmtINR(income)],
          ["Total spending", fmtINR(expense)],
          ["Net cash flow", fmtINR(net)],
          ["Savings rate", `${rate.toFixed(1)}%`],
        ],
        kpis: [
          { label: "Income", value: fmtINR(income) },
          { label: "Spending", value: fmtINR(expense) },
          { label: "Net", value: fmtINR(net) },
          { label: "Savings rate", value: `${rate.toFixed(1)}%` },
        ],
        chart: { type: "bar", title: "Income vs Spending vs Net", xCol: 0, yCols: [1], format: "currency" },
      };
    },
  },
  {
    id: "cashflow-monthly",
    name: "Monthly Cash Flow",
    category: "Cash Flow",
    description: "Income, spending, and net flow broken down by month.",
    compute: (d) => {
      const map = new Map<string, { i: number; e: number }>();
      for (const t of d.transactions) {
        const k = monthKey(t.txn_date);
        if (!k) continue;
        const b = map.get(k) ?? { i: 0, e: 0 };
        if (t.type === "income") b.i += num(t.amount);
        else if (t.type === "expense") b.e += num(t.amount);
        map.set(k, b);
      }
      const rows: ReportRow[] = [...map.entries()]
        .sort()
        .map(([m, v]) => [m, fmtINR(v.i), fmtINR(v.e), fmtINR(v.i - v.e)]);
      const tot = [...map.values()].reduce((a, b) => ({ i: a.i + b.i, e: a.e + b.e }), { i: 0, e: 0 });
      return {
        columns: ["Month", "Income", "Spending", "Net"],
        numericColumns: [1, 2, 3],
        rows,
        footer: ["Total", fmtINR(tot.i), fmtINR(tot.e), fmtINR(tot.i - tot.e)],
        chart: {
          type: "combo",
          title: "Monthly income, spending & net",
          xCol: 0,
          yCols: [1, 2, 3],
          yLabels: ["Income", "Spending", "Net"],
          format: "currency",
        },
      };
    },
  },
  {
    id: "cashflow-weekly",
    name: "Weekly Cash Flow",
    category: "Cash Flow",
    description: "Cash movement summarised by ISO week.",
    compute: (d) => {
      const map = new Map<string, { i: number; e: number }>();
      for (const t of d.transactions) {
        const k = weekKey(t.txn_date);
        const b = map.get(k) ?? { i: 0, e: 0 };
        if (t.type === "income") b.i += num(t.amount);
        else if (t.type === "expense") b.e += num(t.amount);
        map.set(k, b);
      }
      return {
        columns: ["Week starting", "Income", "Spending", "Net"],
        numericColumns: [1, 2, 3],
        rows: [...map.entries()]
          .sort()
          .map(([w, v]) => [w, fmtINR(v.i), fmtINR(v.e), fmtINR(v.i - v.e)]),
        chart: {
          type: "line",
          title: "Weekly net cash flow",
          xCol: 0,
          yCols: [1, 2, 3],
          yLabels: ["Income", "Spending", "Net"],
          format: "currency",
        },
      };
    },
  },
  {
    id: "cashflow-daily",
    name: "Daily Cash Flow",
    category: "Cash Flow",
    description: "Day-by-day view of net cash movements.",
    compute: (d) => {
      const map = new Map<string, { i: number; e: number }>();
      for (const t of d.transactions) {
        const k = (t.txn_date ?? "").slice(0, 10);
        const b = map.get(k) ?? { i: 0, e: 0 };
        if (t.type === "income") b.i += num(t.amount);
        else if (t.type === "expense") b.e += num(t.amount);
        map.set(k, b);
      }
      return {
        columns: ["Date", "Income", "Spending", "Net"],
        numericColumns: [1, 2, 3],
        rows: [...map.entries()].sort().map(([w, v]) => [w, fmtINR(v.i), fmtINR(v.e), fmtINR(v.i - v.e)]),
        chart: {
          type: "area",
          title: "Daily net cash flow",
          xCol: 0,
          yCols: [3],
          yLabels: ["Net"],
          format: "currency",
        },
      };
    },
  },
  {
    id: "savings-rate-trend",
    name: "Savings Rate Trend",
    category: "Cash Flow",
    description: "Monthly savings rate to spot lifestyle inflation early.",
    compute: (d) => {
      const map = new Map<string, { i: number; e: number }>();
      for (const t of d.transactions) {
        const k = monthKey(t.txn_date);
        if (!k) continue;
        const b = map.get(k) ?? { i: 0, e: 0 };
        if (t.type === "income") b.i += num(t.amount);
        else if (t.type === "expense") b.e += num(t.amount);
        map.set(k, b);
      }
      return {
        columns: ["Month", "Income", "Spending", "Savings rate"],
        numericColumns: [1, 2],
        rows: [...map.entries()].sort().map(([m, v]) => [
          m,
          fmtINR(v.i),
          fmtINR(v.e),
          `${v.i > 0 ? (((v.i - v.e) / v.i) * 100).toFixed(1) : "0.0"}%`,
        ]),
        chart: {
          type: "line",
          title: "Monthly savings rate",
          xCol: 0,
          yCols: [3],
          yLabels: ["Savings %"],
          format: "percent",
        },
      };
    },
  },

  // ============== SPENDING ==============
  {
    id: "spend-by-category",
    name: "Spending by Category",
    category: "Spending",
    description: "Total spending grouped by top-level category.",
    compute: (d) => {
      const catById = new Map(d.categories.map((c: any) => [c.id, c]));
      const parentName = (id: string | null): string => {
        if (!id) return "Uncategorized";
        const c: any = catById.get(id);
        if (!c) return "Uncategorized";
        if (c.parent_id) return parentName(c.parent_id);
        return c.name;
      };
      const rows = groupSum(
        d.transactions.filter((t: any) => t.type === "expense"),
        (t: any) => parentName(t.category_id),
        (t: any) => num(t.amount),
      );
      const total = rows.reduce((s, [, v]) => s + v, 0);
      return {
        columns: ["Category", "Amount", "% of spend"],
        numericColumns: [1],
        rows: rows.map(([k, v]) => [k, fmtINR(v), `${total ? ((v / total) * 100).toFixed(1) : "0.0"}%`]),
        footer: ["Total", fmtINR(total), "100.0%"],
        chart: { type: "pie", title: "Spending by category", xCol: 0, yCols: [1], maxItems: 10, format: "currency" },
      };
    },
  },
  {
    id: "spend-by-subcategory",
    name: "Spending by Subcategory",
    category: "Spending",
    description: "Detailed subcategory view of expenses.",
    compute: (d) => {
      const catById = new Map(d.categories.map((c: any) => [c.id, c]));
      const rows = groupSum(
        d.transactions.filter((t: any) => t.type === "expense"),
        (t: any) => {
          const c: any = catById.get(t.category_id);
          if (!c) return "Uncategorized";
          if (!c.parent_id) return c.name;
          const p: any = catById.get(c.parent_id);
          return `${p?.name ?? "—"} › ${c.name}`;
        },
        (t: any) => num(t.amount),
      );
      const total = rows.reduce((s, [, v]) => s + v, 0);
      return {
        columns: ["Subcategory", "Amount", "% of spend"],
        numericColumns: [1],
        rows: rows.map(([k, v]) => [k, fmtINR(v), `${total ? ((v / total) * 100).toFixed(1) : "0.0"}%`]),
        chart: { type: "hbar", title: "Top subcategories", xCol: 0, yCols: [1], maxItems: 12, format: "currency" },
      };
    },
  },
  {
    id: "spend-by-payee",
    name: "Spending by Payee",
    category: "Spending",
    description: "Where your money actually goes, ranked by payee.",
    compute: (d) => {
      const rows = groupSum(
        d.transactions.filter((t: any) => t.type === "expense"),
        (t: any) => (t.merchant?.trim() || t.note?.trim() || "Unknown"),
        (t: any) => num(t.amount),
      );
      return {
        columns: ["Payee", "Amount", "Txns"],
        numericColumns: [1, 2],
        rows: rows.map(([k, v]) => {
          const count = d.transactions.filter(
            (t: any) => t.type === "expense" && (t.merchant?.trim() || t.note?.trim() || "Unknown") === k,
          ).length;
          return [k, fmtINR(v), fmtNum(count)];
        }),
        chart: { type: "hbar", title: "Top payees by spend", xCol: 0, yCols: [1], maxItems: 12, format: "currency" },
      };
    },
  },
  {
    id: "spend-by-account",
    name: "Spending by Account",
    category: "Spending",
    description: "See which account is doing the heavy lifting.",
    compute: (d) => {
      const rows = groupSum(
        d.transactions.filter((t: any) => t.type === "expense"),
        (t: any) => t.account?.name ?? "—",
        (t: any) => num(t.amount),
      );
      return {
        columns: ["Account", "Amount"],
        numericColumns: [1],
        rows: rows.map(([k, v]) => [k, fmtINR(v)]),
        chart: { type: "pie", title: "Spending by account", xCol: 0, yCols: [1], maxItems: 8, format: "currency" },
      };
    },
  },
  {
    id: "top-expenses",
    name: "Top 25 Expenses",
    category: "Spending",
    description: "Largest single transactions in the period.",
    compute: (d) => {
      const rows = d.transactions
        .filter((t: any) => t.type === "expense")
        .sort((a: any, b: any) => num(b.amount) - num(a.amount))
        .slice(0, 25)
        .map((t: any) => [
          t.txn_date,
          t.merchant || t.note || "—",
          t.category?.name ?? "Uncategorized",
          t.account?.name ?? "—",
          fmtINR(num(t.amount)),
        ]);
      return {
        columns: ["Date", "Payee", "Category", "Account", "Amount"],
        numericColumns: [4],
        rows,
        chart: { type: "hbar", title: "Top expenses", xCol: 1, yCols: [4], maxItems: 12, format: "currency" },
      };
    },
  },
  {
    id: "spend-weekday-weekend",
    name: "Weekday vs Weekend Spending",
    category: "Spending",
    description: "Compare spending patterns on weekdays and weekends.",
    compute: (d) => {
      let wd = 0,
        we = 0,
        wdN = 0,
        weN = 0;
      for (const t of d.transactions as any[]) {
        if (t.type !== "expense") continue;
        const day = new Date(t.txn_date).getUTCDay();
        if (day === 0 || day === 6) {
          we += num(t.amount);
          weN++;
        } else {
          wd += num(t.amount);
          wdN++;
        }
      }
      return {
        columns: ["Segment", "Spend", "Txns", "Avg / txn"],
        numericColumns: [1, 2, 3],
        rows: [
          ["Weekdays", fmtINR(wd), fmtNum(wdN), fmtINR(wdN ? wd / wdN : 0)],
          ["Weekends", fmtINR(we), fmtNum(weN), fmtINR(weN ? we / weN : 0)],
        ],
        chart: { type: "bar", title: "Weekday vs weekend spend", xCol: 0, yCols: [1], format: "currency" },
        chart2: { type: "pie", title: "Share of spend", xCol: 0, yCols: [1], format: "currency" },
      };
    },
  },
  {
    id: "recurring-spend",
    name: "Recurring Spend Detector",
    category: "Spending",
    description: "Payees you paid on 3 or more different days — likely recurring.",
    compute: (d) => {
      const map = new Map<string, { total: number; days: Set<string> }>();
      for (const t of d.transactions as any[]) {
        if (t.type !== "expense") continue;
        const k = t.merchant?.trim() || t.note?.trim() || "Unknown";
        const b = map.get(k) ?? { total: 0, days: new Set<string>() };
        b.total += num(t.amount);
        b.days.add((t.txn_date ?? "").slice(0, 10));
        map.set(k, b);
      }
      return {
        columns: ["Payee", "Occurrences", "Total"],
        numericColumns: [1, 2],
        rows: [...map.entries()]
          .filter(([, v]) => v.days.size >= 3)
          .sort((a, b) => b[1].total - a[1].total)
          .map(([k, v]) => [k, fmtNum(v.days.size), fmtINR(v.total)]),
        chart: { type: "hbar", title: "Recurring outflows", xCol: 0, yCols: [2], maxItems: 12, format: "currency" },
      };
    },
  },
  {
    id: "avg-daily-spend",
    name: "Average Daily Spend",
    category: "Spending",
    description: "Rolling averages to understand your run-rate.",
    compute: (d) => {
      const expenses = d.transactions.filter((t: any) => t.type === "expense");
      const total = expenses.reduce((s, t: any) => s + num(t.amount), 0);
      const days = Math.max(1, Math.ceil((new Date(d.to).getTime() - new Date(d.from).getTime()) / 86400000) + 1);
      return {
        columns: ["Metric", "Value"],
        rows: [
          ["Period", `${d.from} → ${d.to}`],
          ["Days", fmtNum(days)],
          ["Total spend", fmtINR(total)],
          ["Avg / day", fmtINR(total / days)],
          ["Avg / week", fmtINR((total / days) * 7)],
          ["Avg / month", fmtINR((total / days) * 30)],
        ],
      };
    },
  },

  // ============== INCOME ==============
  {
    id: "income-by-category",
    name: "Income by Category",
    category: "Income",
    description: "Where your income comes from.",
    compute: (d) => {
      const catById = new Map(d.categories.map((c: any) => [c.id, c]));
      const rows = groupSum(
        d.transactions.filter((t: any) => t.type === "income"),
        (t: any) => (catById.get(t.category_id) as any)?.name ?? "Uncategorized",
        (t: any) => num(t.amount),
      );
      const total = rows.reduce((s, [, v]) => s + v, 0);
      return {
        columns: ["Category", "Amount", "% of income"],
        numericColumns: [1],
        rows: rows.map(([k, v]) => [k, fmtINR(v), `${total ? ((v / total) * 100).toFixed(1) : "0.0"}%`]),
        footer: ["Total", fmtINR(total), "100.0%"],
        chart: { type: "pie", title: "Income by category", xCol: 0, yCols: [1], format: "currency" },
      };
    },
  },
  {
    id: "income-by-source",
    name: "Income by Source (Payee)",
    category: "Income",
    description: "Employers, clients, and every incoming counterparty.",
    compute: (d) => {
      const rows = groupSum(
        d.transactions.filter((t: any) => t.type === "income"),
        (t: any) => t.merchant?.trim() || t.note?.trim() || "Unknown",
        (t: any) => num(t.amount),
      );
      return {
        columns: ["Source", "Amount"],
        numericColumns: [1],
        rows: rows.map(([k, v]) => [k, fmtINR(v)]),
        chart: { type: "hbar", title: "Top income sources", xCol: 0, yCols: [1], maxItems: 12, format: "currency" },
      };
    },
  },
  {
    id: "income-monthly",
    name: "Monthly Income Trend",
    category: "Income",
    description: "Track monthly income for stability or growth.",
    compute: (d) => {
      const map = new Map<string, number>();
      for (const t of d.transactions as any[]) {
        if (t.type !== "income") continue;
        const k = monthKey(t.txn_date);
        map.set(k, (map.get(k) ?? 0) + num(t.amount));
      }
      const entries = [...map.entries()].sort();
      return {
        columns: ["Month", "Income", "MoM Δ"],
        numericColumns: [1, 2],
        rows: entries.map(([m, v], i) => {
          const prev = i > 0 ? entries[i - 1][1] : 0;
          const delta = prev ? (((v - prev) / prev) * 100).toFixed(1) + "%" : "—";
          return [m, fmtINR(v), delta];
        }),
        chart: { type: "bar", title: "Monthly income", xCol: 0, yCols: [1], format: "currency" },
      };
    },
  },
  {
    id: "income-vs-expense",
    name: "Income vs Expense",
    category: "Income",
    description: "Side-by-side monthly comparison.",
    compute: (d) => {
      const map = new Map<string, { i: number; e: number }>();
      for (const t of d.transactions as any[]) {
        const k = monthKey(t.txn_date);
        if (!k) continue;
        const b = map.get(k) ?? { i: 0, e: 0 };
        if (t.type === "income") b.i += num(t.amount);
        else if (t.type === "expense") b.e += num(t.amount);
        map.set(k, b);
      }
      return {
        columns: ["Month", "Income", "Expense", "Ratio"],
        numericColumns: [1, 2],
        rows: [...map.entries()].sort().map(([m, v]) => [
          m,
          fmtINR(v.i),
          fmtINR(v.e),
          v.e ? (v.i / v.e).toFixed(2) : "—",
        ]),
        chart: {
          type: "bar",
          title: "Income vs Expense (monthly)",
          xCol: 0,
          yCols: [1, 2],
          yLabels: ["Income", "Expense"],
          format: "currency",
        },
      };
    },
  },

  // ============== NET WORTH ==============
  {
    id: "networth-snapshot",
    name: "Net Worth Snapshot",
    category: "Net Worth",
    description: "Current assets, liabilities, and net worth.",
    compute: (d) => {
      let a = 0,
        l = 0;
      for (const acc of d.accounts as any[]) {
        if (!acc.is_active || acc.excluded_from_net_worth) continue;
        const bal = num(acc.current_balance);
        if (acc.is_liability) l += Math.abs(bal);
        else a += bal;
      }
      return {
        columns: ["Metric", "Value"],
        rows: [
          ["Total assets", fmtINR(a)],
          ["Total liabilities", fmtINR(l)],
          ["Net worth", fmtINR(a - l)],
          ["Debt-to-asset ratio", a ? ((l / a) * 100).toFixed(1) + "%" : "—"],
        ],
        kpis: [
          { label: "Assets", value: fmtINR(a) },
          { label: "Liabilities", value: fmtINR(l) },
          { label: "Net worth", value: fmtINR(a - l) },
        ],
        chart: { type: "bar", title: "Assets · Liabilities · Net worth", xCol: 0, yCols: [1], format: "currency" },
      };
    },
  },
  {
    id: "networth-trend",
    name: "Net Worth Trend",
    category: "Net Worth",
    description: "Historical snapshots of your total wealth.",
    compute: (d) => ({
      columns: ["Date", "Assets", "Liabilities", "Net worth"],
      numericColumns: [1, 2, 3],
      rows: d.snapshots.map((s: any) => [
        s.snapshot_date,
        fmtINR(num(s.total_assets)),
        fmtINR(num(s.total_liabilities)),
        fmtINR(num(s.net_worth)),
      ]),
      emptyMessage: "No net-worth snapshots recorded in this period.",
      chart: {
        type: "area",
        title: "Net worth over time",
        xCol: 0,
        yCols: [1, 2, 3],
        yLabels: ["Assets", "Liabilities", "Net worth"],
        format: "currency",
      },
    }),
  },
  {
    id: "assets-breakdown",
    name: "Assets Breakdown",
    category: "Net Worth",
    description: "Assets grouped by category (bank, MF, PPF, etc).",
    compute: (d) => {
      const rows = groupSum(
        (d.accounts as any[]).filter((a) => a.is_active && !a.is_liability && !a.excluded_from_net_worth),
        (a: any) => a.category ?? "other",
        (a: any) => num(a.current_balance),
      );
      const total = rows.reduce((s, [, v]) => s + v, 0);
      return {
        columns: ["Category", "Value", "% of assets"],
        numericColumns: [1],
        rows: rows.map(([k, v]) => [k, fmtINR(v), `${total ? ((v / total) * 100).toFixed(1) : "0.0"}%`]),
        footer: ["Total", fmtINR(total), "100.0%"],
        chart: { type: "pie", title: "Assets allocation", xCol: 0, yCols: [1], format: "currency" },
      };
    },
  },
  {
    id: "liabilities-breakdown",
    name: "Liabilities Breakdown",
    category: "Net Worth",
    description: "Loans, credit cards, and other liabilities.",
    compute: (d) => {
      const rows = (d.accounts as any[])
        .filter((a) => a.is_active && a.is_liability)
        .sort((a, b) => Math.abs(num(b.current_balance)) - Math.abs(num(a.current_balance)))
        .map((a) => [a.name, a.category ?? "—", fmtINR(Math.abs(num(a.current_balance)))]);
      return {
        columns: ["Account", "Type", "Outstanding"],
        numericColumns: [2],
        rows,
        chart: { type: "hbar", title: "Liabilities", xCol: 0, yCols: [2], format: "currency" },
      };
    },
  },

  // ============== ACCOUNTS ==============
  {
    id: "account-balances",
    name: "Account Balances",
    category: "Accounts",
    description: "All accounts with current balance and currency.",
    compute: (d) => ({
      columns: ["Account", "Institution", "Category", "Currency", "Balance"],
      numericColumns: [4],
      rows: (d.accounts as any[]).map((a) => [
        a.name,
        a.institution ?? "—",
        a.category,
        a.currency,
        fmtINR(num(a.current_balance)),
      ]),
      chart: { type: "hbar", title: "Balances by account", xCol: 0, yCols: [4], maxItems: 15, format: "currency" },
    }),
  },
  {
    id: "account-activity",
    name: "Account Activity",
    category: "Accounts",
    description: "Transaction counts and flow per account.",
    compute: (d) => {
      const map = new Map<string, { in: number; out: number; count: number; name: string }>();
      for (const acc of d.accounts as any[]) map.set(acc.id, { in: 0, out: 0, count: 0, name: acc.name });
      for (const t of d.transactions as any[]) {
        const b = map.get(t.account_id);
        if (!b) continue;
        b.count++;
        if (t.type === "income") b.in += num(t.amount);
        else if (t.type === "expense") b.out += num(t.amount);
      }
      return {
        columns: ["Account", "Txns", "Inflows", "Outflows", "Net"],
        numericColumns: [1, 2, 3, 4],
        rows: [...map.values()]
          .filter((b) => b.count)
          .map((b) => [b.name, fmtNum(b.count), fmtINR(b.in), fmtINR(b.out), fmtINR(b.in - b.out)]),
        chart: {
          type: "bar",
          title: "Inflow vs outflow by account",
          xCol: 0,
          yCols: [2, 3],
          yLabels: ["Inflow", "Outflow"],
          format: "currency",
        },
      };
    },
  },
  {
    id: "inactive-accounts",
    name: "Dormant Accounts",
    category: "Accounts",
    description: "Active accounts with zero transactions in the period.",
    compute: (d) => {
      const active = new Set((d.transactions as any[]).map((t) => t.account_id));
      const rows = (d.accounts as any[])
        .filter((a) => a.is_active && !active.has(a.id))
        .map((a) => [a.name, a.institution ?? "—", a.category, fmtINR(num(a.current_balance))]);
      return { columns: ["Account", "Institution", "Category", "Balance"], numericColumns: [3], rows };
    },
  },

  // ============== BUDGETS ==============
  {
    id: "budget-vs-actual",
    name: "Budget vs Actual",
    category: "Budgets",
    description: "How each category budget performed against reality.",
    compute: (d) => {
      const catById = new Map(d.categories.map((c: any) => [c.id, c]));
      const spendByCat = new Map<string, number>();
      for (const t of d.transactions as any[]) {
        if (t.type !== "expense" || !t.category_id) continue;
        spendByCat.set(t.category_id, (spendByCat.get(t.category_id) ?? 0) + num(t.amount));
      }
      const rows = (d.budgetCategories as any[]).map((bc) => {
        const cat: any = catById.get(bc.category_id);
        const planned = num(bc.amount);
        const actual = spendByCat.get(bc.category_id) ?? 0;
        return [
          cat?.name ?? "—",
          fmtINR(planned),
          fmtINR(actual),
          fmtINR(planned - actual),
          `${planned ? ((actual / planned) * 100).toFixed(0) : "0"}%`,
        ];
      });
      return {
        columns: ["Category", "Planned", "Actual", "Remaining", "Utilization"],
        numericColumns: [1, 2, 3],
        rows,
        emptyMessage: "No category budgets configured yet.",
        chart: {
          type: "bar",
          title: "Planned vs actual by category",
          xCol: 0,
          yCols: [1, 2],
          yLabels: ["Planned", "Actual"],
          format: "currency",
        },
      };
    },
  },
  {
    id: "budget-overruns",
    name: "Budget Overruns",
    category: "Budgets",
    description: "Categories that exceeded their planned amount.",
    compute: (d) => {
      const catById = new Map(d.categories.map((c: any) => [c.id, c]));
      const spendByCat = new Map<string, number>();
      for (const t of d.transactions as any[]) {
        if (t.type !== "expense" || !t.category_id) continue;
        spendByCat.set(t.category_id, (spendByCat.get(t.category_id) ?? 0) + num(t.amount));
      }
      const rows = (d.budgetCategories as any[])
        .map((bc) => {
          const cat: any = catById.get(bc.category_id);
          const planned = num(bc.amount);
          const actual = spendByCat.get(bc.category_id) ?? 0;
          return { name: cat?.name ?? "—", planned, actual, over: actual - planned };
        })
        .filter((r) => r.over > 0)
        .sort((a, b) => b.over - a.over)
        .map((r) => [r.name, fmtINR(r.planned), fmtINR(r.actual), fmtINR(r.over)]);
      return {
        columns: ["Category", "Planned", "Actual", "Overrun"],
        numericColumns: [1, 2, 3],
        rows,
        chart: { type: "hbar", title: "Budget overruns", xCol: 0, yCols: [3], format: "currency" },
      };
    },
  },
  {
    id: "budget-list",
    name: "Active Budgets",
    category: "Budgets",
    description: "All configured budgets with period metadata.",
    compute: (d) => ({
      columns: ["Name", "Period", "Start", "Amount"],
      numericColumns: [3],
      rows: (d.budgets as any[]).map((b) => [b.name, b.period, b.start_date, fmtINR(num(b.amount))]),
      chart: { type: "hbar", title: "Budget sizes", xCol: 0, yCols: [3], format: "currency" },
    }),
  },

  // ============== BILLS ==============
  {
    id: "bills-upcoming",
    name: "Upcoming Bills (60 days)",
    category: "Bills",
    description: "Bills due in the next 60 days, sorted by due date.",
    compute: (d) => {
      const today = new Date();
      const horizon = new Date();
      horizon.setDate(today.getDate() + 60);
      const rows = (d.bills as any[])
        .filter((b) => b.status !== "paid" && b.due_date && new Date(b.due_date) <= horizon)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .map((b) => [b.name, b.due_date, b.status ?? "—", b.priority ?? "—", fmtINR(num(b.amount))]);
      return {
        columns: ["Bill", "Due date", "Status", "Priority", "Amount"],
        numericColumns: [4],
        rows,
        chart: { type: "hbar", title: "Upcoming amounts by bill", xCol: 0, yCols: [4], maxItems: 15, format: "currency" },
      };
    },
  },
  {
    id: "bills-paid",
    name: "Bills Paid (Period)",
    category: "Bills",
    description: "Every bill payment recorded in the selected period.",
    compute: (d) => {
      const billName = new Map((d.bills as any[]).map((b) => [b.id, b.name]));
      const rows = (d.billPayments as any[]).map((p) => [
        p.paid_on,
        billName.get(p.bill_id) ?? "—",
        p.status ?? "paid",
        fmtINR(num(p.amount)),
      ]);
      return {
        columns: ["Paid on", "Bill", "Status", "Amount"],
        numericColumns: [3],
        rows,
        chart: { type: "bar", title: "Payments over time", xCol: 0, yCols: [3], format: "currency" },
      };
    },
  },
  {
    id: "bills-overdue",
    name: "Overdue Bills",
    category: "Bills",
    description: "Bills whose due date has passed without payment.",
    compute: (d) => {
      const today = new Date().toISOString().slice(0, 10);
      const rows = (d.bills as any[])
        .filter((b) => b.status !== "paid" && b.due_date < today)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .map((b) => [b.name, b.due_date, b.priority ?? "—", fmtINR(num(b.amount))]);
      return {
        columns: ["Bill", "Due date", "Priority", "Amount"],
        numericColumns: [3],
        rows,
        chart: { type: "hbar", title: "Overdue amounts", xCol: 0, yCols: [3], format: "currency" },
      };
    },
  },
  {
    id: "bills-autopay",
    name: "Auto-pay Coverage",
    category: "Bills",
    description: "Which recurring bills are on autopilot.",
    compute: (d) => {
      const rows = (d.bills as any[]).map((b) => [
        b.name,
        b.auto_pay ? "Yes" : "No",
        b.whatsapp_enabled ? "Yes" : "No",
        fmtINR(num(b.amount)),
      ]);
      const auto = (d.bills as any[]).filter((b) => b.auto_pay).length;
      const manual = (d.bills as any[]).length - auto;
      return {
        columns: ["Bill", "Auto-pay", "WhatsApp", "Amount"],
        numericColumns: [3],
        rows,
        chart: {
          type: "pie",
          title: "Auto-pay coverage",
          xCol: 0,
          yCols: [1],
          format: "number",
        },
        // Overwrite chart data via footer? Instead simplify: use hbar of amounts by bill.
        chart2: { type: "hbar", title: "Bill amounts", xCol: 0, yCols: [3], maxItems: 15, format: "currency" },
      };
    },
  },

  // ============== PAYEES ==============
  {
    id: "top-payees-spend",
    name: "Top Payees by Spend",
    category: "Payees",
    description: "Ranked payee list by total outflow.",
    compute: (d) => {
      const rows = groupSum(
        (d.transactions as any[]).filter((t) => t.type === "expense"),
        (t: any) => t.merchant?.trim() || t.note?.trim() || "Unknown",
        (t: any) => num(t.amount),
      );
      return {
        columns: ["Payee", "Amount"],
        numericColumns: [1],
        rows: rows.slice(0, 100).map(([k, v]) => [k, fmtINR(v)]),
        chart: { type: "hbar", title: "Top payees", xCol: 0, yCols: [1], maxItems: 15, format: "currency" },
      };
    },
  },
  {
    id: "top-payees-freq",
    name: "Top Payees by Frequency",
    category: "Payees",
    description: "Which merchants you interact with most often.",
    compute: (d) => {
      const rows = groupSum(
        d.transactions as any[],
        (t: any) => t.merchant?.trim() || t.note?.trim() || "Unknown",
        () => 1,
      );
      return {
        columns: ["Payee", "Txns"],
        numericColumns: [1],
        rows: rows.slice(0, 100).map(([k, v]) => [k, fmtNum(v)]),
        chart: { type: "hbar", title: "Most frequent payees", xCol: 0, yCols: [1], maxItems: 15, format: "number" },
      };
    },
  },
  {
    id: "memorized-payees",
    name: "Memorized Payee Directory",
    category: "Payees",
    description: "All memorized payees with categorization and usage.",
    compute: (d) => ({
      columns: ["Payee", "Merchant type", "Default category", "Usage"],
      numericColumns: [3],
      rows: (d.payees as any[]).map((p) => [
        p.display_name ?? p.merchant,
        p.merchant_type ?? "—",
        p.default_category_id ? "Set" : "—",
        fmtNum(num(p.usage_count)),
      ]),
      chart: { type: "hbar", title: "Most-used payees", xCol: 0, yCols: [3], maxItems: 15, format: "number" },
    }),
  },

  // ============== TRANSACTIONS ==============
  {
    id: "txn-full",
    name: "Full Transaction Ledger",
    category: "Transactions",
    description: "Every transaction in the period. Use short date ranges to keep the PDF light.",
    compute: (d) => ({
      columns: ["Date", "Type", "Account", "Payee", "Category", "Amount"],
      numericColumns: [5],
      rows: (d.transactions as any[]).map((t) => [
        t.txn_date,
        t.type,
        t.account?.name ?? "—",
        t.merchant || t.note || "—",
        t.category?.name ?? "Uncategorized",
        fmtINR(num(t.amount)),
      ]),
    }),
  },
  {
    id: "txn-large",
    name: "Large Transactions",
    category: "Transactions",
    description: "Transactions above ₹10,000.",
    compute: (d) => ({
      columns: ["Date", "Type", "Payee", "Category", "Amount"],
      numericColumns: [4],
      rows: (d.transactions as any[])
        .filter((t) => num(t.amount) >= 10000)
        .sort((a, b) => num(b.amount) - num(a.amount))
        .map((t) => [
          t.txn_date,
          t.type,
          t.merchant || t.note || "—",
          t.category?.name ?? "Uncategorized",
          fmtINR(num(t.amount)),
        ]),
      chart: { type: "hbar", title: "Largest transactions", xCol: 2, yCols: [4], maxItems: 15, format: "currency" },
    }),
  },
  {
    id: "txn-uncategorized",
    name: "Uncategorized Transactions",
    category: "Transactions",
    description: "Transactions without a category assigned — great for cleanup.",
    compute: (d) => ({
      columns: ["Date", "Type", "Payee", "Account", "Amount"],
      numericColumns: [4],
      rows: (d.transactions as any[])
        .filter((t) => !t.category_id)
        .map((t) => [
          t.txn_date,
          t.type,
          t.merchant || t.note || "—",
          t.account?.name ?? "—",
          fmtINR(num(t.amount)),
        ]),
      chart: { type: "hbar", title: "Uncategorized by payee", xCol: 2, yCols: [4], maxItems: 12, format: "currency" },
    }),
  },
  {
    id: "txn-transfers",
    name: "Transfers Log",
    category: "Transactions",
    description: "All inter-account movements.",
    compute: (d) => {
      const accById = new Map((d.accounts as any[]).map((a) => [a.id, a.name]));
      return {
        columns: ["Date", "From", "To", "Amount", "Note"],
        numericColumns: [3],
        rows: (d.transactions as any[])
          .filter((t) => t.type === "transfer")
          .map((t) => [
            t.txn_date,
            t.account?.name ?? "—",
            accById.get(t.transfer_account_id) ?? "—",
            fmtINR(num(t.amount)),
            t.note ?? "",
          ]),
        chart: { type: "bar", title: "Transfers over time", xCol: 0, yCols: [3], format: "currency" },
      };
    },
  },
  {
    id: "txn-refunds",
    name: "Refunds & Credits",
    category: "Transactions",
    description: "Income transactions that look like refunds.",
    compute: (d) => ({
      columns: ["Date", "Payee", "Account", "Amount"],
      numericColumns: [3],
      rows: (d.transactions as any[])
        .filter(
          (t) =>
            t.type === "income" &&
            /(refund|reversal|cashback|credit|reimbursement)/i.test(`${t.merchant ?? ""} ${t.note ?? ""}`),
        )
        .map((t) => [t.txn_date, t.merchant || t.note || "—", t.account?.name ?? "—", fmtINR(num(t.amount))]),
      chart: { type: "bar", title: "Refunds over time", xCol: 0, yCols: [3], format: "currency" },
    }),
  },

  // ============== TAX & INVESTMENTS ==============
  {
    id: "tax-80c",
    name: "80C Contributions",
    category: "Tax & Investments",
    description: "Transactions to PPF, EPF, NPS and mutual funds that likely qualify for 80C.",
    compute: (d) => {
      const targetCats = new Set(["ppf", "epf", "nps", "mutual_fund"]);
      const rows = (d.transactions as any[])
        .filter((t) => (t.type === "transfer" || t.type === "expense") && targetCats.has(t.account?.category))
        .map((t) => [
          t.txn_date,
          t.account?.name ?? "—",
          t.account?.category ?? "—",
          fmtINR(num(t.amount)),
        ]);
      const total = rows.reduce((s, r) => s + num((r[3] as string).replace(/[^\d.-]/g, "")), 0);
      return {
        columns: ["Date", "Account", "Type", "Amount"],
        numericColumns: [3],
        rows,
        footer: ["", "", "Total", fmtINR(total)],
        chart: { type: "pie", title: "80C by instrument", xCol: 2, yCols: [3], format: "currency" },
      };
    },
  },
  {
    id: "investment-contributions",
    name: "Investment Contributions",
    category: "Tax & Investments",
    description: "All flows into investment-type accounts.",
    compute: (d) => {
      const invCats = new Set(["mutual_fund", "stocks", "ppf", "epf", "nps", "fixed_deposit", "recurring_deposit"]);
      const map = new Map<string, number>();
      for (const t of d.transactions as any[]) {
        if (!invCats.has(t.account?.category)) continue;
        const k = monthKey(t.txn_date);
        map.set(k, (map.get(k) ?? 0) + num(t.amount));
      }
      return {
        columns: ["Month", "Contribution"],
        numericColumns: [1],
        rows: [...map.entries()].sort().map(([m, v]) => [m, fmtINR(v)]),
        chart: { type: "bar", title: "Monthly investment contributions", xCol: 0, yCols: [1], format: "currency" },
      };
    },
  },
  {
    id: "loan-repayments",
    name: "Loan Repayments (EMIs)",
    category: "Tax & Investments",
    description: "Outflows to liability accounts — your EMI trail.",
    compute: (d) => {
      const rows = (d.transactions as any[])
        .filter((t) => t.type === "transfer")
        .filter((t) => (d.accounts as any[]).find((a) => a.id === t.transfer_account_id && a.is_liability))
        .map((t) => [t.txn_date, t.account?.name ?? "—", fmtINR(num(t.amount)), t.note ?? ""]);
      return {
        columns: ["Date", "From", "Amount", "Note"],
        numericColumns: [2],
        rows,
        chart: { type: "bar", title: "EMI outflows over time", xCol: 0, yCols: [2], format: "currency" },
      };
    },
  },
];

export const REPORT_CATEGORIES = Array.from(new Set(REPORTS.map((r) => r.category)));
