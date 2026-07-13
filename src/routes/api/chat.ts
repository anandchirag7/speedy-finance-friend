import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

function makeSupabase(token: string) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const isNew = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  return createClient(url, key, {
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (isNew && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice(7);
        const supabase = makeSupabase(token);
        const { data: userRes } = await supabase.auth.getUser(token);
        const user = userRes?.user;
        if (!user) return new Response("Unauthorized", { status: 401 });

        const { data: profile } = await supabase
          .from("profiles")
          .select("default_household_id, display_name")
          .eq("id", user.id)
          .maybeSingle();
        const householdId = profile?.default_household_id as string | undefined;
        if (!householdId) return new Response("No household", { status: 400 });

        const body = (await request.json()) as {
          messages?: UIMessage[];
          threadId?: string;
        };
        if (!Array.isArray(body.messages)) {
          return new Response("Missing messages", { status: 400 });
        }
        const threadId = body.threadId;
        if (!threadId) return new Response("Missing threadId", { status: 400 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);

        // Pre-fetch quick context summary for the system prompt.
        const [{ data: accounts }, { data: catsAgg }] = await Promise.all([
          supabase
            .from("accounts")
            .select("name, category, currency, current_balance, is_liability, excluded_from_net_worth, is_active")
            .eq("household_id", householdId),
          supabase
            .from("categories")
            .select("name, kind")
            .eq("household_id", householdId)
            .limit(200),
        ]);

        const inr = (accounts ?? []).filter(
          (a: any) => a.is_active && !a.excluded_from_net_worth && a.currency === "INR",
        );
        let assets = 0, liab = 0;
        for (const a of inr) {
          const b = Number(a.current_balance ?? 0);
          if (a.is_liability) liab += Math.abs(b);
          else assets += b;
        }
        const nw = assets - liab;
        const monthStart = new Date();
        monthStart.setDate(1);
        const startStr = monthStart.toISOString().slice(0, 10);
        const { data: monthTxns } = await supabase
          .from("transactions")
          .select("type, amount")
          .eq("household_id", householdId)
          .gte("txn_date", startStr);
        let income = 0, expense = 0;
        for (const t of monthTxns ?? []) {
          const amt = Number(t.amount);
          if (t.type === "income") income += amt;
          else if (t.type === "expense") expense += amt;
        }

        const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
        const systemPrompt = `You are Paisa, a helpful personal finance assistant for an Indian user. Answer in a friendly, concise tone. Format numbers in Indian rupees with Indian lakh/crore notation when large. Use markdown for lists and small tables when useful.

Current snapshot for ${profile?.display_name ?? "the user"} (household ${householdId}):
- Net worth: ${fmt(nw)} (assets ${fmt(assets)}, liabilities ${fmt(liab)})
- This month income: ${fmt(income)}, expense: ${fmt(expense)}, savings: ${fmt(income - expense)}
- Accounts: ${(accounts ?? []).length} total
- Available expense categories include: ${(catsAgg ?? []).filter((c: any) => c.kind === "expense").map((c: any) => c.name).slice(0, 25).join(", ")}

You have read-only tools to fetch the user's actual data when the question needs specifics (accounts, transactions, budgets, bills, goals). Prefer calling a tool when the user asks for numbers or lists. Do not fabricate data — if a tool returns nothing, say so. You cannot create or modify data; if asked, tell the user to use the relevant screen in the app.`;

        const tools = {
          list_accounts: tool({
            description: "List all of the user's financial accounts with balances.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("accounts")
                .select("name, institution, category, currency, current_balance, is_liability, is_active")
                .eq("household_id", householdId);
              return data ?? [];
            },
          }),
          list_transactions: tool({
            description: "List recent transactions. Optionally filter by date range or type.",
            inputSchema: z.object({
              limit: z.number().min(1).max(100).default(25),
              since_date: z.string().optional().describe("YYYY-MM-DD"),
              type: z.enum(["income", "expense", "transfer"]).optional(),
            }),
            execute: async ({ limit, since_date, type }) => {
              let q = supabase
                .from("transactions")
                .select("txn_date, type, amount, note, category:categories(name), account:accounts!transactions_account_id_fkey(name)")
                .eq("household_id", householdId)
                .order("txn_date", { ascending: false })
                .limit(limit);
              if (since_date) q = q.gte("txn_date", since_date);
              if (type) q = q.eq("type", type);
              const { data } = await q;
              return data ?? [];
            },
          }),
          spending_by_category: tool({
            description: "Aggregate this month's (or a given period's) expenses grouped by category.",
            inputSchema: z.object({
              since_date: z.string().optional().describe("YYYY-MM-DD, defaults to start of current month"),
            }),
            execute: async ({ since_date }) => {
              const from = since_date ?? startStr;
              const { data } = await supabase
                .from("transactions")
                .select("amount, category:categories(name)")
                .eq("household_id", householdId)
                .eq("type", "expense")
                .gte("txn_date", from);
              const agg: Record<string, number> = {};
              for (const t of data ?? []) {
                const name = (t as any).category?.name ?? "Uncategorized";
                agg[name] = (agg[name] ?? 0) + Number(t.amount);
              }
              return Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([category, total]) => ({ category, total }));
            },
          }),
          list_budgets: tool({
            description: "List active budgets with limits and linked categories.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("budgets")
                .select("*, budget_categories(category_id, categories(name))")
                .eq("household_id", householdId);
              return data ?? [];
            },
          }),
          list_bills: tool({
            description: "List upcoming or recurring bills.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("bills")
                .select("*")
                .eq("household_id", householdId);
              return data ?? [];
            },
          }),
          list_goals: tool({
            description: "List the user's savings goals with progress.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("goals")
                .select("*")
                .eq("household_id", householdId);
              return data ?? [];
            },
          }),
        };

        const result = streamText({
          model: gateway("openai/gpt-5.5"),
          system: systemPrompt,
          messages: await convertToModelMessages(body.messages),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          onFinish: async ({ messages: finalMessages }) => {
            try {
              // Persist any new messages (user + assistant) since last save.
              const { data: existing } = await supabase
                .from("chat_messages")
                .select("message_id")
                .eq("household_id", householdId)
                .eq("thread_id", threadId);
              const existingIds = new Set((existing ?? []).map((r: any) => r.message_id).filter(Boolean));
              const rows = finalMessages
                .filter((m) => !existingIds.has(m.id))
                .map((m) => ({
                  thread_id: threadId,
                  household_id: householdId,
                  role: m.role,
                  parts: m.parts as any,
                  message_id: m.id,
                }));
              if (rows.length) {
                await supabase.from("chat_messages").insert(rows);
              }
              await supabase
                .from("chat_threads")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", threadId);

              // Auto-title new threads based on first user message.
              const { data: thread } = await supabase
                .from("chat_threads")
                .select("title")
                .eq("id", threadId)
                .maybeSingle();
              if (thread?.title === "New chat") {
                const firstUser = finalMessages.find((m) => m.role === "user");
                if (firstUser) {
                  const text = firstUser.parts
                    .map((p: any) => (p.type === "text" ? p.text : ""))
                    .join(" ")
                    .trim()
                    .slice(0, 60);
                  if (text) {
                    await supabase
                      .from("chat_threads")
                      .update({ title: text })
                      .eq("id", threadId);
                  }
                }
              }
            } catch (err) {
              console.error("[chat] persist failed", err);
            }
          },
        });
      },
    },
  },
});
