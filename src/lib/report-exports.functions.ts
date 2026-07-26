import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchReportsData } from "./reports-fetch";
import { REPORTS, type ReportOutput, type ReportDef } from "./reports-catalog";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ---------- helpers ----------
function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function outputToCsv(report: ReportDef, output: ReportOutput, from: string, to: string): string {
  const lines: string[] = [];
  lines.push(`# ${report.name}`);
  lines.push(`# ${report.description}`);
  lines.push(`# ${from} to ${to}`);
  if (output.kpis?.length) {
    lines.push("");
    lines.push(output.kpis.map((k) => escapeCsv(k.label)).join(","));
    lines.push(output.kpis.map((k) => escapeCsv(k.value)).join(","));
  }
  lines.push("");
  lines.push(output.columns.map(escapeCsv).join(","));
  for (const r of output.rows) lines.push(r.map(escapeCsv).join(","));
  if (output.footer) lines.push(output.footer.map(escapeCsv).join(","));
  return "\uFEFF" + lines.join("\n");
}
function outputToPdf(
  report: ReportDef,
  output: ReportOutput,
  from: string,
  to: string,
  owner?: string | null,
): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

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
  doc.text(`${from}  →  ${to}`, pageWidth - 40, 32, { align: "right" });
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
      `Generated ${new Date().toISOString().slice(0, 10)}${owner ? " • " + owner : ""}`,
      40,
      pageHeight - 20,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 40, pageHeight - 20, { align: "right" });
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

// ---------- Public: list jobs ----------
export const listReportJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("report_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data ?? [];
  });

export const getReportJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: job, error } = await context.supabase
      .from("report_jobs")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return job;
  });

export const signReportFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    // storage path always begins with the user's UID (RLS-enforced)
    if (!data.path.startsWith(`${context.userId}/`)) throw new Error("Forbidden");
    const { data: signed, error } = await context.supabase.storage
      .from("report-exports")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw error;
    return { url: signed?.signedUrl ?? null };
  });

// ---------- Start job + run it inline (streaming progress to DB) ----------
export const startReportExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        format: z.enum(["csv", "pdf"]),
        report_ids: z.array(z.string()).min(1).max(60),
        from: z.string(),
        to: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const s = context.supabase;

    // 1) Create job row
    const { data: job, error: jobErr } = await s
      .from("report_jobs")
      .insert({
        user_id: context.userId,
        format: data.format,
        report_ids: data.report_ids,
        from_date: data.from,
        to_date: data.to,
        status: "running",
        progress: 1,
        progress_message: "Fetching data…",
      })
      .select()
      .maybeSingle();
    if (jobErr || !job) throw jobErr ?? new Error("Failed to create job");

    const jobId = job.id as string;
    const updateJob = async (patch: Record<string, unknown>) => {
      await s.from("report_jobs").update(patch as any).eq("id", jobId);
    };

    try {
      // 2) Fetch data once
      const reportsData = await fetchReportsData(s, context.userId, data.from, data.to);
      const owner = (reportsData as any)?.profile?.display_name ?? null;
      const defs = REPORTS.filter((r) => data.report_ids.includes(r.id));
      const total = Math.max(1, defs.length);
      const files: Array<{ report_id: string; name: string; storage_path: string; size: number }> = [];

      await updateJob({ progress: 5, progress_message: `Rendering ${total} report(s)…` });

      // 3) Compute + serialize + upload each
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const output = def.compute(reportsData as any);
        const safeId = def.id.replace(/[^a-z0-9-]/gi, "-");
        const fileName = `paisa-${safeId}-${data.from}-to-${data.to}.${data.format}`;
        const storagePath = `${context.userId}/${jobId}/${fileName}`;

        let bytes: Uint8Array | string;
        let contentType: string;
        if (data.format === "csv") {
          bytes = outputToCsv(def, output, data.from, data.to);
          contentType = "text/csv;charset=utf-8";
        } else {
          bytes = outputToPdf(def, output, data.from, data.to, owner);
          contentType = "application/pdf";
        }

        const { error: upErr } = await s.storage
          .from("report-exports")
          .upload(storagePath, bytes, { contentType, upsert: true });
        if (upErr) throw upErr;

        const size = typeof bytes === "string" ? new TextEncoder().encode(bytes).length : bytes.byteLength;
        files.push({ report_id: def.id, name: def.name, storage_path: storagePath, size });

        const progress = 5 + Math.round(((i + 1) / total) * 90);
        await updateJob({
          progress,
          progress_message: `${i + 1}/${total} · ${def.name}`,
          files,
        });
      }

      await updateJob({
        status: "done",
        progress: 100,
        progress_message: "Complete",
        files,
        completed_at: new Date().toISOString(),
      });

      return { id: jobId };
    } catch (err: any) {
      await updateJob({
        status: "failed",
        error: String(err?.message ?? err),
        completed_at: new Date().toISOString(),
      });
      throw err;
    }
  });
