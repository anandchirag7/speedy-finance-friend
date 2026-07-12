import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  PiggyBank,
  Bell,
  Target,
  TrendingUp,
  BarChart3,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const primary = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Accounts", url: "/accounts", icon: Wallet },
  { title: "Transactions", url: "/transactions", icon: ArrowLeftRight },
];

const planning = [
  { title: "Budgets", url: "/budgets", icon: PiggyBank },
  { title: "Bills", url: "/bills", icon: Bell },
  { title: "Goals", url: "/goals", icon: Target },
];

const wealth = [
  { title: "Investments", url: "/investments", icon: TrendingUp },
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

const bottom = [{ title: "Settings", url: "/settings", icon: Settings }];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  const renderGroup = (label: string, items: typeof primary) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <Link to={item.url}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-display font-semibold">
            ₹
          </div>
          <div className="flex flex-col">
            <span className="font-display text-base font-semibold leading-none">Paisa</span>
            <span className="text-[10px] text-muted-foreground">Personal Finance</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup("Overview", primary)}
        {renderGroup("Planning", planning)}
        {renderGroup("Wealth", wealth)}
        {renderGroup("System", bottom)}
      </SidebarContent>
    </Sidebar>
  );
}
