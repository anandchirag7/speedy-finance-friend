const token = "sbp_da78b6a655a2af3cdc5c9067f024d094f386cc61";
const ref = "slbxzzbpsiabyrelepax";
const query = `
UPDATE auth.users 
SET email_confirmed_at = now(),
    encrypted_password = crypt('DemoPaisa!2026', gen_salt('bf'))
WHERE email = 'demo@paisa.app';
`;

async function main() {
  console.log("Confirming demo@paisa.app in Supabase database...");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  console.log("Status:", res.status, "Response:", text);
}

main().catch(console.error);
