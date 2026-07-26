import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("profiles")
      .select("id, display_name, whatsapp_number, whatsapp_reminders_enabled, default_household_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    display_name: z.string().max(120).optional(),
    whatsapp_number: z.string().max(30).nullable().optional(),
    whatsapp_reminders_enabled: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await (context.supabase as any)
      .from("profiles")
      .update(data)
      .eq("id", context.userId)
      .select("id, display_name, whatsapp_number, whatsapp_reminders_enabled")
      .maybeSingle();
    if (error) throw error;
    return row;
  });
