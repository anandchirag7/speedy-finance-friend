import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/budgets")({
  head: () => ({ meta: [{ title: "Budgets — Paisa" }] }),
  component: () => (
    <ComingSoon
      title="Budgets"
      description="Monthly caps per category, rollover, 50/30/20 template, and festival/event budgets driven by tags."
      phase="Phase 2"
    />
  ),
});
