import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/investments")({
  head: () => ({ meta: [{ title: "Investments — Paisa" }] }),
  component: () => (
    <ComingSoon
      title="Investment performance"
      description="XIRR at portfolio and holding level, realized vs unrealized, manual NAV updates."
      phase="Phase 3"
    />
  ),
});
