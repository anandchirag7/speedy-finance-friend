import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WidgetLayoutItem = {
  i: string; // instance id
  type: string; // widget type key
  x: number;
  y: number;
  w: number;
  h: number;
  settings?: Record<string, any>;
};

export type DashboardRow = {
  id: string;
  name: string;
  is_default: boolean;
  template_key: string | null;
  layout: WidgetLayoutItem[];
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
};

async function ensureHousehold(context: any): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", context.userId)
    .maybeSingle();
  const householdId = prof?.default_household_id;
  if (!householdId) throw new Error("No household");
  return householdId;
}

export const listDashboards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("dashboards")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as DashboardRow[];
  });

export const createDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; template_key?: string; layout?: WidgetLayoutItem[] }) => d)
  .handler(async ({ data, context }) => {
    const householdId = await ensureHousehold(context);
    const { data: existing } = await context.supabase.from("dashboards").select("id").limit(1);
    const isFirst = !existing || existing.length === 0;
    const { data: row, error } = await context.supabase
      .from("dashboards")
      .insert({
        household_id: householdId,
        user_id: context.userId,
        name: data.name,
        template_key: data.template_key ?? null,
        layout: data.layout ?? [],
        is_default: isFirst,
      })
      .select("*")
      .single();
    if (error) throw error;
    return row as DashboardRow;
  });

export const updateDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    name?: string;
    layout?: WidgetLayoutItem[];
    settings?: Record<string, any>;
  }) => d)
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.layout !== undefined) patch.layout = data.layout;
    if (data.settings !== undefined) patch.settings = data.settings;
    const { data: row, error } = await context.supabase
      .from("dashboards")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    return row as DashboardRow;
  });

export const deleteDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("dashboards").delete().eq("id", data.id);
    if (error) throw error;
    // If we removed the default, promote the earliest remaining dashboard.
    const { data: any_dash } = await context.supabase
      .from("dashboards")
      .select("id,is_default")
      .order("created_at", { ascending: true });
    if (any_dash && any_dash.length > 0 && !any_dash.some((d) => d.is_default)) {
      await context.supabase
        .from("dashboards")
        .update({ is_default: true })
        .eq("id", any_dash[0].id);
    }
    return { ok: true };
  });

export const setDefaultDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("dashboards")
      .update({ is_default: false })
      .eq("user_id", context.userId);
    const { error } = await context.supabase
      .from("dashboards")
      .update({ is_default: true })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const duplicateDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: src, error: e1 } = await context.supabase
      .from("dashboards")
      .select("*")
      .eq("id", data.id)
      .single();
    if (e1) throw e1;
    const householdId = await ensureHousehold(context);
    const { data: row, error } = await context.supabase
      .from("dashboards")
      .insert({
        household_id: householdId,
        user_id: context.userId,
        name: `${src.name} (copy)`,
        template_key: src.template_key,
        layout: src.layout,
        settings: src.settings,
        is_default: false,
      })
      .select("*")
      .single();
    if (error) throw error;
    return row as DashboardRow;
  });
