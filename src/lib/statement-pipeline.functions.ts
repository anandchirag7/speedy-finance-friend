import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const startInput = z.object({
  accountId: z.string().uuid(),
  bank: z.string().min(1).max(100),
  fileName: z.string().min(1),
  mimeType: z.string(),
  base64: z.string().min(1),
});

/**
 * Fast path: parse -> normalize -> dedupe -> lookup, then hand any unknown
 * patterns to a detached background invocation for AI classification.
 * Returns in seconds even for statements with thousands of rows.
 */
export const startStatementUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => startInput.parse(d))
  .handler(async ({ context, data }) => {
    const { runStatementUpload } = await import("./statement-pipeline.server");
    return runStatementUpload({
      supabase: context.supabase,
      userId: context.userId,
      input: data,
      origin: getRequestUrl().origin,
    });
  });

const uploadIdInput = z.object({ uploadId: z.string().uuid() });

/** Poll fallback for clients without realtime. */
export const getStatementUploadStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => uploadIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("statement_uploads")
      .select("id, status, total_transactions, unique_patterns, processed_transactions, result, error")
      .eq("id", data.uploadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

const correctionInput = z.object({
  corrections: z
    .array(
      z.object({
        normalizedPattern: z.string().min(1),
        payeeName: z.string().min(1).max(120),
        category: z.string().max(80).nullable().optional(),
      }),
    )
    .min(1)
    .max(2000),
});

/**
 * User confirmation loop: personal overrides always win for this user, and the
 * confirmed name is promoted into the shared dictionary.
 */
export const saveMerchantCorrections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => correctionInput.parse(d))
  .handler(async ({ context, data }) => {
    const { saveCorrections } = await import("./statement-pipeline.server");
    return saveCorrections(context.supabase, context.userId, data.corrections);
  });
