/**
 * Private archive of original statement files.
 *
 * Layout: statements/{household_id}/{upload_id}/{filename}
 * The bucket is private; downloads always go through short-lived signed URLs.
 */

const BUCKET = "statements";

export type ArchiveSettings = { archive_enabled: boolean; retention_days: number };

export async function loadArchiveSettings(
  supabase: any,
  householdId: string,
): Promise<ArchiveSettings> {
  const { data } = await supabase
    .from("statement_archive_settings")
    .select("archive_enabled, retention_days")
    .eq("household_id", householdId)
    .maybeSingle();
  return {
    archive_enabled: !!data?.archive_enabled,
    retention_days: Number(data?.retention_days ?? 90),
  };
}

export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(-120) || "statement"
  );
}

/** Uploads the original file and stamps the upload row. Best effort — never throws. */
export async function archiveOriginal(opts: {
  supabase: any;
  householdId: string;
  uploadId: string;
  fileName: string;
  mimeType: string;
  base64: string;
  retentionDays: number;
}): Promise<string | null> {
  const { supabase, householdId, uploadId, fileName, mimeType, base64, retentionDays } = opts;
  try {
    const bytes = Buffer.from(base64, "base64");
    const path = `${householdId}/${uploadId}/${sanitizeFileName(fileName)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: mimeType || "application/octet-stream",
      upsert: true,
    });
    if (error) throw error;

    const expires =
      retentionDays > 0
        ? new Date(Date.now() + retentionDays * 86_400_000).toISOString()
        : null;

    await supabase
      .from("statement_uploads")
      .update({
        storage_path: path,
        mime_type: mimeType || null,
        size_bytes: bytes.byteLength,
        archive_expires_at: expires,
      })
      .eq("id", uploadId);

    return path;
  } catch {
    return null;
  }
}

export async function downloadArchived(
  supabase: any,
  storagePath: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType: (data as Blob).type || "application/octet-stream" };
}

export async function signArchivedUrl(
  supabase: any,
  storagePath: string,
  seconds = 120,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Deletes archived files whose retention window has passed. Safe to call often. */
export async function pruneExpiredArchives(
  supabase: any,
  householdId?: string,
): Promise<{ deleted: number }> {
  let q = supabase
    .from("statement_uploads")
    .select("id, storage_path")
    .not("storage_path", "is", null)
    .not("archive_expires_at", "is", null)
    .lt("archive_expires_at", new Date().toISOString())
    .limit(500);
  if (householdId) q = q.eq("household_id", householdId);

  const { data: rows } = await q;
  const targets = (rows ?? []) as Array<{ id: string; storage_path: string }>;
  if (!targets.length) return { deleted: 0 };

  await supabase.storage.from(BUCKET).remove(targets.map((r) => r.storage_path));
  await supabase
    .from("statement_uploads")
    .update({ storage_path: null, archive_expires_at: null, size_bytes: null })
    .in(
      "id",
      targets.map((r) => r.id),
    );

  return { deleted: targets.length };
}
