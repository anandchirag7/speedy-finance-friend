// Server-only helper to send WhatsApp messages via Twilio (through the Lovable connector gateway).
// Returns { ok, sid?, error? }. Silently returns { ok: false, error: "not_configured" }
// when Twilio credentials are missing so the reminder job can no-op gracefully.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

export interface SendWhatsAppInput {
  to: string;           // E.164 with or without leading +
  body: string;
}

function normalizeTo(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, "");
  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/^0+/, "")}`;
  return `whatsapp:${withPlus}`;
}

function normalizeFrom(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("whatsapp:")) return trimmed;
  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/^0+/, "")}`;
  return `whatsapp:${withPlus}`;
}

export async function sendWhatsApp(input: SendWhatsAppInput): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!lovableKey || !twilioKey || !from) {
    return { ok: false, error: "not_configured" };
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: normalizeTo(input.to),
        From: normalizeFrom(from),
        Body: input.body,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `provider_${response.status}: ${text.slice(0, 300)}` };
    }

    const data: any = await response.json().catch(() => ({}));
    return { ok: true, sid: data?.sid };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "unknown_error" };
  }
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.LOVABLE_API_KEY && process.env.TWILIO_API_KEY && process.env.TWILIO_WHATSAPP_FROM);
}
