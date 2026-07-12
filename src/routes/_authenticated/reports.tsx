import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Paisa" }] }),
  component: () => (
    <ComingSoon
      title="Reports"
      description="Income vs expense trend, cash flow, category drill-down, net worth over time, CSV/PDF export."
      phase="Phase 4"
    />
  ),
});
