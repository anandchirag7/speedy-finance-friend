import { useEffect, useMemo, useRef, useState } from "react";
import RGL from "react-grid-layout";
type Layout = { i: string; x: number; y: number; w: number; h: number };
const GridLayout: any = (RGL as any).GridLayout ?? (RGL as any).default ?? RGL;
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  Search, Plus, Copy, Trash2, Star, StarOff, X, Undo2, Redo2, Layers,
  Sparkles, Settings2, GripVertical, LayoutTemplate, Save, Check, ChevronRight,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  WIDGET_REGISTRY, WIDGET_BY_TYPE, CATEGORIES, AI_RECOMMENDED_TYPES,
  type WidgetCategory, type WidgetDef,
} from "@/lib/dashboard-widgets";
import { TEMPLATES } from "@/lib/dashboard-templates";
import {
  listDashboards, createDashboard, updateDashboard, deleteDashboard,
  setDefaultDashboard, duplicateDashboard,
  type DashboardRow, type WidgetLayoutItem,
} from "@/lib/dashboards.functions";
import { getDashboard } from "@/lib/finance.functions";

function ResponsiveGrid(props: any) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref}><GridLayout width={w} {...props} /></div>;
}
const uid = () => Math.random().toString(36).slice(2, 10);
const FAVS_KEY = "paisa.widgetFavs";
const RECENT_KEY = "paisa.widgetRecent";

function readLS(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}
function writeLS(key: string, v: string[]) {
  localStorage.setItem(key, JSON.stringify(v));
}

export function DashboardBuilderDialog({
  open, onOpenChange, dashboardId, onDashboardIdChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dashboardId: string | null;
  onDashboardIdChange: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1400px,96vw)] p-0 gap-0 h-[92vh] overflow-hidden">
        <DialogHeader className="sr-only"><DialogTitle>Dashboard Builder</DialogTitle></DialogHeader>
        {open && (
          <BuilderInner
            dashboardId={dashboardId}
            onDashboardIdChange={onDashboardIdChange}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BuilderInner({
  dashboardId, onDashboardIdChange, onClose,
}: {
  dashboardId: string | null;
  onDashboardIdChange: (id: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listDashboards);
  const dataFn = useServerFn(getDashboard);
  const createFn = useServerFn(createDashboard);
  const updateFn = useServerFn(updateDashboard);
  const deleteFn = useServerFn(deleteDashboard);
  const setDefFn = useServerFn(setDefaultDashboard);
  const dupFn = useServerFn(duplicateDashboard);

  const { data: dashboards = [] } = useQuery({ queryKey: ["dashboards"], queryFn: () => listFn() });
  const { data: metrics } = useQuery({ queryKey: ["dashboard", "1m"], queryFn: () => dataFn({ data: { range: "1m" } }) });

  const current: DashboardRow | undefined =
    dashboards.find((d) => d.id === dashboardId) ?? dashboards.find((d) => d.is_default) ?? dashboards[0];

  useEffect(() => { if (current && current.id !== dashboardId) onDashboardIdChange(current.id); }, [current?.id]);

  // ---- undo/redo local state
  const [history, setHistory] = useState<WidgetLayoutItem[][]>([]);
  const [redo, setRedo] = useState<WidgetLayoutItem[][]>([]);
  const [layout, setLayout] = useState<WidgetLayoutItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<WidgetCategory | "All">("All");
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [name, setName] = useState("");

  useEffect(() => { setFavs(readLS(FAVS_KEY)); setRecent(readLS(RECENT_KEY)); }, []);
  useEffect(() => {
    if (current) {
      setLayout(current.layout ?? []);
      setName(current.name);
      setHistory([]); setRedo([]);
    }
  }, [current?.id]);

  const commit = (next: WidgetLayoutItem[]) => {
    setHistory((h) => [...h, layout]); setRedo([]); setLayout(next);
  };
  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1)); setRedo((r) => [...r, layout]); setLayout(prev);
  };
  const redoAction = () => {
    if (!redo.length) return;
    const next = redo[redo.length - 1];
    setRedo((r) => r.slice(0, -1)); setHistory((h) => [...h, layout]); setLayout(next);
  };

  // ---- autosave
  const saveTimer = useRef<number | null>(null);
  const saveMut = useMutation({
    mutationFn: (patch: { id: string; layout?: WidgetLayoutItem[]; name?: string }) => updateFn({ data: patch }),
    onSuccess: () => { setSavedAt(new Date()); qc.invalidateQueries({ queryKey: ["dashboards"] }); },
  });
  useEffect(() => {
    if (!current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveMut.mutate({ id: current.id, layout, name });
    }, 700) as unknown as number;
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [layout, name, current?.id]);

  // ---- add / remove widgets
  const addWidget = (def: WidgetDef) => {
    const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const item: WidgetLayoutItem = {
      i: uid(), type: def.type, x: 0, y: maxY, w: def.defaultSize.w, h: def.defaultSize.h,
    };
    commit([...layout, item]);
    setSelectedId(item.i);
    const nextRecent = [def.type, ...recent.filter((t) => t !== def.type)].slice(0, 8);
    setRecent(nextRecent); writeLS(RECENT_KEY, nextRecent);
  };
  const removeWidget = (i: string) => {
    commit(layout.filter((l) => l.i !== i));
    if (selectedId === i) setSelectedId(null);
  };
  const duplicateWidget = (i: string) => {
    const src = layout.find((l) => l.i === i); if (!src) return;
    const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const clone: WidgetLayoutItem = { ...src, i: uid(), y: maxY };
    commit([...layout, clone]);
  };
  const updateWidget = (i: string, patch: Partial<WidgetLayoutItem>) => {
    commit(layout.map((l) => (l.i === i ? { ...l, ...patch } : l)));
  };
  const toggleFav = (type: string) => {
    const next = favs.includes(type) ? favs.filter((f) => f !== type) : [...favs, type];
    setFavs(next); writeLS(FAVS_KEY, next);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return WIDGET_REGISTRY.filter((w) => {
      if (category !== "All" && w.category !== category) return false;
      if (q && !`${w.title} ${w.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, category]);

  const onGridChange = (l: Layout[]) => {
    const map = new Map(l.map((x) => [x.i, x]));
    const next = layout.map((item) => {
      const g = map.get(item.i);
      return g ? { ...item, x: g.x, y: g.y, w: g.w, h: g.h } : item;
    });
    // avoid history spam: only commit if geometry actually changed
    const changed = next.some((n, idx) => {
      const p = layout[idx];
      return !p || p.x !== n.x || p.y !== n.y || p.w !== n.w || p.h !== n.h;
    });
    if (changed) commit(next);
  };

  const selected = selectedId ? layout.find((l) => l.i === selectedId) : null;
  const selectedDef = selected ? WIDGET_BY_TYPE[selected.type] : null;

  // ---- dashboards management
  const handleCreate = async (fromTemplate?: string) => {
    const tmpl = TEMPLATES.find((t) => t.key === fromTemplate);
    const row = await createFn({ data: { name: tmpl?.name ?? "New Dashboard", template_key: tmpl?.key, layout: tmpl?.layout ?? [] } });
    qc.invalidateQueries({ queryKey: ["dashboards"] });
    onDashboardIdChange((row as any).id);
    toast.success("Dashboard created");
  };
  const handleDelete = async () => {
    if (!current) return;
    if (!confirm(`Delete "${current.name}"?`)) return;
    await deleteFn({ data: { id: current.id } });
    qc.invalidateQueries({ queryKey: ["dashboards"] });
    toast.success("Deleted");
  };
  const handleDuplicate = async () => {
    if (!current) return;
    const row = await dupFn({ data: { id: current.id } });
    qc.invalidateQueries({ queryKey: ["dashboards"] });
    onDashboardIdChange((row as any).id);
    toast.success("Duplicated");
  };
  const handleSetDefault = async () => {
    if (!current) return;
    await setDefFn({ data: { id: current.id } });
    qc.invalidateQueries({ queryKey: ["dashboards"] });
    toast.success("Set as default");
  };
  const handleExport = () => {
    if (!current) return;
    const blob = new Blob([JSON.stringify({ name: current.name, layout }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${current.name.replace(/\s+/g, "-")}.dashboard.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const handleImport = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/json";
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const parsed = JSON.parse(await f.text());
      if (Array.isArray(parsed.layout)) commit(parsed.layout);
      toast.success("Layout imported");
    };
    inp.click();
  };

  return (
    <div className="flex h-full flex-col bg-[hsl(210,40%,98%)] dark:bg-background">
      {/* Sticky toolbar */}
      <div className="flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
        <Select value={current?.id ?? ""} onValueChange={onDashboardIdChange}>
          <SelectTrigger className="h-8 w-[220px] text-sm"><SelectValue placeholder="Select dashboard" /></SelectTrigger>
          <SelectContent>
            {dashboards.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                <div className="flex items-center gap-2">{d.is_default && <Star className="h-3 w-3 fill-current" />}{d.name}</div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Dashboard name" className="h-8 max-w-[240px]"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8"><Plus className="mr-1.5 h-3.5 w-3.5" />New</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Start blank</p>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => handleCreate()}>Empty dashboard</Button>
            <Separator className="my-1" />
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">From template</p>
            <div className="max-h-64 overflow-auto">
              {TEMPLATES.map((t) => (
                <Button key={t.key} variant="ghost" size="sm" className="w-full justify-start" onClick={() => handleCreate(t.key)}>
                  <ChevronRight className="mr-1 h-3.5 w-3.5" />{t.name}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDuplicate} title="Duplicate"><Copy className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSetDefault} title={current?.is_default ? "Default" : "Set as default"}>
          {current?.is_default ? <Star className="h-4 w-4 fill-current text-warning" /> : <StarOff className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDelete} title="Delete"><Trash2 className="h-4 w-4" /></Button>
        <div className="ml-2 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={!history.length} title="Undo"><Undo2 className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redoAction} disabled={!redo.length} title="Redo"><Redo2 className="h-4 w-4" /></Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleImport}>Import</Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>Export</Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {saveMut.isPending ? <><Save className="h-3.5 w-3.5 animate-pulse" /> Saving…</> :
             savedAt ? <><Check className="h-3.5 w-3.5 text-success" /> Saved</> : null}
          </div>
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>

      {/* 3-panel body */}
      <div className="grid flex-1 min-h-0 grid-cols-[280px_1fr_320px]">
        {/* LEFT — widget library */}
        <aside className="flex min-h-0 flex-col border-r bg-background/60">
          <div className="p-3 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search widgets" className="h-8 pl-8" />
            </div>
            <Select value={category} onValueChange={(v) => setCategory(v as any)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All categories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-4 px-3 pb-6">
              {favs.length > 0 && category === "All" && !search && (
                <WidgetGroup title="Favorites" icon={Star} defs={favs.map((t) => WIDGET_BY_TYPE[t]).filter(Boolean)} onAdd={addWidget} favs={favs} onFav={toggleFav} />
              )}
              {recent.length > 0 && category === "All" && !search && (
                <WidgetGroup title="Recently used" icon={Layers} defs={recent.map((t) => WIDGET_BY_TYPE[t]).filter(Boolean)} onAdd={addWidget} favs={favs} onFav={toggleFav} />
              )}
              {category === "All" && !search && (
                <WidgetGroup title="AI recommendations" icon={Sparkles} defs={AI_RECOMMENDED_TYPES.map((t) => WIDGET_BY_TYPE[t]).filter(Boolean)} onAdd={addWidget} favs={favs} onFav={toggleFav} />
              )}
              {(category === "All" ? CATEGORIES : [category as WidgetCategory]).map((cat) => {
                const items = filtered.filter((w) => w.category === cat);
                if (!items.length) return null;
                return <WidgetGroup key={cat} title={cat} defs={items} onAdd={addWidget} favs={favs} onFav={toggleFav} />;
              })}
              {filtered.length === 0 && <p className="pt-8 text-center text-xs text-muted-foreground">No widgets match.</p>}
            </div>
          </ScrollArea>
        </aside>

        {/* CENTER — canvas */}
        <section className="min-w-0 overflow-auto p-4">
          {layout.length === 0 ? (
            <EmptyCanvas onBrowse={() => document.getElementById("widget-search")?.focus()} onTemplate={(k) => handleCreate(k)} />
          ) : (
            <div className="mx-auto max-w-[1200px]">
              <ResponsiveGrid
                className="layout"
                cols={12}
                rowHeight={64}
                margin={[12, 12]}
                draggableHandle=".drag-handle"
                onLayoutChange={onGridChange}
                layout={layout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h, minW: WIDGET_BY_TYPE[l.type]?.minSize?.w ?? 3, minH: WIDGET_BY_TYPE[l.type]?.minSize?.h ?? 3 }))}
              >
                {layout.map((item) => {
                  const def = WIDGET_BY_TYPE[item.type];
                  const isSel = selectedId === item.i;
                  return (
                    <div key={item.i}
                      className={cn("group relative rounded-2xl bg-card shadow-sm ring-1 ring-border transition", isSel && "ring-2 ring-primary")}
                      onClick={() => setSelectedId(item.i)}
                    >
                      <div className="drag-handle absolute left-2 top-2 z-10 grid h-6 w-6 cursor-grab place-items-center rounded-md bg-background/80 opacity-0 shadow-sm ring-1 ring-border transition group-hover:opacity-100">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100">
                        <Button variant="secondary" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); duplicateWidget(item.i); }} title="Duplicate"><Copy className="h-3 w-3" /></Button>
                        <Button variant="secondary" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); removeWidget(item.i); }} title="Remove"><X className="h-3 w-3" /></Button>
                      </div>
                      <div className="h-full overflow-hidden">
                        {def ? def.render({ data: metrics, settings: item.settings }) : <div className="grid h-full place-items-center text-sm text-muted-foreground">Unknown widget: {item.type}</div>}
                      </div>
                    </div>
                  );
                })}
              </ResponsiveGrid>
            </div>
          )}
        </section>

        {/* RIGHT — settings */}
        <aside className="flex min-h-0 flex-col border-l bg-background/60">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Widget settings</p>
          </div>
          <ScrollArea className="flex-1">
            {!selected || !selectedDef ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Select a widget on the canvas to configure it.</div>
            ) : (
              <div className="space-y-4 p-4">
                <div className="flex items-start gap-2">
                  <selectedDef.icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{selectedDef.title}</p>
                    <p className="text-xs text-muted-foreground">{selectedDef.category}</p>
                  </div>
                </div>
                <SettingRow label="Title">
                  <Input value={selected.settings?.title ?? selectedDef.title}
                    onChange={(e) => updateWidget(selected.i, { settings: { ...(selected.settings ?? {}), title: e.target.value } })} className="h-8" />
                </SettingRow>
                <SettingRow label="Width">
                  <Input type="number" min={2} max={12} value={selected.w}
                    onChange={(e) => updateWidget(selected.i, { w: Math.max(2, Math.min(12, Number(e.target.value) || 2)) })} className="h-8" />
                </SettingRow>
                <SettingRow label="Height">
                  <Input type="number" min={2} max={12} value={selected.h}
                    onChange={(e) => updateWidget(selected.i, { h: Math.max(2, Math.min(20, Number(e.target.value) || 3)) })} className="h-8" />
                </SettingRow>
                <SettingRow label="Date range">
                  <Select value={selected.settings?.range ?? "inherit"}
                    onValueChange={(v) => updateWidget(selected.i, { settings: { ...(selected.settings ?? {}), range: v } })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Inherit dashboard</SelectItem>
                      <SelectItem value="1m">Last month</SelectItem>
                      <SelectItem value="3m">Last 3 months</SelectItem>
                      <SelectItem value="6m">Last 6 months</SelectItem>
                      <SelectItem value="1y">Last year</SelectItem>
                      <SelectItem value="ytd">Year to date</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Chart type">
                  <Select value={selected.settings?.chart ?? "default"} onValueChange={(v) => updateWidget(selected.i, { settings: { ...(selected.settings ?? {}), chart: v } })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="bar">Bar</SelectItem>
                      <SelectItem value="line">Line</SelectItem>
                      <SelectItem value="area">Area</SelectItem>
                      <SelectItem value="pie">Pie</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Refresh">
                  <Select value={selected.settings?.refresh ?? "auto"} onValueChange={(v) => updateWidget(selected.i, { settings: { ...(selected.settings ?? {}), refresh: v } })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="1m">Every minute</SelectItem>
                      <SelectItem value="15m">Every 15 min</SelectItem>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <Separator />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => duplicateWidget(selected.i)}><Copy className="mr-1.5 h-3.5 w-3.5" />Duplicate</Button>
                  <Button variant="outline" size="sm" onClick={() => removeWidget(selected.i)} className="text-destructive"><Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove</Button>
                </div>
              </div>
            )}
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

function WidgetGroup({ title, icon: Icon, defs, onAdd, favs, onFav }: {
  title: string; icon?: any; defs: WidgetDef[];
  onAdd: (d: WidgetDef) => void; favs: string[]; onFav: (t: string) => void;
}) {
  if (!defs.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}{title}
      </div>
      <div className="space-y-1.5">
        {defs.map((w) => (
          <div key={`${title}-${w.type}`}
            className="group flex items-start gap-2 rounded-xl border bg-card p-2.5 hover:border-primary/50 hover:shadow-sm transition cursor-grab"
            onClick={() => onAdd(w)}
            draggable
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted"><w.icon className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{w.title}</p>
              <p className="truncate text-[11px] text-muted-foreground">{w.description}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onFav(w.type); }}
              className="opacity-0 transition group-hover:opacity-100"
              title={favs.includes(w.type) ? "Unfavorite" : "Favorite"}
            >
              {favs.includes(w.type) ? <Star className="h-3.5 w-3.5 fill-current text-warning" /> : <StarOff className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function EmptyCanvas({ onBrowse, onTemplate }: { onBrowse: () => void; onTemplate: (k: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
        <LayoutTemplate className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold">Build your dashboard</h3>
      <p className="mt-1 text-sm text-muted-foreground">Drag widgets from the left, or start from a template.</p>
      <div className="mt-5 flex gap-2">
        <Button variant="outline" onClick={onBrowse}><Search className="mr-1.5 h-4 w-4" />Browse widgets</Button>
        <Popover>
          <PopoverTrigger asChild><Button><LayoutTemplate className="mr-1.5 h-4 w-4" />Use template</Button></PopoverTrigger>
          <PopoverContent align="center" className="w-72 p-2">
            {TEMPLATES.map((t) => (
              <Button key={t.key} variant="ghost" size="sm" className="w-full justify-start"
                onClick={() => onTemplate(t.key)}>{t.name}<span className="ml-auto"><Badge variant="secondary" className="text-[10px]">Template</Badge></span></Button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
