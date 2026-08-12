import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  console.log("Testing signInWithOtp...");
  const { data, error } = await supabase.auth.signInWithOtp({
    email: "demo@paisa.app",
    options: {
      shouldCreateUser: true
    }
  });
  if (error) {
    console.error("signInWithOtp error:", error.message);
  } else {
    console.log("SUCCESS! OTP sent / user created!");
  }
}

main().catch(console.error);
