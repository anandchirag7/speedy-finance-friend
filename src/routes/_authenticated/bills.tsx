import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus, Search, Calendar as CalendarIcon, LayoutList, CalendarDays, BarChart3,
  AlertTriangle, CheckCircle2, Clock, Zap, ExternalLink, MoreHorizontal,
  ChevronLeft, ChevronRight, Bell, Repeat, TrendingUp, Sparkles,
} from "lucide-react";
import {
  addMonths, addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, format, differenceInDays, parseISO,
} from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { listBills, listBillPayments, skipBillOccurrence, snoozeBill } from "@/lib/bills.functions";
import { BillFormDialog } from "@/components/bills/BillFormDialog";
import { MarkPaidDialog } from "@/components/bills/MarkPaidDialog";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/bills")({
  head: () => ({ meta: [{ title: "Bills & Reminders — Paisa" }, { name: "description", content: "One workspace for every recurring bill, EMI, subscription, and financial deadline." }] }),
  component: BillsPage,
});

type View = "list" | "calendar" | "timeline" | "analytics";
type StatusFilter = "all" | "upcoming" | "overdue" | "paid" | "snoozed";

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  normal: "bg-sky-100 text-sky-700",
  high: "bg-amber-100 text-amber-800",
  critical: "bg-rose-100 text-rose-700",
};

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  upcoming: { dot: "bg-sky-500", label: "Upcoming", text: "text-sky-700" },
  overdue: { dot: "bg-rose-500", label: "Overdue", text: "text-rose-700" },
  paid: { dot: "bg-emerald-500", label: "Paid", text: "text-emerald-700" },
  snoozed: { dot: "bg-amber-500", label: "Snoozed", text: "text-amber-700" },
  skipped: { dot: "bg-slate-400", label: "Skipped", text: "text-slate-600" },
  cancelled: { dot: "bg-slate-400", label: "Ended", text: "text-slate-500" },
};

function BillsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBills);
  const skip = useServerFn(skipBillOccurrence);
  const snooze = useServerFn(snoozeBill);
  const listPmts = useServerFn(listBillPayments);

  const { data: bills = [], isLoading } = useQuery({ queryKey: ["bills"], queryFn: () => list() });
  const { data: payments = [] } = useQuery({ queryKey: ["bill-payments"], queryFn: () => listPmts({ data: {} }) });

  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [priority, setPriority] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [payTarget, setPayTarget] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [calMonth, setCalMonth] = useState(new Date());

  const filtered = useMemo(() => {
    return (bills as any[]).filter((b) => {
      if (search && !`${b.name} ${b.category?.name ?? ""} ${b.account?.name ?? ""} ${(b.tags ?? []).join(" ")}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (status !== "all" && b.computed_status !== status) return false;
      if (priority !== "all" && b.priority !== priority) return false;
      return true;
    });
  }, [bills, search, status, priority]);

  const kpis = useMemo(() => {
    const today = new Date();
    const in7 = addDays(today, 7);
    const in30 = addDays(today, 30);
    let overdueCount = 0, overdueTotal = 0;
    let weekCount = 0, weekTotal = 0;
    let monthCount = 0, monthTotal = 0;
    let autoPayCount = 0;
    for (const b of bills as any[]) {
      if (!b.is_active) continue;
      const due = parseISO(b.due_date);
      const amt = Number(b.amount ?? 0);
      if (b.computed_status === "overdue") { overdueCount++; overdueTotal += amt; }
      if (b.computed_status === "upcoming" && due <= in7) { weekCount++; weekTotal += amt; }
      if (b.computed_status !== "paid" && due <= in30) { monthCount++; monthTotal += amt; }
      if (b.auto_pay) autoPayCount++;
    }
    return { overdueCount, overdueTotal, weekCount, weekTotal, monthCount, monthTotal, autoPayCount };
  }, [bills]);

  const monthChart = useMemo(() => {
    const buckets: { key: string; label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = addMonths(now, i);
      buckets.push({ key: format(d, "yyyy-MM"), label: format(d, "MMM"), total: 0 });
    }
    for (const b of bills as any[]) {
      if (!b.is_active || b.computed_status === "paid" || b.computed_status === "cancelled") continue;
      const due = parseISO(b.due_date);
      const amt = Number(b.amount ?? 0);
      const cadences: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30.4, quarterly: 91, half_yearly: 182, yearly: 365, once: 0 };
      const step = cadences[b.recurrence] ?? 0;
      if (step === 0) {
        const k = format(due, "yyyy-MM");
        const bkt = buckets.find((x) => x.key === k);
        if (bkt) bkt.total += amt;
      } else {
        let d = new Date(due);
        for (let iter = 0; iter < 30 && d <= addMonths(now, 6); iter++) {
          const k = format(d, "yyyy-MM");
          const bkt = buckets.find((x) => x.key === k);
          if (bkt) bkt.total += amt;
          d = addDays(d, step);
        }
      }
    }
    return buckets;
  }, [bills]);

  const skipMut = useMutation({
    mutationFn: async (id: string) => skip({ data: { bill_id: id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bills"] }); toast.success("Skipped this occurrence"); },
  });
  const snoozeMut = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number }) => {
      const b = (bills as any[]).find((x) => x.id === id);
      const nd = addDays(parseISO(b.due_date), days).toISOString().slice(0, 10);
      return snooze({ data: { bill_id: id, new_due_date: nd } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bills"] }); toast.success("Snoozed"); },
  });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col h-full">
        <div className="border-b bg-background/95 backdrop-blur px-6 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <Bell className="h-6 w-6 text-primary" /> Bills & Reminders
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Every EMI, subscription, premium and utility — in one calendar.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
                <Plus className="h-4 w-4 mr-1.5" /> New bill
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Overdue" value={formatCurrency(kpis.overdueTotal)} sub={`${kpis.overdueCount} bills`} tone="rose" />
            <Kpi icon={<Clock className="h-4 w-4" />} label="Due this week" value={formatCurrency(kpis.weekTotal)} sub={`${kpis.weekCount} bills`} tone="amber" />
            <Kpi icon={<CalendarIcon className="h-4 w-4" />} label="Due in 30 days" value={formatCurrency(kpis.monthTotal)} sub={`${kpis.monthCount} bills`} tone="sky" />
            <Kpi icon={<Zap className="h-4 w-4" />} label="On auto-pay" value={String(kpis.autoPayCount)} sub={`of ${(bills as any[]).filter((b) => b.is_active).length} active`} tone="emerald" />
          </div>
        </div>

        <div className="border-b px-6 py-3 flex items-center gap-2 flex-wrap bg-muted/30">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search bills, tags, categories…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="snoozed">Snoozed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any priority</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto">
            <Tabs value={view} onValueChange={(v: any) => setView(v)}>
              <TabsList className="h-9">
                <TabsTrigger value="list" className="gap-1.5"><LayoutList className="h-4 w-4" />List</TabsTrigger>
                <TabsTrigger value="calendar" className="gap-1.5"><CalendarDays className="h-4 w-4" />Calendar</TabsTrigger>
                <TabsTrigger value="timeline" className="gap-1.5"><TrendingUp className="h-4 w-4" />Timeline</TabsTrigger>
                <TabsTrigger value="analytics" className="gap-1.5"><BarChart3 className="h-4 w-4" />Analytics</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground text-sm">Loading bills…</div>
          ) : filtered.length === 0 && (bills as any[]).length === 0 ? (
            <EmptyState onCreate={() => { setEditing(null); setShowForm(true); }} />
          ) : view === "list" ? (
            <ListView bills={filtered} onOpen={setDetail} onEdit={(b: any) => { setEditing(b); setShowForm(true); }}
              onPay={setPayTarget} onSkip={(id: string) => skipMut.mutate(id)} onSnooze={(id: string, d: number) => snoozeMut.mutate({ id, days: d })} />
          ) : view === "calendar" ? (
            <CalendarView bills={filtered} month={calMonth} onMonthChange={setCalMonth} onOpen={setDetail} />
          ) : view === "timeline" ? (
            <TimelineView bills={filtered} onOpen={setDetail} />
          ) : (
            <AnalyticsView bills={bills as any[]} payments={payments as any[]} chart={monthChart} />
          )}
        </div>
      </div>

      <BillFormDialog open={showForm} onOpenChange={setShowForm} bill={editing} />
      <MarkPaidDialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)} bill={payTarget} />
      <DetailSheet bill={detail} onOpenChange={(o) => !o && setDetail(null)}
        onEdit={(b: any) => { setDetail(null); setEditing(b); setShowForm(true); }}
        onPay={(b: any) => { setDetail(null); setPayTarget(b); }} />
    </TooltipProvider>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: "rose" | "amber" | "sky" | "emerald" }) {
  const tones: Record<string, string> = {
    rose: "bg-rose-50 text-rose-600 ring-rose-100",
    amber: "bg-amber-50 text-amber-600 ring-amber-100",
    sky: "bg-sky-50 text-sky-600 ring-sky-100",
    emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  };
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center ring-1", tones[tone])}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold leading-tight truncate">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="p-12 max-w-xl mx-auto text-center">
      <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Bell className="h-7 w-7" />
      </div>
      <h2 className="text-xl font-semibold">No bills yet</h2>
      <p className="text-muted-foreground text-sm mt-1">Add credit-card dues, EMIs, SIPs, insurance premiums, PPF deadlines, and rent — all in one calendar.</p>
      <Button className="mt-5" onClick={onCreate}><Plus className="h-4 w-4 mr-1.5" />Create your first bill</Button>
    </div>
  );
}

function ListView({ bills, onOpen, onEdit, onPay, onSkip, onSnooze }: any) {
  const groups = useMemo(() => {
    const today = new Date();
    const g: Record<string, any[]> = { Overdue: [], "Due this week": [], "Due this month": [], Later: [], Ended: [] };
    for (const b of bills) {
      const due = parseISO(b.due_date);
      const diff = differenceInDays(due, today);
      if (b.computed_status === "cancelled") g.Ended.push(b);
      else if (b.computed_status === "overdue" || diff < 0) g.Overdue.push(b);
      else if (diff <= 7) g["Due this week"].push(b);
      else if (diff <= 30) g["Due this month"].push(b);
      else g.Later.push(b);
    }
    return g;
  }, [bills]);

  return (
    <div className="p-6 space-y-6">
      {Object.entries(groups).map(([label, items]) => items.length === 0 ? null : (
        <div key={label}>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
            <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
          </div>
          <div className="border rounded-lg overflow-hidden bg-card">
            {items.map((b: any, i: number) => (
              <BillRow key={b.id} bill={b} onOpen={() => onOpen(b)} onEdit={() => onEdit(b)}
                onPay={() => onPay(b)} onSkip={() => onSkip(b.id)} onSnooze={(d: number) => onSnooze(b.id, d)}
                divider={i > 0} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BillRow({ bill, onOpen, onEdit, onPay, onSkip, onSnooze, divider }: any) {
  const status = STATUS_STYLES[bill.computed_status] ?? STATUS_STYLES.upcoming;
  const due = parseISO(bill.due_date);
  const diff = differenceInDays(due, new Date());
  const relative = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday"
    : diff < 0 ? `${Math.abs(diff)}d overdue` : `in ${diff}d`;
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition cursor-pointer group", divider && "border-t")}
      onClick={onOpen}>
      <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", status.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-medium truncate">{bill.name}</div>
          {bill.auto_pay && <Tooltip><TooltipTrigger asChild><span><Zap className="h-3.5 w-3.5 text-emerald-500" /></span></TooltipTrigger><TooltipContent>Auto-pay</TooltipContent></Tooltip>}
          {bill.is_estimated && <Badge variant="outline" className="text-[10px] h-4">est.</Badge>}
          {bill.recurrence !== "once" && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><Repeat className="h-3 w-3" />{bill.recurrence.replace("_", " ")}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{format(due, "MMM d")}</span>
          <span>· {relative}</span>
          {bill.category?.name && <><span>·</span><span className="truncate">{bill.category.name}</span></>}
          {bill.account?.name && <><span>·</span><span className="truncate">{bill.account.name}</span></>}
        </div>
      </div>
      {bill.priority !== "normal" && <Badge className={cn("text-[10px]", PRIORITY_STYLES[bill.priority])} variant="secondary">{bill.priority}</Badge>}
      <div className="text-right shrink-0">
        <div className="font-semibold tabular-nums">{bill.amount != null ? formatCurrency(bill.amount, bill.currency ?? "INR") : "—"}</div>
        <div className={cn("text-xs", status.text)}>{status.label}</div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
        {bill.computed_status !== "paid" && bill.computed_status !== "cancelled" && (
          <Button size="sm" variant="outline" onClick={onPay}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Mark paid</Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={onSkip}>Skip this occurrence</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground">Snooze</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onSnooze(1)}>1 day</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(3)}>3 days</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(7)}>1 week</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function CalendarView({ bills, month, onMonthChange, onOpen }: any) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const byDay: Record<string, any[]> = {};
  for (const b of bills as any[]) {
    const k = b.due_date;
    (byDay[k] ??= []).push(b);
  }

  const monthTotal = (bills as any[])
    .filter((b) => isSameMonth(parseISO(b.due_date), month))
    .reduce((s, b) => s + Number(b.amount ?? 0), 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">{format(month, "MMMM yyyy")}</h3>
          <p className="text-xs text-muted-foreground">{formatCurrency(monthTotal)} across {(bills as any[]).filter((b) => isSameMonth(parseISO(b.due_date), month)).length} bills</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => onMonthChange(new Date())}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 border-t border-l rounded-lg overflow-hidden bg-card">
        {days.map((d) => {
          const k = d.toISOString().slice(0, 10);
          const items = byDay[k] ?? [];
          const inMonth = isSameMonth(d, month);
          const isToday = isSameDay(d, new Date());
          return (
            <div key={k} className={cn("border-r border-b min-h-[112px] p-1.5 text-xs", !inMonth && "bg-muted/30 text-muted-foreground/60")}>
              <div className={cn("h-6 w-6 flex items-center justify-center rounded-full mb-1 text-[11px] font-medium", isToday && "bg-primary text-primary-foreground")}>
                {format(d, "d")}
              </div>
              <div className="space-y-1">
                {items.slice(0, 3).map((b: any) => {
                  const s = STATUS_STYLES[b.computed_status] ?? STATUS_STYLES.upcoming;
                  return (
                    <button key={b.id} onClick={() => onOpen(b)}
                      className={cn("w-full text-left truncate px-1.5 py-0.5 rounded text-[11px] flex items-center gap-1 border bg-background hover:bg-muted")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", s.dot)} />
                      <span className="truncate flex-1">{b.name}</span>
                    </button>
                  );
                })}
                {items.length > 3 && <div className="text-[10px] text-muted-foreground px-1.5">+ {items.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineView({ bills, onOpen }: any) {
  const sorted = [...(bills as any[])].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 40);
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="relative border-l pl-6 ml-3">
        {sorted.map((b) => {
          const due = parseISO(b.due_date);
          const s = STATUS_STYLES[b.computed_status] ?? STATUS_STYLES.upcoming;
          return (
            <div key={b.id} className="relative pb-5">
              <span className={cn("absolute -left-[31px] top-1.5 h-3 w-3 rounded-full ring-4 ring-background", s.dot)} />
              <button onClick={() => onOpen(b)} className="w-full text-left bg-card border rounded-lg p-3 hover:bg-muted/50 transition">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{format(due, "EEE, MMM d")}</div>
                    <div className="font-medium truncate">{b.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{[b.category?.name, b.account?.name].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold tabular-nums">{b.amount != null ? formatCurrency(b.amount, b.currency) : "—"}</div>
                    <div className={cn("text-xs", s.text)}>{s.label}</div>
                  </div>
                </div>
              </button>
            </div>
          );
        })}
        {sorted.length === 0 && <div className="text-sm text-muted-foreground">Nothing scheduled.</div>}
      </div>
    </div>
  );
}

function AnalyticsView({ bills, payments, chart }: any) {
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bills) {
      if (!b.is_active) continue;
      const k = b.category?.name ?? "Uncategorized";
      m.set(k, (m.get(k) ?? 0) + Number(b.amount ?? 0));
    }
    return Array.from(m, ([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [bills]);
  const totalActive = bills.filter((b: any) => b.is_active).length;
  const totalMonthly = bills.filter((b: any) => b.is_active && b.recurrence === "monthly").reduce((s: number, b: any) => s + Number(b.amount ?? 0), 0);
  const totalYearly = bills.filter((b: any) => b.is_active && b.recurrence === "yearly").reduce((s: number, b: any) => s + Number(b.amount ?? 0), 0);
  const paidLast30 = (payments as any[]).filter((p) => p.status === "paid" && p.paid_date && differenceInDays(new Date(), parseISO(p.paid_date)) <= 30).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const paidCount = (payments as any[]).filter((p) => p.status === "paid").length;

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Repeat className="h-4 w-4" />} label="Active bills" value={String(totalActive)} sub="tracked" tone="sky" />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Monthly commitments" value={formatCurrency(totalMonthly)} sub="recurring/mo" tone="emerald" />
        <Kpi icon={<CalendarIcon className="h-4 w-4" />} label="Yearly commitments" value={formatCurrency(totalYearly)} sub="renew/yr" tone="amber" />
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Paid last 30 days" value={formatCurrency(paidLast30)} sub={`${paidCount} payments`} tone="emerald" />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3"><BarChart3 className="h-4 w-4 text-muted-foreground" /><h3 className="font-semibold text-sm">Projected outflows — next 6 months</h3></div>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={(v) => formatCurrency(v)} fontSize={11} tickLine={false} axisLine={false} width={80} />
              <RTooltip formatter={(v: any) => formatCurrency(v)} />
              <Bar dataKey="total" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3"><Sparkles className="h-4 w-4 text-muted-foreground" /><h3 className="font-semibold text-sm">Top categories</h3></div>
        <div className="space-y-2">
          {byCategory.map((c) => {
            const pct = byCategory[0].total > 0 ? (c.total / byCategory[0].total) * 100 : 0;
            return (
              <div key={c.name} className="grid grid-cols-[1fr_2fr_auto] gap-3 items-center">
                <div className="text-sm truncate">{c.name}</div>
                <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} /></div>
                <div className="tabular-nums text-sm font-medium">{formatCurrency(c.total)}</div>
              </div>
            );
          })}
          {byCategory.length === 0 && <div className="text-sm text-muted-foreground">No data yet.</div>}
        </div>
      </Card>
    </div>
  );
}

function DetailSheet({ bill, onOpenChange, onEdit, onPay }: any) {
  const listPmts = useServerFn(listBillPayments);
  const { data: payments = [] } = useQuery({
    queryKey: ["bill-payments", bill?.id],
    queryFn: () => listPmts({ data: { bill_id: bill.id } }),
    enabled: !!bill,
  });
  if (!bill) return null;
  const s = STATUS_STYLES[bill.computed_status] ?? STATUS_STYLES.upcoming;
  return (
    <Sheet open={!!bill} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", s.dot)} />{bill.name}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-semibold tabular-nums">{bill.amount != null ? formatCurrency(bill.amount, bill.currency) : "—"}</div>
            {bill.is_estimated && <Badge variant="outline">estimated</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className={PRIORITY_STYLES[bill.priority]}>{bill.priority}</Badge>
            <Badge variant="outline">{bill.recurrence.replace("_", " ")}</Badge>
            {bill.auto_pay && <Badge variant="outline" className="text-emerald-700 border-emerald-200"><Zap className="h-3 w-3 mr-1" />Auto-pay</Badge>}
            {(bill.tags ?? []).map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Next due" value={format(parseISO(bill.due_date), "PPP")} />
            <Info label="Status" value={s.label} />
            <Info label="Account" value={bill.account?.name ?? "—"} />
            <Info label="Category" value={bill.category?.name ?? "—"} />
            <Info label="Last paid" value={bill.last_paid_at ? format(parseISO(bill.last_paid_at), "PPP") : "—"} />
            <Info label="Reminders" value={(bill.reminder_days ?? []).map((d: number) => d === 0 ? "0d" : `${d}d`).join(", ") || "—"} />
          </div>
          {bill.url && (
            <a href={bill.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              <ExternalLink className="h-3.5 w-3.5" />Open payment page
            </a>
          )}
          {bill.notes && <div className="text-sm bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">{bill.notes}</div>}

          <Separator />

          <div className="flex gap-2">
            {bill.computed_status !== "paid" && bill.computed_status !== "cancelled" && (
              <Button className="flex-1" onClick={() => onPay(bill)}><CheckCircle2 className="h-4 w-4 mr-1.5" />Mark paid</Button>
            )}
            <Button variant="outline" className="flex-1" onClick={() => onEdit(bill)}>Edit</Button>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">Payment history</h4>
            <ScrollArea className="max-h-64">
              <div className="space-y-1.5">
                {(payments as any[]).length === 0 && <div className="text-xs text-muted-foreground">No payments recorded yet.</div>}
                {(payments as any[]).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                    <div>
                      <div className="font-medium">{p.paid_date ? format(parseISO(p.paid_date), "MMM d, yyyy") : format(parseISO(p.due_date), "MMM d, yyyy")}</div>
                      <div className="text-xs text-muted-foreground capitalize">{p.status}{p.notes ? ` · ${p.notes}` : ""}</div>
                    </div>
                    <div className="tabular-nums">{p.amount != null ? formatCurrency(p.amount, bill.currency) : "—"}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
