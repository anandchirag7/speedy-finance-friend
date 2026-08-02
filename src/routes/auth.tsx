import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { ensureDemoAccount } from "@/lib/demo.functions";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//")
      ? { next: s.next }
      : {},
  head: () => ({
    meta: [
      { title: "Sign in — Paisa" },
      { name: "description", content: "Sign in to your Paisa personal finance dashboard." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const { next } = Route.useSearch();
  const goNext = () => {
    if (next) window.location.href = next;
    else router.navigate({ to: "/", replace: true });
  };
  const returnUrl = () => (next ? `${window.location.origin}${next}` : window.location.origin);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goNext();
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: returnUrl(),
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your inbox if confirmation is required.");
        goNext();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        goNext();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: returnUrl(),
    });
    if (result.error) {
      toast.error(result.error.message ?? "Google sign-in failed");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    goNext();
  };

  const tryDemo = async () => {
    setBusy(true);
    try {
      const creds = await ensureDemoAccount();
      const { error } = await supabase.auth.signInWithPassword({
        email: creds.email,
        password: creds.password,
      });
      if (error) throw error;
      toast.success(creds.seeded ? "Demo account ready with sample data" : "Signed in to demo account");
      goNext();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load demo");
      setBusy(false);
    }
  };



  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-display text-2xl font-semibold">
            ₹
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Paisa</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your money, in one place.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>Sign in or create an account to get started.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-4">
                <form onSubmit={submit} className="space-y-3">
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button className="w-full" type="submit" disabled={busy}>Sign in</Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-4">
                <form onSubmit={submit} className="space-y-3">
                  <div>
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="email2">Email</Label>
                    <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="password2">Password</Label>
                    <Input id="password2" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button className="w-full" type="submit" disabled={busy}>Create account</Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
              Continue with Google
            </Button>

            <Button variant="secondary" className="mt-2 w-full" onClick={tryDemo} disabled={busy}>
              <Sparkles className="mr-2 h-4 w-4" />
              Try demo account
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Explore Paisa with pre-loaded Indian accounts, transactions & bills
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
