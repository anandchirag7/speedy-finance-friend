import type { ReportDef, ReportOutput } from "./reports-catalog";

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportReportToCSV(
  report: ReportDef,
  output: ReportOutput,
  meta: { from: string; to: string },
) {
  const lines: string[] = [];
  lines.push(`# ${report.name}`);
  lines.push(`# ${report.description}`);
  lines.push(`# ${meta.from} to ${meta.to}`);
  if (output.kpis?.length) {
    lines.push("");
    lines.push(output.kpis.map((k) => escapeCsv(k.label)).join(","));
    lines.push(output.kpis.map((k) => escapeCsv(k.value)).join(","));
  }
  lines.push("");
  lines.push(output.columns.map(escapeCsv).join(","));
  for (const r of output.rows) lines.push(r.map(escapeCsv).join(","));
  if (output.footer) lines.push(output.footer.map(escapeCsv).join(","));

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = report.id.replace(/[^a-z0-9-]/gi, "-");
  a.href = url;
  a.download = `paisa-${safe}-${meta.from}-to-${meta.to}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
