import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchReportsData } from "./reports-fetch";

const inputSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .default({});

export const getReportsData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const from = data.from ?? defaultFrom.toISOString().slice(0, 10);
    const to = data.to ?? today.toISOString().slice(0, 10);
    return fetchReportsData(context.supabase, context.userId, from, to);
  });

export type ReportsData = Awaited<ReturnType<typeof getReportsData>>;
