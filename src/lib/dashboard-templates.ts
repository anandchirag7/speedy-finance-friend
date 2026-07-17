import type { WidgetLayoutItem } from "@/lib/dashboards.functions";

const uid = () => Math.random().toString(36).slice(2, 10);

const mk = (type: string, x: number, y: number, w: number, h: number): WidgetLayoutItem => ({
  i: uid(), type, x, y, w, h,
});

export type TemplateDef = {
  key: string;
  name: string;
  description: string;
  layout: WidgetLayoutItem[];
};

export const TEMPLATES: TemplateDef[] = [
  {
    key: "personal-finance",
    name: "Personal Finance",
    description: "Net worth, cash flow, bills, and spending at a glance.",
    layout: [
      mk("net-worth", 0, 0, 12, 3),
      mk("income", 0, 3, 4, 2),
      mk("expenses", 4, 3, 4, 2),
      mk("savings", 8, 3, 4, 2),
      mk("net-worth-trend", 0, 5, 6, 5),
      mk("cash-flow", 6, 5, 6, 5),
      mk("upcoming-bills", 0, 10, 6, 5),
      mk("top-spending", 6, 10, 6, 5),
    ],

  },
  {
    key: "investing",
    name: "Investing",
    description: "Portfolio, allocation, and performance-first layout.",
    layout: [
      mk("net-worth", 0, 0, 12, 4),
      mk("portfolio-allocation", 0, 4, 6, 5),
      mk("investment-performance", 6, 4, 6, 5),
      mk("asset-allocation", 0, 9, 6, 4),
      mk("net-worth-trend", 6, 9, 6, 4),
    ],
  },
  {
    key: "budget",
    name: "Budget",
    description: "Focus on budgets, spending, and upcoming bills.",
    layout: [
      mk("budget-progress", 0, 0, 6, 5),
      mk("top-spending", 6, 0, 6, 5),
      mk("upcoming-bills", 0, 5, 6, 5),
      mk("cash-flow", 6, 5, 6, 5),
      mk("savings-goals", 0, 10, 12, 4),
    ],
  },
  {
    key: "business",
    name: "Business",
    description: "P&L, invoicing, and business cash-flow view.",
    layout: [
      mk("business-cash-flow", 0, 0, 12, 5),
      mk("profit-loss", 0, 5, 6, 5),
      mk("invoice-accounts", 6, 5, 6, 5),
    ],
  },
  {
    key: "retirement",
    name: "Retirement",
    description: "Long-horizon planning and goal tracking.",
    layout: [
      mk("net-worth", 0, 0, 12, 4),
      mk("retirement-plan", 0, 4, 6, 5),
      mk("savings-goals", 6, 4, 6, 5),
      mk("asset-allocation", 0, 9, 12, 4),
    ],
  },
  {
    key: "taxes",
    name: "Taxes",
    description: "Tax calendar and capital gains overview.",
    layout: [
      mk("tax-calendar", 0, 0, 6, 5),
      mk("capital-gains", 6, 0, 6, 5),
    ],
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Only the essentials.",
    layout: [
      mk("net-worth", 0, 0, 12, 4),
      mk("cash-flow", 0, 4, 12, 5),
    ],
  },
];

export const TEMPLATE_BY_KEY: Record<string, TemplateDef> = Object.fromEntries(
  TEMPLATES.map((t) => [t.key, t])
);
