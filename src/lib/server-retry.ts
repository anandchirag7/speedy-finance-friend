import { supabase } from "@/integrations/supabase/client";

const AUTH_HINTS = [
  "jwt issued at future",
  "issued at future",
  "invalid token",
  "unauthorized",
  "jwt expired",
];

export function isTransientAuthError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  return AUTH_HINTS.some((hint) => message.includes(hint));
}

/**
 * Runs a server function and, when the failure looks like clock-skew / stale-token
 * ("JWT issued at future", "Invalid token"), refreshes the session once and retries.
 */
export async function withAuthRetry<T>(run: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientAuthError(error) || i === attempts - 1) throw error;
      try {
        await supabase.auth.refreshSession();
      } catch {
        /* ignore — retry with the existing token */
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw lastError;
}
