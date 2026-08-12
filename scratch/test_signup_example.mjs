import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  console.log("Signing up demo@example.com...");
  const { data, error } = await supabase.auth.signUp({
    email: "demo@example.com",
    password: "DemoPaisa!2026",
  });
  console.log("SignUp error:", error?.message);
  console.log("User ID:", data.user?.id);
  console.log("Session:", !!data.session);
}

main().catch(console.error);
