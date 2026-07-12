import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/bills")({
  head: () => ({ meta: [{ title: "Bills — Paisa" }] }),
  component: () => (
    <ComingSoon
      title="Bills & Reminders"
      description="One calendar for credit-card dues, EMIs, SIPs, insurance premiums, PPF deadlines, and FD maturities."
      phase="Phase 2"
    />
  ),
});
