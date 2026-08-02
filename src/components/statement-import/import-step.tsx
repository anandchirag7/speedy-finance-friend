import { useCallback, useMemo, useRef, useState } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  FileText,
  FileCode2,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Landmark,
  CalendarRange,
  Coins,
  Rows3,
  Files,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  inspectStatementFile,
  humanSize,
  type StatementDetection,
} from "@/lib/statement-detect";
import { cn } from "@/lib/utils";

export const BANKS = [
  "HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank", "Kotak Mahindra",
  "IDFC First", "Yes Bank", "IndusInd", "Punjab National Bank", "Bank of Baroda",
  "American Express", "Citibank", "HSBC", "Standard Chartered", "Other",
];

const ACCEPT = ".csv,.txt,.xlsx,.xls,.pdf,.ofx,.qfx,.qif";

function FormatIcon({ format }: { format: StatementDetection["format"] }) {
  if (format === "pdf") return <FileText className="h-4 w-4 text-destructive" aria-hidden />;
  if (format === "xlsx" || format === "xls" || format === "csv")
    return <FileSpreadsheet className="h-4 w-4 text-success" aria-hidden />;
  return <FileCode2 className="h-4 w-4 text-info" aria-hidden />;
}

function DetailTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[10px] border bg-card px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="truncate text-xs font-semibold">{value}</div>
    </div>
  );
}

export function ImportStep({
  accounts,
  accountId,
  setAccountId,
  bank,
  setBank,
  file,
  onFile,
  detection,
  inspecting,
  seenFingerprints,
  parsing,
  onParse,
  progress,
}: {
  accounts: Array<{ id: string; name: string }>;
  accountId: string;
  setAccountId: (v: string) => void;
  bank: string;
  setBank: (v: string) => void;
  file: File | null;
  onFile: (f: File | null, detection: StatementDetection | null) => void;
  detection: StatementDetection | null;
  inspecting: boolean;
  seenFingerprints: string[];
  parsing: boolean;
  onParse: () => void;
  progress: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = useCallback(
    async (f: File | null) => {
      if (!f) return onFile(null, null);
      setBusy(true);
      try {
        const d = await inspectStatementFile(f, { selectedBank: bank, seenFingerprints });
        onFile(f, d);
        if (!bank && d.bank) setBank(d.bank);
      } finally {
        setBusy(false);
      }
    },
    [bank, onFile, seenFingerprints, setBank],
  );

  const errors = detection?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = detection?.issues.filter((i) => i.level === "warning") ?? [];
  const ready = !!accountId && !!bank && !!file && errors.length === 0;

  const period = useMemo(() => {
    if (!detection?.periodStart) return "—";
    const fmt = (s: string) =>
      new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
    return detection.periodEnd && detection.periodEnd !== detection.periodStart
      ? `${fmt(detection.periodStart)} → ${fmt(detection.periodEnd)}`
      : fmt(detection.periodStart);
  }, [detection]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Pick account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Bank</Label>
          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Pick bank" />
            </SelectTrigger>
            <SelectContent>
              {BANKS.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload statement file. CSV, XLS, XLSX, PDF, OFX or QIF."
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40",
        )}
      >
        <UploadCloud className={cn("h-6 w-6", dragging ? "text-primary" : "text-muted-foreground")} aria-hidden />
        <p className="text-sm font-medium">
          {file ? file.name : "Drop your statement here, or click to browse"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {file
            ? `${humanSize(file.size)} · ${detection?.format?.toUpperCase() ?? "—"}`
            : "CSV · XLS · XLSX · PDF · OFX · QIF"}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => void accept(e.target.files?.[0] ?? null)}
        />
      </div>

      {(busy || inspecting) && (
        <p className="text-xs text-muted-foreground" role="status">
          Inspecting file…
        </p>
      )}

      {/* Detection panel */}
      {detection && !busy && (
        <div className="rounded-xl border bg-muted/20 p-2.5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <FormatIcon format={detection.format} />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Statement information
            </span>
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium",
                detection.confidence >= 0.75
                  ? "border-success/30 bg-success/12 text-success"
                  : detection.confidence >= 0.45
                    ? "border-warning/40 bg-warning/15 text-warning-foreground"
                    : "border-border bg-muted text-muted-foreground",
              )}
            >
              <CheckCircle2 className="h-2.5 w-2.5" aria-hidden />
              {Math.round(detection.confidence * 100)}% detection confidence
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <DetailTile
              icon={<Landmark className="h-2.5 w-2.5" />}
              label="Bank"
              value={detection.bank ?? "Unknown"}
            />
            <DetailTile
              icon={<CalendarRange className="h-2.5 w-2.5" />}
              label="Period"
              value={period}
            />
            <DetailTile
              icon={<Coins className="h-2.5 w-2.5" />}
              label="Currency"
              value={detection.currency ?? "—"}
            />
            <DetailTile
              icon={<FileCode2 className="h-2.5 w-2.5" />}
              label="File type"
              value={detection.format.toUpperCase()}
            />
            <DetailTile
              icon={<Files className="h-2.5 w-2.5" />}
              label="Pages"
              value={detection.pages ? String(detection.pages) : "—"}
            />
            <DetailTile
              icon={<Rows3 className="h-2.5 w-2.5" />}
              label="Est. txns"
              value={detection.estimatedRows ? `~${detection.estimatedRows.toLocaleString()}` : "—"}
            />
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="mt-2 space-y-1">
              {errors.map((i) => (
                <li
                  key={i.code}
                  className="flex items-start gap-1.5 rounded-[10px] border border-destructive/30 bg-destructive/8 px-2 py-1.5 text-[11px] text-destructive"
                >
                  <XCircle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  {i.message}
                </li>
              ))}
              {warnings.map((i) => (
                <li
                  key={i.code}
                  className="flex items-start gap-1.5 rounded-[10px] border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px]"
                >
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-warning" aria-hidden />
                  <span className="flex-1">{i.message}</span>
                  {i.code === "bank-mismatch" && detection.bank && (
                    <button
                      type="button"
                      className="shrink-0 font-medium underline"
                      onClick={() => setBank(detection.bank!)}
                    >
                      Use {detection.bank}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {parsing && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-border" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.max(6, progress)}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-3">
        <span className="mr-auto text-[11px] text-muted-foreground">
          Parsing runs in the background — you can keep working once review opens.
        </span>
        <Button onClick={onParse} disabled={!ready || parsing} size="sm">
          {parsing ? "Parsing…" : "Parse statement"}
        </Button>
      </div>
    </div>
  );
}
