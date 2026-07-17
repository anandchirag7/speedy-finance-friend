import { ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  PiggyBank,
  Wallet,
  CalendarClock,
  AlertCircle,
  TrendingUp,
  CreditCard,
  Target,
  Landmark,
  Home,
  Receipt,
  Briefcase,
  FileText,
  BarChart3,
  Building2,
  Layers,
  Calendar,
  Bell,
  Coins,
  LineChart as LineChartIcon,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Legend, AreaChart, Area,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { formatINR, formatLakhCrore, formatDate } from "@/lib/format";
import { ACCOUNT_TYPE_BY_CATEGORY } from "@/lib/account-types";

const CHART_COLORS = [
  "var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)",
  "var(--chart-5)","var(--chart-6)","var(--chart-7)",
];
const TOOLTIP_STYLE = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: 8, fontSize: 12,
};

export type WidgetCategory =
  | "Overview" | "Banking" | "Spending" | "Budget" | "Investing"
  | "Property & Debt" | "Planning" | "Taxes" | "Business";

export type WidgetDef = {
  type: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: WidgetCategory;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  render: (props: { data: any; settings?: Record<string, any> }) => ReactNode;
};

// ---------- reusable shell ----------
function Shell({ title, description, icon: Icon, action, children }: {
  title: string; description?: string; icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode; children: ReactNode;
}) {
  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {Icon && <Icon className="h-4 w-4" />}<span className="truncate">{title}</span>
            </CardTitle>
            {description && <CardDescription className="truncate">{description}</CardDescription>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-auto">{children}</CardContent>
    </Card>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-muted">
          <Layers className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">Widget preview coming soon</p>
      </div>
    </div>
  );
}

// ---------- widget renderers ----------
function NetWorthHero({ data }: any) {
  const d = data ?? {};
  return (
    <Shell title="Total Net Worth">
      <p className="font-display text-3xl md:text-4xl font-semibold tabular-nums">{formatINR(d.netWorth ?? 0)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{formatLakhCrore(d.netWorth ?? 0)}</p>
      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Assets</p><p className="font-semibold text-success tabular-nums">{formatINR(d.assets ?? 0)}</p></div>
        <div><p className="text-xs text-muted-foreground">Liabilities</p><p className="font-semibold text-destructive tabular-nums">{formatINR(d.liabilities ?? 0)}</p></div>
        <div><p className="text-xs text-muted-foreground">Accounts</p><p className="font-semibold tabular-nums">{d.accountsCount ?? 0}</p></div>
      </div>
    </Shell>
  );
}

function IncomeCard({ data }: any) {
  return (
    <Shell title="Income" icon={ArrowUpRight}>
      <p className="text-2xl font-semibold text-success tabular-nums">{formatINR(data?.income ?? 0)}</p>
      <p className="text-xs text-muted-foreground mt-1">Period income</p>
    </Shell>
  );
}
function ExpenseCard({ data }: any) {
  return (
    <Shell title="Expenses" icon={ArrowDownRight}>
      <p className="text-2xl font-semibold text-destructive tabular-nums">{formatINR(data?.expense ?? 0)}</p>
      <p className="text-xs text-muted-foreground mt-1">Period spend</p>
    </Shell>
  );
}
function SavingsCard({ data }: any) {
  const v = data?.savings ?? 0;
  return (
    <Shell title="Savings" icon={PiggyBank}>
      <p className={`text-2xl font-semibold tabular-nums ${v >= 0 ? "text-success" : "text-destructive"}`}>{formatINR(v)}</p>
      <p className="text-xs text-muted-foreground mt-1">Income − Expenses</p>
    </Shell>
  );
}

function NetWorthTrend({ data }: any) {
  const trend = (data?.netWorthTrend ?? []) as Array<{ label: string; netWorth: number }>;
  return (
    <Shell title="Net worth trend" description="Recent snapshots" icon={TrendingUp}>
      {trend.length < 2 ? <EmptyLine>Snapshots will build up over time.</EmptyLine> : (
        <div className="h-full min-h-40">
          <ResponsiveContainer>
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="nwFillW" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatLakhCrore(v as number)} width={60} />
              <Tooltip formatter={(v: any) => formatINR(Number(v))} contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="netWorth" stroke="var(--chart-1)" strokeWidth={2} fill="url(#nwFillW)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Shell>
  );
}

function CashFlow({ data }: any) {
  const cf = (data?.cashFlow ?? []);
  return (
    <Shell title="Income vs Expenses" description="Cash flow" icon={BarChart3}>
      {cf.length === 0 ? <EmptyLine>No transactions yet.</EmptyLine> : (
        <div className="h-full min-h-40">
          <ResponsiveContainer>
            <BarChart data={cf} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatLakhCrore(v as number)} width={60} />
              <Tooltip formatter={(v: any) => formatINR(Number(v))} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Expenses" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Shell>
  );
}

function UpcomingBills({ data }: any) {
  const bills = (data?.upcomingBills ?? []) as any[];
  return (
    <Shell title="Upcoming bills" description="Next 30 days" icon={CalendarClock}
      action={bills.length > 0 && (
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Due</div>
          <div className="text-sm font-semibold tabular-nums">{formatINR(data?.upcomingBillsTotal ?? 0)}</div>
        </div>
      )}>
      {bills.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Nothing due in the next 30 days.
          <div className="mt-3"><Button asChild variant="outline" size="sm"><Link to="/bills">Manage bills</Link></Button></div>
        </div>
      ) : (
        <ul className="divide-y">
          {bills.map((b: any) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  {b.overdue && <Badge variant="destructive" className="h-5 gap-1 px-1.5 text-[10px]"><AlertCircle className="h-3 w-3" /> Overdue</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(b.due_date)}{b.accountName ? ` · ${b.accountName}` : ""}</p>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{formatINR(b.amount)}</div>
                <div className={`text-[11px] tabular-nums ${b.overdue ? "text-destructive" : b.daysUntil <= 3 ? "text-warning" : "text-muted-foreground"}`}>
                  {b.overdue ? `${Math.abs(b.daysUntil)}d late` : b.daysUntil === 0 ? "Today" : `in ${b.daysUntil}d`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function AssetAllocation({ data }: any) {
  const catData = Object.entries((data?.byCategory ?? {}) as Record<string, number>).map(([k, v]) => ({
    name: ACCOUNT_TYPE_BY_CATEGORY[k as keyof typeof ACCOUNT_TYPE_BY_CATEGORY]?.label ?? k,
    value: v,
  }));
  return (
    <Shell title="Asset allocation" description="Where your money lives" icon={PieChart}>
      {catData.length === 0 ? <EmptyLine>No assets yet.</EmptyLine> : (
        <div className="h-full min-h-40">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                {catData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => formatINR(Number(v))} contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </Shell>
  );
}

function TopSpending({ data }: any) {
  const topSpend = Object.entries((data?.spendByCat ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <Shell title="Top spending" description="Where your outflow goes" icon={Coins}>
      {topSpend.length === 0 ? <EmptyLine>No expenses yet.</EmptyLine> : (
        <div className="space-y-3">
          {topSpend.map(([name, amt]) => {
            const pct = (data?.expense ?? 0) > 0 ? ((amt as number) / data.expense) * 100 : 0;
            return (
              <div key={name}>
                <div className="flex items-center justify-between text-sm"><span className="truncate">{name}</span><span className="tabular-nums text-muted-foreground">{formatINR(amt as number)}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

function RecentTransactions({ data }: any) {
  const items = (data?.recentTransactions ?? []) as any[];
  return (
    <Shell title="Recent transactions" icon={Receipt}>
      {items.length === 0 ? <EmptyLine>No transactions.</EmptyLine> : (
        <ul className="divide-y">
          {items.slice(0, 8).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0"><p className="truncate text-sm">{t.merchant || t.description || "Transaction"}</p><p className="text-xs text-muted-foreground">{formatDate(t.txn_date ?? t.date)}</p></div>
              <div className={`text-sm font-semibold tabular-nums ${Number(t.amount) < 0 ? "text-destructive" : "text-success"}`}>{formatINR(Math.abs(Number(t.amount)))}</div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function AccountSummary({ data }: any) {
  const cats = data?.byCategory ?? {};
  const entries = Object.entries(cats) as [string, number][];
  return (
    <Shell title="Account summary" icon={Wallet}>
      {entries.length === 0 ? <EmptyLine>No accounts.</EmptyLine> : (
        <ul className="divide-y">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between py-2 text-sm">
              <span>{ACCOUNT_TYPE_BY_CATEGORY[k as keyof typeof ACCOUNT_TYPE_BY_CATEGORY]?.label ?? k}</span>
              <span className="tabular-nums font-medium">{formatINR(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

// placeholder factory
const placeholder = (title: string, icon: any, category: WidgetCategory, description = ""): WidgetDef => ({
  type: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  title, description, icon, category,
  defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
  render: () => <Shell title={title} icon={icon}><ComingSoon label={title} /></Shell>,
});

// ---------- REGISTRY ----------
export const WIDGET_REGISTRY: WidgetDef[] = [
  // Overview
  { type: "net-worth", title: "Net Worth", description: "Total assets minus liabilities", icon: Wallet, category: "Overview",
    defaultSize: { w: 12, h: 4 }, minSize: { w: 4, h: 3 }, render: NetWorthHero },
  { type: "net-worth-trend", title: "Net Worth Trend", description: "History snapshots over time", icon: TrendingUp, category: "Overview",
    defaultSize: { w: 6, h: 5 }, minSize: { w: 4, h: 4 }, render: NetWorthTrend },
  { type: "cash-flow", title: "Cash Flow", description: "Income vs expenses by period", icon: BarChart3, category: "Overview",
    defaultSize: { w: 6, h: 5 }, minSize: { w: 4, h: 4 }, render: CashFlow },
  { type: "alerts", title: "Alerts", description: "Important account alerts", icon: Bell, category: "Overview",
    defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 3 }, render: () => <Shell title="Alerts" icon={Bell}><ComingSoon label="Alerts" /></Shell> },
  { type: "calendar", title: "Calendar", description: "Monthly financial events", icon: Calendar, category: "Overview",
    defaultSize: { w: 6, h: 5 }, minSize: { w: 4, h: 4 }, render: () => <Shell title="Calendar" icon={Calendar}><ComingSoon label="Calendar" /></Shell> },

  // Banking
  { type: "account-summary", title: "Account Summary", description: "Balances grouped by type", icon: Wallet, category: "Banking",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: AccountSummary },
  { type: "recent-transactions", title: "Recent Transactions", description: "Latest activity", icon: Receipt, category: "Banking",
    defaultSize: { w: 6, h: 5 }, minSize: { w: 4, h: 4 }, render: RecentTransactions },
  { type: "credit-cards", title: "Credit Cards", description: "Balances and dues", icon: CreditCard, category: "Banking",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: () => <Shell title="Credit Cards" icon={CreditCard}><ComingSoon label="Credit Cards" /></Shell> },
  { type: "savings", title: "Savings", description: "Savings balances", icon: PiggyBank, category: "Banking",
    defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 3 }, render: SavingsCard },

  // Spending
  { type: "income", title: "Income", description: "Period income", icon: ArrowUpRight, category: "Spending",
    defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 3 }, render: IncomeCard },
  { type: "expenses", title: "Expenses", description: "Period spend", icon: ArrowDownRight, category: "Spending",
    defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 3 }, render: ExpenseCard },
  { type: "top-spending", title: "Top Spending", description: "Highest expense categories", icon: Coins, category: "Spending",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: TopSpending },
  { type: "spending-trends", title: "Spending Trends", description: "Month-over-month view", icon: LineChartIcon, category: "Spending",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 4, h: 3 }, render: () => <Shell title="Spending Trends" icon={LineChartIcon}><ComingSoon label="Spending Trends" /></Shell> },

  // Budget
  { type: "budget-progress", title: "Budget Progress", description: "How you're tracking", icon: Target, category: "Budget",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: () => <Shell title="Budget Progress" icon={Target}><ComingSoon label="Budget Progress" /></Shell> },
  { type: "savings-goals", title: "Savings Goals", description: "Progress toward goals", icon: PiggyBank, category: "Budget",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: () => <Shell title="Savings Goals" icon={PiggyBank}><ComingSoon label="Savings Goals" /></Shell> },
  { type: "upcoming-bills", title: "Upcoming Bills", description: "Bills due in next 30 days", icon: CalendarClock, category: "Budget",
    defaultSize: { w: 6, h: 5 }, minSize: { w: 3, h: 3 }, render: UpcomingBills },

  // Investing
  { type: "portfolio-allocation", title: "Portfolio Allocation", description: "Asset class breakdown", icon: PieChart, category: "Investing",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: AssetAllocation },
  { type: "asset-allocation", title: "Asset Allocation", description: "Where your wealth is parked", icon: Layers, category: "Investing",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: AssetAllocation },
  { type: "investment-performance", title: "Investment Performance", description: "Returns over time", icon: TrendingUp, category: "Investing",
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, render: () => <Shell title="Investment Performance" icon={TrendingUp}><ComingSoon label="Investment Performance" /></Shell> },

  // Property & Debt
  placeholder("Loan Summary", Landmark, "Property & Debt", "Outstanding loans"),
  placeholder("Property Value", Home, "Property & Debt", "Real-estate assets"),

  // Planning
  placeholder("Retirement Plan", Target, "Planning", "Long-term projections"),
  placeholder("Emergency Fund", PiggyBank, "Planning", "Fund coverage months"),

  // Taxes
  placeholder("Tax Calendar", Calendar, "Taxes", "Key tax dates"),
  placeholder("Capital Gains", Coins, "Taxes", "Realised & unrealised gains"),

  // Business
  placeholder("Business Cash Flow", BarChart3, "Business", "Inflow vs outflow"),
  placeholder("Invoice Accounts", FileText, "Business", "Receivables snapshot"),
  placeholder("Profit & Loss", Briefcase, "Business", "P&L summary"),
];

export const WIDGET_BY_TYPE: Record<string, WidgetDef> = Object.fromEntries(
  WIDGET_REGISTRY.map((w) => [w.type, w])
);

export const CATEGORIES: WidgetCategory[] = [
  "Overview","Banking","Spending","Budget","Investing","Property & Debt","Planning","Taxes","Business",
];

export const AI_RECOMMENDED_TYPES = [
  "spending-trends","portfolio-allocation","budget-progress","upcoming-bills","savings-goals","net-worth",
];
