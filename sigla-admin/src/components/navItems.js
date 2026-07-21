import {
  LayoutDashboard,
  Users,
  Database,
  Tag,
  Cpu,
  BarChart2,
  ScrollText,
  Settings,
} from "lucide-react";

// Single source of truth for the admin navigation. Consumed by the Sidebar
// to render nav links.
export const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Manage Administrators", path: "/administrators", icon: Users, superOnly: true },
  { label: "Manage Words", path: "/dataset", icon: Database },
  { label: "Manage Categories", path: "/categories", icon: Tag },
  { label: "Manage Model", path: "/model", icon: Cpu },
  { label: "Activity Logs", path: "/activity-logs", icon: ScrollText },
  { label: "Reports", path: "/reports", icon: BarChart2 },
  { label: "Administrator Account", path: "/admin_account", icon: Settings },
];
