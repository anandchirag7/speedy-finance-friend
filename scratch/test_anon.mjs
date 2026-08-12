import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  console.log("Testing signInAnonymously...");
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("signInAnonymously error:", error.message);
  } else {
    console.log("SUCCESS! Anonymous user created!", data.user?.id, "Session active:", !!data.session);
  }
}

main().catch(console.error);
