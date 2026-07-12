import { createServerFn } from "@tanstack/react-start";

const DEMO_EMAIL = "demo@paisa.app";
const DEMO_PASSWORD = "DemoPaisa!2026";

export const ensureDemoAccount = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1. Ensure user exists (idempotent)
  let userId: string | null = null;
  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
  if (existing) {
    userId = existing.id;
  } else {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Demo User" },
    });
    if (error) throw error;
    userId = created.user!.id;
  }

  // 2. Find household (created by handle_new_user trigger)
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("default_household_id")
    .eq("id", userId!)
    .maybeSingle();
  const householdId = profile?.default_household_id;
  if (!householdId) throw new Error("Demo household missing");

  // 3. If already seeded (has accounts), skip
  const { count } = await supabaseAdmin
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if ((count ?? 0) > 0) {
    return { email: DEMO_EMAIL, password: DEMO_PASSWORD, seeded: false };
  }

  // 4. Seed accounts
  const accounts = [
    { name: "HDFC Savings", institution: "HDFC Bank", category: "bank", subtype: "savings", opening_balance: 185000, current_balance: 185000, account_number_last4: "4521" },
    { name: "ICICI Salary", institution: "ICICI Bank", category: "bank", subtype: "savings", opening_balance: 92000, current_balance: 92000, account_number_last4: "7788" },
    { name: "Cash Wallet", institution: null, category: "cash", opening_balance: 3500, current_balance: 3500 },
    { name: "HDFC Regalia Credit Card", institution: "HDFC Bank", category: "credit_card", is_liability: true, opening_balance: 42800, current_balance: 42800, account_number_last4: "9012", details: { credit_limit: 300000, cycle_day: 5, due_day: 25 } },
    { name: "SBI FD — 2027", institution: "SBI", category: "fixed_deposit", opening_balance: 500000, current_balance: 500000, details: { rate_pct: 7.1, maturity_date: "2027-08-15" } },
    { name: "PPF — SBI", institution: "SBI", category: "ppf", opening_balance: 425000, current_balance: 425000 },
    { name: "EPF (UAN)", institution: "EPFO", category: "epf", opening_balance: 380000, current_balance: 380000 },
    { name: "NPS Tier 1", institution: "HDFC Pension", category: "nps", subtype: "tier1", opening_balance: 145000, current_balance: 145000 },
    { name: "Zerodha Equity", institution: "Zerodha", category: "stocks", opening_balance: 265000, current_balance: 265000 },
    { name: "Groww Mutual Funds", institution: "Groww", category: "mutual_fund", opening_balance: 340000, current_balance: 340000 },
    { name: "SGB 2023-24 Series III", institution: "RBI", category: "gold", subtype: "sgb", opening_balance: 62000, current_balance: 62000, details: { grams: 10 } },
    { name: "Home Loan — HDFC", institution: "HDFC", category: "loan", subtype: "home", is_liability: true, opening_balance: 3250000, current_balance: 3250000, details: { rate_pct: 8.6, tenure_months: 240, emi: 28500 } },
    { name: "Term Insurance — HDFC Life", institution: "HDFC Life", category: "insurance", subtype: "term", excluded_from_net_worth: true, opening_balance: 0, current_balance: 0, details: { sum_assured: 10000000, premium_yearly: 14500 } },
  ];

  const { data: insertedAccounts, error: accErr } = await supabaseAdmin
    .from("accounts")
    .insert(accounts.map((a) => ({ ...a, household_id: householdId, currency: "INR" })))
    .select("id, name, category");
  if (accErr) throw accErr;

  const acc = (name: string) => insertedAccounts!.find((a) => a.name === name)!.id;

  // 5. Categories map
  const { data: cats } = await supabaseAdmin
    .from("categories")
    .select("id, name, kind, parent_id")
    .eq("household_id", householdId);
  const cat = (name: string) => cats!.find((c) => c.name === name)?.id ?? null;

  // 6. Transactions — last 90 days
  const today = new Date();
  const d = (daysAgo: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() - daysAgo);
    return dt.toISOString().slice(0, 10);
  };

  const txns: any[] = [];
  // Monthly salary x3
  for (const daysAgo of [3, 33, 63]) {
    txns.push({
      account_id: acc("ICICI Salary"),
      category_id: cat("Salary"),
      type: "income",
      amount: 145000,
      txn_date: d(daysAgo),
      note: "Monthly salary",
    });
  }
  // Rent x3
  for (const daysAgo of [5, 35, 65]) {
    txns.push({
      account_id: acc("HDFC Savings"),
      category_id: cat("Rent"),
      type: "expense",
      amount: 32000,
      txn_date: d(daysAgo),
      note: "Rent — Landlord",
    });
  }
  // EMI x3
  for (const daysAgo of [7, 37, 67]) {
    txns.push({
      account_id: acc("HDFC Savings"),
      category_id: cat("EMIs & Loans"),
      type: "expense",
      amount: 28500,
      txn_date: d(daysAgo),
      note: "Home loan EMI",
    });
  }
  // Groceries — spread
  const grocery = [
    [2, 3200, "BigBasket"], [9, 1850, "Reliance Fresh"], [16, 2400, "DMart"],
    [24, 1600, "BigBasket"], [31, 2900, "DMart"], [40, 2100, "Local kirana"],
    [48, 3400, "BigBasket"], [55, 1750, "Reliance Fresh"], [70, 2600, "DMart"],
  ];
  for (const [daysAgo, amt, note] of grocery) {
    txns.push({ account_id: acc("HDFC Regalia Credit Card"), category_id: cat("Groceries"), type: "expense", amount: amt, txn_date: d(daysAgo as number), note: note as string });
  }
  // Eating out
  const eatingOut = [[1, 850, "Swiggy — dinner"], [4, 1200, "Restaurant"], [11, 640, "Zomato"], [18, 1450, "Weekend brunch"], [26, 780, "Swiggy"], [34, 1600, "Dinner out"], [45, 920, "Zomato"], [58, 1350, "Restaurant"]];
  for (const [daysAgo, amt, note] of eatingOut) {
    txns.push({ account_id: acc("HDFC Regalia Credit Card"), category_id: cat("Eating Out"), type: "expense", amount: amt, txn_date: d(daysAgo as number), note: note as string });
  }
  // Fuel
  for (const [daysAgo, amt] of [[6, 2400], [22, 2500], [38, 2300], [54, 2600], [72, 2450]] as const) {
    txns.push({ account_id: acc("HDFC Regalia Credit Card"), category_id: cat("Fuel"), type: "expense", amount: amt, txn_date: d(daysAgo), note: "IOCL Petrol" });
  }
  // Utilities
  for (const [daysAgo, cat_name, amt, note] of [
    [10, "Electricity", 2800, "BESCOM"],
    [10, "Mobile", 799, "Jio postpaid"],
    [10, "Internet", 1199, "ACT Fiber"],
    [40, "Electricity", 2500, "BESCOM"],
    [40, "Mobile", 799, "Jio postpaid"],
    [40, "Internet", 1199, "ACT Fiber"],
    [70, "Electricity", 2650, "BESCOM"],
  ] as const) {
    txns.push({ account_id: acc("HDFC Savings"), category_id: cat(cat_name), type: "expense", amount: amt, txn_date: d(daysAgo), note });
  }
  // Auto/cab
  for (const [daysAgo, amt, note] of [[3, 320, "Uber"], [12, 180, "Auto"], [19, 410, "Ola"], [27, 250, "Uber"], [41, 380, "Ola"], [56, 220, "Auto"]] as const) {
    txns.push({ account_id: acc("HDFC Regalia Credit Card"), category_id: cat("Auto/Cab"), type: "expense", amount: amt, txn_date: d(daysAgo), note });
  }
  // Shopping
  for (const [daysAgo, amt, note] of [[8, 4500, "Amazon — headphones"], [21, 2800, "Myntra"], [44, 6200, "Flipkart"], [62, 3400, "Amazon"]] as const) {
    txns.push({ account_id: acc("HDFC Regalia Credit Card"), category_id: cat("Online Shopping"), type: "expense", amount: amt, txn_date: d(daysAgo), note });
  }
  // Health
  for (const [daysAgo, amt, note] of [[15, 850, "Apollo Pharmacy"], [50, 1400, "Doctor consult"]] as const) {
    txns.push({ account_id: acc("HDFC Savings"), category_id: cat("Medicines"), type: "expense", amount: amt, txn_date: d(daysAgo), note });
  }
  // Entertainment
  for (const [daysAgo, amt, note] of [[13, 499, "Netflix"], [43, 499, "Netflix"], [17, 1200, "PVR movie"]] as const) {
    txns.push({ account_id: acc("HDFC Regalia Credit Card"), category_id: cat("Entertainment"), type: "expense", amount: amt, txn_date: d(daysAgo), note });
  }
  // SIP investments (as transfers via expense to Investments category for demo simplicity)
  for (const daysAgo of [5, 35, 65]) {
    txns.push({ account_id: acc("HDFC Savings"), category_id: cat("SIP"), type: "expense", amount: 25000, txn_date: d(daysAgo), note: "SIP — Groww MFs" });
  }
  // Interest income
  txns.push({ account_id: acc("HDFC Savings"), category_id: cat("Interest"), type: "income", amount: 620, txn_date: d(30), note: "Savings interest" });
  txns.push({ account_id: acc("HDFC Savings"), category_id: cat("Interest"), type: "income", amount: 640, txn_date: d(60), note: "Savings interest" });
  // Freelance
  txns.push({ account_id: acc("ICICI Salary"), category_id: cat("Business Income"), type: "income", amount: 18000, txn_date: d(20), note: "Freelance project" });

  const { error: txnErr } = await supabaseAdmin.from("transactions").insert(
    txns.map((t) => ({ ...t, household_id: householdId, created_by: userId })),
  );
  if (txnErr) throw txnErr;

  // Recompute current balances from opening + txns
  for (const a of insertedAccounts!) {
    const aTxns = txns.filter((t) => t.account_id === a.id);
    const delta = aTxns.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
    const opening = accounts.find((x) => x.name === (insertedAccounts!.find((y) => y.id === a.id)?.name))?.opening_balance ?? 0;
    await supabaseAdmin.from("accounts").update({ current_balance: opening + delta }).eq("id", a.id);
  }

  // 7. Bills
  const nextDue = (day: number) => {
    const dt = new Date(today);
    dt.setDate(day);
    if (dt < today) dt.setMonth(dt.getMonth() + 1);
    return dt.toISOString().slice(0, 10);
  };
  await supabaseAdmin.from("bills").insert([
    { household_id: householdId, name: "Credit Card Bill", amount: 42800, due_date: nextDue(25), recurrence: "monthly", account_id: acc("HDFC Regalia Credit Card") },
    { household_id: householdId, name: "Home Loan EMI", amount: 28500, due_date: nextDue(7), recurrence: "monthly", account_id: acc("HDFC Savings") },
    { household_id: householdId, name: "Rent", amount: 32000, due_date: nextDue(5), recurrence: "monthly", account_id: acc("HDFC Savings") },
    { household_id: householdId, name: "Internet — ACT", amount: 1199, due_date: nextDue(10), recurrence: "monthly", account_id: acc("HDFC Savings") },
    { household_id: householdId, name: "Mobile — Jio", amount: 799, due_date: nextDue(12), recurrence: "monthly", account_id: acc("HDFC Savings") },
    { household_id: householdId, name: "Term Insurance premium", amount: 14500, due_date: nextDue(20), recurrence: "yearly", account_id: acc("HDFC Savings") },
  ]);

  // 8. Goals
  await supabaseAdmin.from("goals").insert([
    { household_id: householdId, name: "Emergency Fund (6 months)", target_amount: 600000, target_date: new Date(today.getFullYear() + 1, today.getMonth(), 1).toISOString().slice(0, 10), expected_return_pct: 6.5 },
    { household_id: householdId, name: "Goa Vacation", target_amount: 120000, target_date: new Date(today.getFullYear(), today.getMonth() + 6, 1).toISOString().slice(0, 10), expected_return_pct: 4 },
    { household_id: householdId, name: "Retirement (25 yrs)", target_amount: 30000000, target_date: new Date(today.getFullYear() + 25, 0, 1).toISOString().slice(0, 10), expected_return_pct: 11 },
    { household_id: householdId, name: "Down payment — 2nd home", target_amount: 2500000, target_date: new Date(today.getFullYear() + 4, 0, 1).toISOString().slice(0, 10), expected_return_pct: 9 },
  ]);

  // 9. Budget
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const { data: budget } = await supabaseAdmin
    .from("budgets")
    .insert({ household_id: householdId, name: "Monthly Budget", period: "monthly", start_date: monthStart })
    .select("id")
    .single();
  if (budget) {
    const budgetLines = [
      ["Groceries", 12000], ["Eating Out", 6000], ["Fuel", 3000], ["Auto/Cab", 2000],
      ["Electricity", 3000], ["Mobile", 1000], ["Internet", 1500], ["Online Shopping", 5000],
      ["Entertainment", 2000], ["Medicines", 2000], ["Rent", 32000],
    ] as const;
    await supabaseAdmin.from("budget_categories").insert(
      budgetLines
        .filter(([name]) => cat(name))
        .map(([name, amt]) => ({ budget_id: budget.id, category_id: cat(name)!, amount: amt })),
    );
  }

  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, seeded: true };
});
