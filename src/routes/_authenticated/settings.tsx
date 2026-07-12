import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/theme-provider";
import { getMyContext } from "@/lib/finance.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Paisa" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const fn = useServerFn(getMyContext);
  const { data } = useQuery({ queryKey: ["me"], queryFn: fn });
  const { theme, toggle } = useTheme();

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {(data as any)?.profile?.display_name ?? "you"}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Switch between light and dark.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <Label htmlFor="dark">Dark mode</Label>
          <Switch id="dark" checked={theme === "dark"} onCheckedChange={toggle} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>App-lock and biometric protection.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            App-lock PIN and biometric unlock arrive with the mobile-polish pass.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
