import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function householdOf(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("profiles")
    .select("default_household_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.default_household_id) throw new Error("No household");
  return data.default_household_id as string;
}

/** Archive on/off + retention window for original statement files. */
export const getStatementArchiveSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await householdOf(context);
    const { loadArchiveSettings, pruneExpiredArchives } = await import("./statement-archive.server");
    // Opportunistic retention enforcement for this household.
    void pruneExpiredArchives(context.supabase, householdId).catch(() => undefined);
    const s = await loadArchiveSettings(context.supabase, householdId);
    return { householdId, ...s };
  });

export const saveStatementArchiveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        archive_enabled: z.boolean(),
        retention_days: z.number().int().min(1).max(3650),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const householdId = await householdOf(context);
    const { error } = await context.supabase
      .from("statement_archive_settings")
      .upsert(
        { household_id: householdId, ...data, updated_at: new Date().toISOString() },
        { onConflict: "household_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Import history, including whether the original file is still archived. */
export const listStatementUploads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await householdOf(context);
    const { data, error } = await context.supabase
      .from("statement_uploads")
      .select(
        "id, filename, status, error, total_transactions, inserted_count, imported_at, created_at, storage_path, size_bytes, mime_type, archive_expires_at",
      )
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      has_file: !!r.storage_path,
      storage_path: undefined,
    }));
  });

/** Short-lived signed URL for the originally uploaded file. */
export const getStatementDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ uploadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("statement_uploads")
      .select("storage_path, filename")
      .eq("id", data.uploadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.storage_path) throw new Error("The original file is no longer archived for this import.");
    const { signArchivedUrl } = await import("./statement-archive.server");
    const url = await signArchivedUrl(context.supabase, row.storage_path);
    if (!url) throw new Error("Could not create a download link.");
    return { url, filename: row.filename as string };
  });

/** Re-run parsing on an archived statement — no re-upload needed. */
export const reparseArchivedStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ uploadId: z.string().uuid(), accountId: z.string().uuid(), bank: z.string().min(1) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { getRequestUrl } = await import("@tanstack/react-start/server");
    const { reparseStatement } = await import("./statement-pipeline.server");
    return reparseStatement({
      supabase: context.supabase,
      userId: context.userId,
      uploadId: data.uploadId,
      accountId: data.accountId,
      bank: data.bank,
      origin: getRequestUrl().origin,
    });
  });

/** Marks an upload as cancelled so the activity banner and history reflect it. */
export const cancelStatementUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ uploadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await context.supabase
      .from("statement_uploads")
      .update({ status: "failed", error: "Cancelled by user before import" })
      .eq("id", data.uploadId)
      .is("imported_at", null);
    return { ok: true };
  });

/** Manual retention sweep for the current household. */
export const pruneStatementArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const householdId = await householdOf(context);
    const { pruneExpiredArchives } = await import("./statement-archive.server");
    return pruneExpiredArchives(context.supabase, householdId);
  });
