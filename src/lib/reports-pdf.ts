import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReportDef, ReportOutput } from "./reports-catalog";
import { renderChartToPngDataUrl } from "./reports-charts";

export async function exportReportToPDF(
  report: ReportDef,
  output: ReportOutput,
  meta: { from: string; to: string; owner?: string | null },
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(report.name, 40, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(report.description, 40, 50);
  doc.setFontSize(9);
  doc.text(`${meta.from}  →  ${meta.to}`, pageWidth - 40, 32, { align: "right" });
  doc.text(`Paisa • Personal Finance`, pageWidth - 40, 50, { align: "right" });

  let y = 90;
  doc.setTextColor(30, 41, 59);

  if (output.kpis?.length) {
    const w = (pageWidth - 80 - (output.kpis.length - 1) * 10) / output.kpis.length;
    output.kpis.forEach((k, i) => {
      const x = 40 + i * (w + 10);
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, w, 56, 6, 6, "FD");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(k.label.toUpperCase(), x + 10, y + 18);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(k.value, x + 10, y + 42);
      doc.setFont("helvetica", "normal");
    });
    y += 72;
  }

  // Chart(s)
  const hints = [output.chart, output.chart2].filter(Boolean) as NonNullable<typeof output.chart>[];
  for (const hint of hints) {
    try {
      const dataUrl = await renderChartToPngDataUrl(output, hint, 1600, 700);
      if (dataUrl) {
        const chartW = pageWidth - 80;
        const chartH = chartW * (700 / 1600);
        if (y + chartH > pageHeight - 60) {
          doc.addPage();
          y = 60;
        }
        doc.addImage(dataUrl, "PNG", 40, y, chartW, chartH);
        y += chartH + 16;
      }
    } catch {
      // ignore chart render failures
    }
  }

  if (output.rows.length === 0) {
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text(output.emptyMessage ?? "No data available for this period.", 40, y + 30);
  } else {
    autoTable(doc, {
      startY: y,
      head: [output.columns],
      body: output.rows.map((r) => r.map((c) => String(c))),
      foot: output.footer ? [output.footer.map((c) => String(c))] : undefined,
      styles: { fontSize: 9, cellPadding: 6, textColor: [30, 41, 59] },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(
        (output.numericColumns ?? []).map((i) => [i, { halign: "right" as const }]),
      ),
      margin: { left: 40, right: 40 },
    });
  }

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Generated ${new Date().toLocaleString("en-IN")}${meta.owner ? " • " + meta.owner : ""}`,
      40,
      doc.internal.pageSize.getHeight() - 20,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 20, {
      align: "right",
    });
  }

  const safe = report.id.replace(/[^a-z0-9-]/gi, "-");
  doc.save(`paisa-${safe}-${meta.from}-to-${meta.to}.pdf`);
}
