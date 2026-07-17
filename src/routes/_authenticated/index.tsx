import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import RGL, { useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { LayoutTemplate, Wallet, Settings2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { getDashboard } from "@/lib/finance.functions";
import { listDashboards, createDashboard } from "@/lib/dashboards.functions";
import { WIDGET_BY_TYPE } from "@/lib/dashboard-widgets";
import { TEMPLATES } from "@/lib/dashboard-templates";
import { DashboardBuilderDialog } from "@/components/dashboard-builder";

const GridLayout: any = (RGL as any).GridLayout ?? (RGL as any).default ?? RGL;



export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Paisa" }] }),
  component: Dashboard,
});

function Dashboard() {
  const dataFn = useServerFn(getDashboard);
  const listFn = useServerFn(listDashboards);
  const createFn = useServerFn(createDashboard);

  const [range, setRange] = useState<"1m" | "3m" | "6m" | "1y" | "ytd">("1m");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["dashboard", range],
    queryFn: () => dataFn({ data: { range } }),
  });
  const { data: dashboards = [], refetch } = useQuery({
    queryKey: ["dashboards"],
    queryFn: () => listFn(),
  });

  const current = useMemo(
    () => dashboards.find((d) => d.id === activeId) ?? dashboards.find((d) => d.is_default) ?? dashboards[0],
    [dashboards, activeId]
  );

  // seed a default dashboard on first visit
  useEffect(() => {
    if (dashboards.length === 0) return;
  }, [dashboards.length]);
  useEffect(() => {
    if (dashboards.length === 0) {
      const t = TEMPLATES[0];
      createFn({ data: { name: t.name, template_key: t.key, layout: t.layout } }).then(() => refetch());
    }
  }, [dashboards.length]);




  if (isLoading && !metrics) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const d = metrics as any;
  const empty = !d || d.accountsCount === 0;
  if (empty) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent">
          <Wallet className="h-7 w-7" />
        </div>
        <h2 className="font-display text-2xl font-semibold">Let's set up your money picture</h2>
        <p className="mt-2 text-muted-foreground">
          Add your bank accounts, investments, and loans. Paisa will tie it all into one net-worth view.
        </p>
        <Button asChild className="mt-6" size="lg"><Link to="/accounts">Add your first account</Link></Button>
      </div>
    );
  }

  const layout = current?.layout ?? [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">{current?.name ?? "Dashboard"}</h1>
          <p className="text-xs text-muted-foreground">Personalize your view with the builder.</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single" size="sm" value={range}
            onValueChange={(v) => v && setRange(v as typeof range)}
            className="rounded-lg border bg-card p-0.5"
          >
            <ToggleGroupItem value="1m" className="h-7 px-2.5 text-xs">1M</ToggleGroupItem>
            <ToggleGroupItem value="3m" className="h-7 px-2.5 text-xs">3M</ToggleGroupItem>
            <ToggleGroupItem value="6m" className="h-7 px-2.5 text-xs">6M</ToggleGroupItem>
            <ToggleGroupItem value="1y" className="h-7 px-2.5 text-xs">1Y</ToggleGroupItem>
            <ToggleGroupItem value="ytd" className="h-7 px-2.5 text-xs">YTD</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="sm" onClick={() => setBuilderOpen(true)}>
            <Settings2 className="mr-1.5 h-4 w-4" />Customize
          </Button>
          <Button size="sm" onClick={() => setBuilderOpen(true)}>
            <LayoutTemplate className="mr-1.5 h-4 w-4" />Dashboards
          </Button>
        </div>
      </div>

      {layout.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed p-14 text-center">
          <div>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10">
              <LayoutTemplate className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-medium">Your dashboard is empty</h3>
            <p className="mt-1 text-sm text-muted-foreground">Add widgets to bring it to life.</p>
            <Button className="mt-4" onClick={() => setBuilderOpen(true)}>Open builder</Button>
          </div>
        </div>
      ) : (
        <div>
          <GridLayout
            cols={12}
            rowHeight={48}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            isDraggable={false}
            isResizable={false}
            layout={layout.map((l: any) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h, static: true }))}
          >
            {layout.map((item: any) => {
              const def = WIDGET_BY_TYPE[item.type];
              return (
                <div key={item.i} className="overflow-hidden">
                  {def ? def.render({ data: metrics, settings: item.settings }) : (
                    <div className="grid h-full place-items-center text-sm text-muted-foreground">Unknown: {item.type}</div>
                  )}
                </div>
              );
            })}
          </GridLayout>
        </div>


      )}

      <DashboardBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        dashboardId={current?.id ?? null}
        onDashboardIdChange={setActiveId}
      />
    </div>
  );
}
