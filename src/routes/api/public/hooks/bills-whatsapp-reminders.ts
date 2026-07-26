import { createFileRoute } from "@tanstack/react-router";

// Daily cron endpoint. Scans active bills, checks each configured
// reminder_days offset against today's date, and sends a WhatsApp
// reminder exactly once per (bill, due_date, days_before).
//
// Auth: uses Supabase anon key in the `apikey` header (pg_cron passes it).
// Dedupe: the bill_reminder_sends UNIQUE constraint on
//   (bill_id, due_date, days_before, channel) prevents duplicates.

export const Route = createFileRoute("/api/public/hooks/bills-whatsapp-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendWhatsApp, isWhatsAppConfigured } = await import("@/lib/whatsapp.server");

        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const horizon = new Date(today);
        horizon.setDate(horizon.getDate() + 30); // look 30 days ahead
        const horizonStr = horizon.toISOString().slice(0, 10);

        const { data: bills, error } = await (supabaseAdmin as any)
          .from("bills")
          .select("id, household_id, name, amount, currency, due_date, reminder_days, whatsapp_number, whatsapp_enabled, is_active, status, created_by")
          .eq("is_active", true)
          .eq("whatsapp_enabled", true)
          .in("status", ["upcoming", "overdue", "snoozed"])
          .lte("due_date", horizonStr);

        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }

        const configured = isWhatsAppConfigured();

        // Preload creators' profile numbers in one round-trip.
        const creatorIds = Array.from(new Set((bills ?? []).map((b: any) => b.created_by).filter(Boolean)));
        let profileMap = new Map<string, { number: string | null; enabled: boolean }>();
        if (creatorIds.length) {
          const { data: profiles } = await (supabaseAdmin as any)
            .from("profiles")
            .select("id, whatsapp_number, whatsapp_reminders_enabled")
            .in("id", creatorIds);
          for (const p of profiles ?? []) {
            profileMap.set(p.id, { number: p.whatsapp_number, enabled: !!p.whatsapp_reminders_enabled });
          }
        }

        const results: any[] = [];

        for (const b of bills ?? []) {
          const due = new Date(b.due_date + "T00:00:00Z");
          const diff = Math.round((due.getTime() - Date.parse(todayStr + "T00:00:00Z")) / 86400000);
          const reminders: number[] = Array.isArray(b.reminder_days) ? b.reminder_days : [];
          if (!reminders.includes(diff)) continue;

          const profile = b.created_by ? profileMap.get(b.created_by) : undefined;
          const recipient = b.whatsapp_number || profile?.number || null;
          if (!recipient) continue;

          // Respect the user's master toggle only when the bill isn't
          // overriding with its own number.
          if (!b.whatsapp_number && profile && !profile.enabled) continue;

          // Reserve the send atomically via unique constraint.
          const { data: reserved, error: insErr } = await (supabaseAdmin as any)
            .from("bill_reminder_sends")
            .insert({
              household_id: b.household_id,
              bill_id: b.id,
              due_date: b.due_date,
              days_before: diff,
              channel: "whatsapp",
              recipient,
              status: "pending",
            })
            .select("id")
            .maybeSingle();

          if (insErr) {
            // 23505 unique_violation -> already sent, skip silently.
            if (!String(insErr.code ?? "").includes("23505")) {
              results.push({ bill_id: b.id, error: insErr.message });
            }
            continue;
          }

          if (!configured) {
            await (supabaseAdmin as any).from("bill_reminder_sends")
              .update({ status: "skipped", error: "twilio_not_configured" })
              .eq("id", reserved!.id);
            results.push({ bill_id: b.id, skipped: "not_configured" });
            continue;
          }

          const label = diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
          const amount = b.amount != null ? ` (${b.currency ?? ""} ${Number(b.amount).toFixed(2)})` : "";
          const message = `🔔 Bill reminder: "${b.name}"${amount} is due ${label} (${b.due_date}).`;

          const send = await sendWhatsApp({ to: recipient, body: message });

          await (supabaseAdmin as any).from("bill_reminder_sends")
            .update({
              status: send.ok ? "sent" : "failed",
              provider_message_id: send.sid ?? null,
              error: send.error ?? null,
            })
            .eq("id", reserved!.id);

          results.push({ bill_id: b.id, ok: send.ok, error: send.error });
        }

        return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
