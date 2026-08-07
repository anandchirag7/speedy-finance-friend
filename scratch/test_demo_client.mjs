import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const DEMO_EMAIL = "demo@paisa.app";
const DEMO_PASSWORD = "DemoPaisa!2026";

async function main() {
  console.log("1. Attempting sign in...");
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });

  if (signInErr) {
    console.log("Sign in failed:", signInErr.message);
    console.log("2. Attempting sign up...");
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      options: {
        data: { display_name: "Demo User" }
      }
    });
    if (signUpErr) {
      console.log("Sign up failed:", signUpErr.message);
    } else {
      console.log("Sign up successful! User ID:", signUpData.user?.id);
    }
  } else {
    console.log("Sign in successful! Session user:", signInData.user?.id);
  }
}

main().catch(console.error);
