import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const configSchema = z.object({
  query: z.string().default(""),
  category: z.string().default("All"),
  preset: z.string().default("ytd"),
  customFrom: z.string().default(""),
  customTo: z.string().default(""),
  compareEnabled: z.boolean().optional(),
  compareFrom: z.string().optional(),
  compareTo: z.string().optional(),
  compareLayout: z.enum(["overlay", "side-by-side"]).optional(),
});

export type ReportPresetConfig = z.infer<typeof configSchema>;

export const listReportPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("report_presets")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Array<{
      id: string;
      name: string;
      config: ReportPresetConfig;
      created_at: string;
    }>;
  });

export const saveReportPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        config: configSchema,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("report_presets")
        .update({ name: data.name, config: data.config })
        .eq("id", data.id)
        .eq("user_id", context.userId)
        .select()
        .maybeSingle();
      if (error) throw error;
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("report_presets")
      .insert({ user_id: context.userId, name: data.name, config: data.config })
      .select()
      .maybeSingle();
    if (error) throw error;
    return row;
  });

export const deleteReportPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("report_presets")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
