import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Cpu,
  BarChart2,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Manage Users", path: "/users", icon: Users },
  { label: "Manage Word Bank", path: "/word_bank", icon: BookOpen },
  { label: "Manage Model", path: "/model", icon: Cpu },
  { label: "Reports", path: "/reports", icon: BarChart2 },
  { label: "Administrator Account", path: "/admin_account", icon: Settings },
];

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <aside
      className={`flex flex-col min-h-screen bg-blue-900 text-white transition-all duration-300 ease-in-out shrink-0 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Toggle + Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-blue-800">
        {!collapsed && (
          <>
            <h1 className="text-xl font-bold tracking-wide flex-1">SIGLA</h1>
            <p className="text-blue-300 text-xs -mt-2">Admin Panel</p>
          </>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-1.5 rounded-md hover:bg-blue-800 transition shrink-0"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
      </div>

      {/* User info */}
      {!collapsed && (
        <div className="px-4 py-3 border-b border-blue-800">
          <p className="text-sm font-semibold truncate">{user?.name}</p>
          <p className="text-blue-300 text-xs capitalize mt-0.5">
            {user?.role?.replace("_", " ")}
          </p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg text-sm font-medium transition px-3 py-2.5 ${
                collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "bg-white text-blue-900"
                  : "text-blue-100 hover:bg-blue-800"
              }`
            }
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t border-blue-800">
        <button
          onClick={handleLogout}
          title={collapsed ? "Logout" : undefined}
          className={`flex items-center gap-3 w-full rounded-lg text-sm font-medium text-blue-100 hover:bg-blue-800 transition ${
            collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
          }`}
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
