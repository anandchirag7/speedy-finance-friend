/**
 * Background worker for statement payee classification.
 *
 * Invoked as a detached request by the upload pipeline so AI batching keeps
 * running after the user's upload request has already returned (and even if
 * the tab is closed). Authenticated by the single-use job token stored on the
 * `statement_uploads` row — no session, no service key from the caller.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  uploadId: z.string().uuid(),
  jobToken: z.string().min(10),
  pending: z
    .array(
      z.object({
        pattern: z.string().min(1),
        samples: z.array(z.string()).default([]),
        type: z.string().default("expense"),
        count: z.number().optional(),
      }),
    )
    .default([]),
});

export const Route = createFileRoute("/api/public/hooks/statement-classify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: z.infer<typeof bodySchema>;
        try {
          payload = bodySchema.parse(await request.json());
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: row } = await supabaseAdmin
          .from("statement_uploads")
          .select("id, status, result, unique_patterns")
          .eq("id", payload.uploadId)
          .maybeSingle();

        const result = (row?.result ?? {}) as Record<string, any>;
        if (!row || result.job_token !== payload.jobToken) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (row.status === "complete" || row.status === "failed") {
          return new Response("ok");
        }

        const apiKey = process.env['LOVABLE_API_KEY'];
        if (!apiKey) {
          await supabaseAdmin
            .from("statement_uploads")
            .update({ status: "failed", error: "Missing AI credentials" })
            .eq("id", payload.uploadId);
          return new Response("Missing AI credentials", { status: 500 });
        }

        try {
          const { classifyPendingPatterns } = await import("@/lib/statement-classify.server");
          const classified = await classifyPendingPatterns({
            admin: supabaseAdmin,
            uploadId: payload.uploadId,
            pending: payload.pending,
            apiKey,
          });

          const resolved = { ...(result.resolved ?? {}), ...classified };
          await supabaseAdmin
            .from("statement_uploads")
            .update({
              status: "complete",
              processed_transactions: Object.keys(resolved).length,
              result: { ...result, resolved, pending: [] },
            })
            .eq("id", payload.uploadId);

          return new Response("ok");
        } catch (e: any) {
          await supabaseAdmin
            .from("statement_uploads")
            .update({ status: "failed", error: String(e?.message ?? e).slice(0, 500) })
            .eq("id", payload.uploadId);
          return new Response("Classification failed", { status: 500 });
        }
      },
    },
  },
});
