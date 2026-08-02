import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAccounts from "./tools/list-accounts";
import listTransactions from "./tools/list-transactions";
import listCategories from "./tools/list-categories";
import spendingByCategory from "./tools/spending-by-category";
import financialSummary from "./tools/financial-summary";
import listBudgets from "./tools/list-budgets";
import listBills from "./tools/list-bills";
import listGoals from "./tools/list-goals";
import createTransaction from "./tools/create-transaction";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged and is inlined at build time.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "paisa",
  title: "Paisa",
  version: "0.1.0",
  instructions:
    "Tools for Paisa, a personal finance app for Indian users. All amounts are in INR. Use `financial_summary` for net worth and monthly cash flow, `list_accounts` / `list_transactions` / `list_categories` for ledger detail, `spending_by_category` for expense breakdowns, and `list_budgets`, `list_bills`, `list_goals` for planning data. `create_transaction` records a new income or expense — confirm the account, amount and date with the user first.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    financialSummary,
    listAccounts,
    listTransactions,
    listCategories,
    spendingByCategory,
    listBudgets,
    listBills,
    listGoals,
    createTransaction,
  ],
});
