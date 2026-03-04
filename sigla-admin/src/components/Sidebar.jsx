import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Cpu,
  Settings,
  LogOut,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Manage Users", path: "/users", icon: Users },
  { label: "Manage Words", path: "/words", icon: BookOpen },
  { label: "Manage Model", path: "/model", icon: Cpu },
  { label: "Settings", path: "/settings", icon: Settings },
];

const Sidebar = () => {
  const { user, logout, isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex flex-col w-64 min-h-screen bg-blue-900 text-white">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-blue-800">
        <h1 className="text-2xl font-bold tracking-wide">SIGLA</h1>
        <p className="text-blue-300 text-xs mt-1">Admin Panel</p>
      </div>

      {/* User info */}
      <div className="px-6 py-4 border-b border-blue-800">
        <p className="text-sm font-semibold truncate">{user?.name}</p>
        <p className="text-blue-300 text-xs capitalize mt-0.5">
          {user?.role?.replace("_", " ")}
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition
              ${
                isActive
                  ? "bg-white text-blue-900"
                  : "text-blue-100 hover:bg-blue-800"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-blue-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium text-blue-100 hover:bg-blue-800 transition"
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
