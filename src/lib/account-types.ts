// Central registry of all Indian account types. Category enum is stored in DB;
// subtype is a free-text tag we drive from these lists.

export type AccountCategory =
  | "bank"
  | "cash"
  | "credit_card"
  | "fixed_deposit"
  | "recurring_deposit"
  | "ppf"
  | "epf"
  | "nps"
  | "mutual_fund"
  | "stocks"
  | "post_office"
  | "gold"
  | "real_estate"
  | "loan"
  | "insurance"
  | "chit_fund"
  | "other";

export type AccountTypeDef = {
  category: AccountCategory;
  label: string;
  subtypes?: { value: string; label: string }[];
  isLiability?: boolean;
  excludedFromNetWorth?: boolean;
  group: "cash" | "credit" | "deposits" | "retirement" | "market" | "post_office" | "gold" | "property" | "loans" | "insurance" | "other";
  description: string;
};

export const ACCOUNT_TYPES: AccountTypeDef[] = [
  { category: "bank", label: "Bank Account", group: "cash", description: "Savings, Current, NRE, NRO", subtypes: [
    { value: "savings", label: "Savings" },
    { value: "current", label: "Current" },
    { value: "nre", label: "NRE" },
    { value: "nro", label: "NRO" },
  ]},
  { category: "cash", label: "Cash in Hand", group: "cash", description: "Physical cash" },
  { category: "credit_card", label: "Credit Card", group: "credit", isLiability: true, description: "Statement balance, cycle & due date" },
  { category: "fixed_deposit", label: "Fixed Deposit (FD)", group: "deposits", description: "Principal, rate, maturity" },
  { category: "recurring_deposit", label: "Recurring Deposit (RD)", group: "deposits", description: "Monthly installment RD" },
  { category: "ppf", label: "PPF", group: "retirement", description: "Public Provident Fund — ₹1.5L annual cap" },
  { category: "epf", label: "EPF / PF", group: "retirement", description: "Employee Provident Fund (UAN)" },
  { category: "nps", label: "NPS", group: "retirement", description: "National Pension System (Tier 1/2)", subtypes: [
    { value: "tier1", label: "Tier 1" },
    { value: "tier2", label: "Tier 2" },
  ]},
  { category: "mutual_fund", label: "Mutual Fund", group: "market", description: "Folio, scheme, units × NAV" },
  { category: "stocks", label: "Stocks / Equity", group: "market", description: "NSE/BSE demat holdings" },
  { category: "post_office", label: "Post Office Scheme", group: "post_office", description: "NSC, KVP, SSY, SCSS", subtypes: [
    { value: "nsc", label: "NSC" },
    { value: "kvp", label: "KVP" },
    { value: "ssy", label: "Sukanya Samriddhi" },
    { value: "scss", label: "Senior Citizen SS" },
  ]},
  { category: "gold", label: "Gold", group: "gold", description: "Physical, Digital, SGB", subtypes: [
    { value: "physical", label: "Physical Gold" },
    { value: "digital", label: "Digital Gold" },
    { value: "sgb", label: "Sovereign Gold Bond" },
  ]},
  { category: "real_estate", label: "Real Estate", group: "property", description: "Property valuation" },
  { category: "loan", label: "Loan", group: "loans", isLiability: true, description: "Home, personal, car, education, gold", subtypes: [
    { value: "home", label: "Home Loan" },
    { value: "personal", label: "Personal Loan" },
    { value: "car", label: "Car Loan" },
    { value: "education", label: "Education Loan" },
    { value: "gold", label: "Gold Loan" },
  ]},
  { category: "insurance", label: "Insurance", group: "insurance", excludedFromNetWorth: true, description: "Term, Life, Health (tracked, not in net worth)", subtypes: [
    { value: "term", label: "Term" },
    { value: "life", label: "Life / ULIP" },
    { value: "health", label: "Health" },
  ]},
  { category: "chit_fund", label: "Chit Fund", group: "other", description: "Monthly contribution & payout" },
  { category: "other", label: "Other / Custom", group: "other", description: "Anything else" },
];

export const ACCOUNT_TYPE_BY_CATEGORY: Record<AccountCategory, AccountTypeDef> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.category, t]),
) as Record<AccountCategory, AccountTypeDef>;

export const GROUP_LABELS: Record<AccountTypeDef["group"], string> = {
  cash: "Bank & Cash",
  credit: "Credit Cards",
  deposits: "Deposits",
  retirement: "Retirement",
  market: "Market Investments",
  post_office: "Post Office",
  gold: "Gold",
  property: "Real Estate",
  loans: "Loans & Liabilities",
  insurance: "Insurance",
  other: "Other",
};
