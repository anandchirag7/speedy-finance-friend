import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/goals")({
  head: () => ({ meta: [{ title: "Goals — Paisa" }] }),
  component: () => (
    <ComingSoon
      title="Goals"
      description="Emergency fund, down payment, child's education — link accounts, see progress, get required SIP."
      phase="Phase 3"
    />
  ),
});
