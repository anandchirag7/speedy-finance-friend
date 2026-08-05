import { memo } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfidenceMeter, MatchSourceBadge } from "../badges";
import { money, fmtDate, type Category, type ReviewRow } from "./types";

/** Full transaction detail in a side drawer, keeping rows single-line. */
export const TransactionDetailDrawer = memo(function TransactionDetailDrawer({
  row,
  categories,
  onClose,
}: {
  row: ReviewRow | null;
  categories: Category[];
  onClose: () => void;
}) {
  const category = row?.category_id
    ? categories.find((c) => c.id === row.category_id)?.name ?? "—"
    : "Uncategorized";

  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full gap-3 sm:max-w-md">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">{row?.payee || "Transaction"}</SheetTitle>
          <SheetDescription className="text-xs">
            {row ? `${fmtDate(row.date)} · ${money(row.amount)} · ${row.type}` : ""}
          </SheetDescription>
        </SheetHeader>
        {row && (
          <div className="grid gap-3 px-4 pb-4 text-xs">
            <Field label="Raw description">
              <span className="break-words font-mono">{row.description}</span>
            </Field>
            <Field label="Normalized pattern">
              <span className="break-words font-mono">{row.pattern}</span>
            </Field>
            <Field label="Match source">
              <MatchSourceBadge source={row.source} />
            </Field>
            <Field label="Match confidence">
              <ConfidenceMeter value={row.confidence} />
            </Field>
            <Field label="Category">
              <span>{category}</span>
            </Field>
            <Field label="Status">
              <span>
                {row.include ? "Will be imported" : "Excluded"}
                {row.duplicate ? " · possible duplicate" : ""}
              </span>
            </Field>
            {row.dup && (
              <Field label="Why it's flagged as a duplicate">
                <div className="space-y-1">
                  <p>
                    {row.dup.reason} ({Math.round(row.dup.confidence * 100)}% confidence,{" "}
                    {row.dup.scope === "account" ? "already on this account" : "repeated in this file"})
                  </p>
                  <p className="text-muted-foreground">Match keys: {row.dup.matchKeys.join(", ")}</p>
                  {row.dup.existing && (
                    <p className="text-muted-foreground">
                      Existing: {row.dup.existing.date} · {money(Number(row.dup.existing.amount))} ·{" "}
                      {row.dup.existing.merchant || row.dup.existing.note || "—"}
                    </p>
                  )}
                </div>
              </Field>
            )}

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
