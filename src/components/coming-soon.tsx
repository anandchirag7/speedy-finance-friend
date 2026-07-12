import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function ComingSoon({ title, description, phase }: { title: string; description: string; phase: string }) {
  return (
    <div className="mx-auto max-w-2xl p-6 md:p-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
            <Sparkles className="h-6 w-6" />
          </div>
          <Badge variant="secondary">{phase}</Badge>
          <h2 className="font-display text-2xl font-semibold">{title}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
