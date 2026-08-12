import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  console.log("Testing Google OAuth authorize endpoint...");
  const { data: oauthData, error: oauthErr } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "http://localhost:8081/auth" }
  });
  console.log("Google OAuth result:", oauthErr ? oauthErr.message : "SUCCESS! URL: " + oauthData?.url);
}

main().catch(console.error);
