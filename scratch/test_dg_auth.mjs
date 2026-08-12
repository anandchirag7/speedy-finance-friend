import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dgneuqfzpljsujskqhaz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnbmV1cWZ6cGxqc3Vqc2txaGF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NjU5NDEsImV4cCI6MjA5OTQ0MTk0MX0.E3BioQSm11GHl4oZEmB8S6m01uqV5MgsiXTnNiPpDkA";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function main() {
  console.log("Testing signInWithPassword on dgneuqfzpljsujskqhaz...");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: "demo@paisa.app",
    password: "DemoPaisa!2026",
  });
  console.log("SignIn error:", error?.message);
  console.log("User ID:", data.user?.id);
  console.log("Session active:", !!data.session);
}

main().catch(console.error);
