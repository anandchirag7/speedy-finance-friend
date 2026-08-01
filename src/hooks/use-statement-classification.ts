import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ClassificationProgress = {
  status: "parsing" | "deduplicating" | "classifying" | "complete" | "failed" | null;
  resolved: Record<string, { payee: string; category: string | null; source: string }>;
  processed: number;
  total: number;
  error: string | null;
};

/**
 * Streams background AI-classification progress for a statement upload.
 * Falls back to polling if the realtime channel never connects.
 */
export function useStatementClassification(uploadId: string | null): ClassificationProgress {
  const [state, setState] = useState<ClassificationProgress>({
    status: null,
    resolved: {},
    processed: 0,
    total: 0,
    error: null,
  });

  useEffect(() => {
    if (!uploadId) {
      setState({ status: null, resolved: {}, processed: 0, total: 0, error: null });
      return;
    }
    let cancelled = false;

    const apply = (row: any) => {
      if (cancelled || !row) return;
      const result = (row.result ?? {}) as any;
      setState({
        status: row.status ?? null,
        resolved: result.resolved ?? {},
        processed: row.processed_transactions ?? 0,
        total: row.unique_patterns ?? 0,
        error: row.error ?? null,
      });
    };

    const load = async () => {
      const { data } = await supabase
        .from("statement_uploads")
        .select("status, result, processed_transactions, unique_patterns, error")
        .eq("id", uploadId)
        .maybeSingle();
      apply(data);
      return data?.status;
    };

    void load();

    const channel = supabase
      .channel(`statement-upload-${uploadId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "statement_uploads",
          filter: `id=eq.${uploadId}`,
        },
        (payload) => apply(payload.new),
      )
      .subscribe();

    // Safety net: poll until the job finishes even if realtime is unavailable.
    const timer = setInterval(async () => {
      const status = await load();
      if (status === "complete" || status === "failed") clearInterval(timer);
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [uploadId]);

  return state;
}
