// Sidebar.jsx - icons perfectly centered when collapsed
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

  const transitionStyle = "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)";

  return (
    <aside
      style={{
        width: collapsed ? "70px" : "280px",
        background: "#1e3a8a",
        display: "flex",
        flexDirection: "column",
        transition: transitionStyle,
        boxShadow: "2px 0 8px rgba(0, 0, 0, 0.1)",
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
          borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          background: "#1e3a8a",
          transition: transitionStyle,
        }}
      >
        {!collapsed && (
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "white",
              whiteSpace: "nowrap",
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
            color: "white",
            cursor: "pointer",
            padding: "8px",
            borderRadius: "6px",
            transition: transitionStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: collapsed ? "0" : "auto",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
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

      {/* User Info - conditionally rendered */}
      {!collapsed && user?.name && (
        <div
          style={{
            padding: "12px 24px", // reduced from 16px 24px
            borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
            flexShrink: 0,
            transition: transitionStyle,
          }}
        >
          <p
            style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              color: "white",
              marginBottom: 0,
              whiteSpace: "nowrap",
            }}
          >
            {user?.name}
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
            style={({ isActive }) => {
              // Base styles
              const baseStyles = {
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : "16px",
                padding: collapsed ? "12px 0" : "12px 24px",
                textDecoration: "none",
                transition: transitionStyle,
                minHeight: "48px",
                height: "48px",
                whiteSpace: "nowrap",
                background: "transparent",
                color: "rgba(255, 255, 255, 0.8)",
                borderLeft: "none",
              };

              // Active state styling
              if (isActive) {
                baseStyles.color = "white";
                if (collapsed) {
                  // Collapsed: full background highlight
                  baseStyles.background = "rgba(255, 255, 255, 0.2)";
                } else {
                  // Expanded: left border + subtle background
                  baseStyles.borderLeft = "3px solid white";
                  baseStyles.background = "rgba(255, 255, 255, 0.1)";
                }
              }

              return baseStyles;
            }}
          >
            <Icon size={20} style={{ flexShrink: 0 }} />
            {/* Only render text when not collapsed */}
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

      {/* Sidebar Footer - Logout */}
      <div
        style={{
          borderTop: "1px solid rgba(255, 255, 255, 0.2)",
          padding: "16px 0",
          flexShrink: 0,
          background: "#1e3a8a",
        }}
      >
        <button
          onClick={handleLogout}
          title={collapsed ? "Logout" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: collapsed ? 0 : "16px",
            width: "100%",
            background: "none",
            border: "none",
            padding: collapsed ? "12px 0" : "12px 24px",
            minHeight: "48px",
            height: "48px",
            color: "rgba(255, 255, 255, 0.8)",
            cursor: "pointer",
            transition: transitionStyle,
            borderRadius: 0,
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)";
          }}
        >
          <LogOut size={20} style={{ flexShrink: 0 }} />
          {!collapsed && (
            <span
              style={{
                fontWeight: 500,
                fontSize: "0.95rem",
              }}
            >
              Logout
            </span>
          )}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
