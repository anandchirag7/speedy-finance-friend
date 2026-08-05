import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReviewRow } from "@/components/statement-import/review/types";

export type ExportMeta = {
  /** "preview" = nothing saved yet, "imported" = post-import record. */
  kind: "preview" | "imported";
  fileName: string;
  account: string;
  bank: string;
  from: string;
  to: string;
};

export type ExportSummary = Array<[string, string]>;

const COLUMNS = [
  "Date",
  "Description",
  "Payee",
  "Category",
  "Type",
  "Amount",
  "Included",
  "Duplicate",
  "Duplicate reason",
  "Match confidence",
];

function toCells(
  rows: ReviewRow[],
  categoryName: (id: string | null) => string,
): string[][] {
  return rows.map((r) => [
    r.date,
    r.description,
    r.payee || "",
    categoryName(r.category_id),
    r.type,
    r.amount.toFixed(2),
    r.include ? "yes" : "no",
    r.duplicate ? "yes" : "no",
    r.dup?.reason ?? "",
    r.dup ? `${Math.round(r.dup.confidence * 100)}%` : "",
  ]);
}

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fileBase(meta: ExportMeta): string {
  const safe = meta.fileName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]+/gi, "-").slice(0, 48);
  return `paisa-import-${meta.kind}-${safe || "statement"}-${meta.from}-to-${meta.to}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** CSV record of an import preview or a completed import. */
export function exportImportToCSV(
  rows: ReviewRow[],
  meta: ExportMeta,
  summary: ExportSummary,
  categoryName: (id: string | null) => string,
) {
  const lines: string[] = [];
  lines.push(`# Statement import ${meta.kind === "preview" ? "preview" : "record"}`);
  lines.push(`# File: ${meta.fileName}`);
  lines.push(`# Account: ${meta.account} · Bank: ${meta.bank}`);
  lines.push(`# Period: ${meta.from} to ${meta.to}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push("");
  for (const [label, value] of summary) lines.push(`${escapeCsv(label)},${escapeCsv(value)}`);
  lines.push("");
  lines.push(COLUMNS.map(escapeCsv).join(","));
  for (const cells of toCells(rows, categoryName)) lines.push(cells.map(escapeCsv).join(","));

  download(
    new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" }),
    `${fileBase(meta)}.csv`,
  );
}

/** Paginated PDF record of an import preview or a completed import. */
export function exportImportToPDF(
  rows: ReviewRow[],
  meta: ExportMeta,
  summary: ExportSummary,
  categoryName: (id: string | null) => string,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 66, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(meta.kind === "preview" ? "Statement import preview" : "Imported transactions", 36, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${meta.fileName} · ${meta.account} · ${meta.bank}`, 36, 48);
  doc.text(`${meta.from} → ${meta.to}`, pageWidth - 36, 30, { align: "right" });
  doc.text(new Date().toLocaleString(), pageWidth - 36, 48, { align: "right" });

  doc.setTextColor(30, 41, 59);
  autoTable(doc, {
    startY: 84,
    head: [["Summary", "Value"]],
    body: summary.map(([l, v]) => [l, v]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
    margin: { left: 36, right: pageWidth / 2 },
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 16,
    head: [COLUMNS],
    body: toCells(rows, categoryName),
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 7 },
    columnStyles: {
      1: { cellWidth: 190 },
      5: { halign: "right" },
      8: { cellWidth: 130 },
    },
    margin: { left: 36, right: 36 },
  });

  doc.save(`${fileBase(meta)}.pdf`);
}
