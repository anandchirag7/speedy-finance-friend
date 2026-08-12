async function testOAuth(projUrl, key, projName) {
  console.log(`Testing Google OAuth provider on ${projName} (${projUrl})...`);
  const res = await fetch(`${projUrl}/auth/v1/authorize?provider=google&redirect_to=http://localhost:8081/auth`, {
    headers: { apikey: key },
  });
  const text = await res.text();
  console.log(`[${projName}] Status: ${res.status}`);
  console.log(`[${projName}] Response: ${text.slice(0, 300)}`);
}

async function main() {
  await testOAuth(
    "https://slbxzzbpsiabyrelepax.supabase.co",
    "sb_publishable_96bCaYzUkH2x4Hrp5W4I_Q_py70SQKa",
    "slbxzzbpsiabyrelepax"
  );

  await testOAuth(
    "https://dgneuqfzpljsujskqhaz.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnbmV1cWZ6cGxqc3Vqc2txaGF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NjU5NDEsImV4cCI6MjA5OTQ0MTk0MX0.E3BioQSm11GHl4oZEmB8S6m01uqV5MgsiXTnNiPpDkA",
    "dgneuqfzpljsujskqhaz"
  );
}

main().catch(console.error);
