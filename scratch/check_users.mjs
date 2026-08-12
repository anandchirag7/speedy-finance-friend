import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  console.log("Testing auth sign in with common test users...");
  const emails = ["demo@paisa.app", "demo@example.com", "test@example.com", "admin@paisa.app", "user@paisa.app"];
  for (const email of emails) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: "DemoPaisa!2026",
    });
    console.log(`Email ${email}:`, error ? error.message : `SUCCESS! User ID ${data.user?.id}`);
  }
}

main().catch(console.error);
