import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "sb_secret_0iLwInkHyN0RARmZd1X8tQ_-vc5Rw0C";

// Standard Supabase Admin Client
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log("Testing standard listUsers...");
  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) console.error("listUsers error:", listErr);
  else console.log("Found users count:", list?.users?.length, list?.users?.map(u => u.email));

  const DEMO_EMAIL = "demo@paisa.app";
  const DEMO_PASSWORD = "DemoPaisa!2026";
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
  console.log("Existing demo user ID:", existing?.id);

  if (!existing) {
    console.log("Creating demo user...");
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Demo User" },
    });
    console.log("Create user result:", createErr ? createErr.message : created?.user?.id);
  }
}

main().catch(console.error);
