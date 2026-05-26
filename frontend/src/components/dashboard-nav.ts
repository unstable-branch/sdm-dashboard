import {
  BarChart3,
  Brain,
  Cloud,
  Database,
  Download,
  FolderKanban,
  Layers,
  LayoutDashboard,
  Leaf,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface DashboardNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const pipelineItems: DashboardNavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Data", href: "/data", icon: Database },
  { title: "Model", href: "/model", icon: Brain },
  { title: "Results", href: "/results", icon: ScrollText },
  { title: "Batch", href: "/batch", icon: Layers },
  { title: "Evaluate", href: "/evaluate", icon: BarChart3 },
  { title: "Future Projection", href: "/project", icon: Cloud },
  { title: "Ecology", href: "/ecology", icon: Leaf },
];

export const systemItems: DashboardNavItem[] = [
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Downloads", href: "/downloads", icon: Download },
  { title: "Species", href: "/species", icon: Users },
  { title: "Settings", href: "/settings", icon: Settings },
];

export const adminItems: DashboardNavItem[] = [
  { title: "Overview", href: "/admin", icon: LayoutDashboard },
  { title: "Users", href: "/admin/users", icon: Users },
  { title: "Logs", href: "/admin/logs", icon: BarChart3 },
  { title: "Database", href: "/admin/database", icon: Database },
  { title: "System", href: "/admin/system", icon: Settings },
  { title: "Diagnostics", href: "/admin/diagnostics", icon: Brain },
];

export const dashboardNavItems = [...pipelineItems, ...systemItems];
