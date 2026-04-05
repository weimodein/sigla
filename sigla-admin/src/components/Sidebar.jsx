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

const Sidebar = ({ onToggle }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleToggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (onToggle) onToggle(next);
  };

  return (
    <aside
      style={{
        width: collapsed ? "70px" : "280px",
        background: "white",
        borderRight: "1px solid #e5e7eb",
        display: "flex",
        flexDirection: "column",
        transition: "all 0.3s ease",
        boxShadow: "0 4px 6px rgba(0,0,0,0.07)",
        zIndex: 1000,
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        overflow: "hidden",
      }}
    >
      {/* Sidebar Header */}
      <div
        style={{
          padding: "24px",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          background: "white",
        }}
      >
        {!collapsed && (
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "#1e3a8a",
            }}
          >
            SIGLA
          </span>
        )}
        <button
          onClick={handleToggle}
          style={{
            background: "none",
            border: "none",
            fontSize: "1.25rem",
            color: "#6b7280",
            cursor: "pointer",
            padding: "8px",
            borderRadius: "6px",
            transition: "all 0.2s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f0f0f0";
            e.currentTarget.style.color = "#1e3a8a";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.color = "#6b7280";
          }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen size={20} />
          ) : (
            <PanelLeftClose size={20} />
          )}
        </button>
      </div>

      {/* User Info */}
      {!collapsed && (
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid #f0f0f0",
            flexShrink: 0,
          }}
        >
          <p
            style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              color: "#1f2937",
              marginBottom: "4px",
            }}
          >
            {user?.name}
          </p>
          <p
            style={{
              fontSize: "0.8rem",
              color: "#6b7280",
              textTransform: "capitalize",
            }}
          >
            {user?.role?.replace("_", " ")}
          </p>
        </div>
      )}

      {/* Navigation Menu */}
      <nav
        style={{
          flex: 1,
          padding: "16px 0",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {navItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={collapsed ? label : undefined}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: collapsed ? 0 : "16px",
              padding: collapsed ? "12px 0" : "12px 24px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderLeft: isActive ? "3px solid #1e3a8a" : "3px solid transparent",
              textDecoration: "none",
              transition: "all 0.2s ease",
              minHeight: "48px",
              height: "48px",
              whiteSpace: "nowrap",
              background: isActive ? "#1e3a8a22" : "transparent",
              color: isActive ? "#1e3a8a" : "#6b7280",
            })}
          >
            <Icon size={20} style={{ flexShrink: 0 }} />
            {!collapsed && (
              <span
                style={{
                  fontWeight: 500,
                  fontSize: "0.95rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Sidebar Footer */}
      <div
        style={{
          borderTop: "1px solid #f0f0f0",
          padding: "16px 0",
          flexShrink: 0,
          background: "white",
        }}
      >
        <button
          onClick={handleLogout}
          title={collapsed ? "Logout" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: collapsed ? 0 : "16px",
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            background: "none",
            border: "none",
            padding: collapsed ? "12px 0" : "12px 24px",
            minHeight: "48px",
            height: "48px",
            color: "#6b7280",
            cursor: "pointer",
            transition: "all 0.2s ease",
            borderRadius: 0,
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f0f0f0";
            e.currentTarget.style.color = "#1e3a8a";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.color = "#6b7280";
          }}
        >
          <LogOut size={20} style={{ flexShrink: 0 }} />
          {!collapsed && <span style={{ fontWeight: 500, fontSize: "0.95rem" }}>Logout</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
