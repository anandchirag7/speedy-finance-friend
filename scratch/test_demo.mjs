import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://slbxzzbpsiabyrelepax.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "sb_secret_0iLwInkHyN0RARmZd1X8tQ_-vc5Rw0C";

function isNewSupabaseApiKey(value) {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(supabaseKey) {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    const requestUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
    if (!requestUrl.includes('/auth/v1') && isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: createSupabaseFetch(SUPABASE_SERVICE_ROLE_KEY) },
  auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log("Testing listUsers with preserved Auth header...");
  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) {
    console.error("listUsers error:", listErr);
  } else {
    console.log("Success! Users count:", list?.users?.length, "Demo user:", list?.users?.find(u => u.email === 'demo@paisa.app')?.id);
  }
}

main().catch(console.error);
