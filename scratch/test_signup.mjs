import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  const testEmail = `demo_${Date.now()}@paisa.app`;
  console.log("Testing signup for:", testEmail);
  const { data, error } = await supabase.auth.signUp({
    email: testEmail,
    password: "DemoPaisa!2026",
  });

  if (error) {
    console.error("SignUp error:", error);
  } else {
    console.log("SignUp data user:", data.user?.id, "session:", !!data.session);
    if (data.session) {
      console.log("SUCCESS! Session created immediately without email confirmation!");
    } else {
      console.log("Email confirmation is REQUIRED by Supabase settings.");
    }
  }
}

main().catch(console.error);
