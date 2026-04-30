import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import {
  LayoutDashboard,
  Users,
  Database,
  Tag,
  Cpu,
  BarChart2,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Manage Users", path: "/users", icon: Users },
  { label: "Manage Dataset", path: "/dataset", icon: Database },
  { label: "Manage Categories", path: "/categories", icon: Tag },
  { label: "Manage Model", path: "/model", icon: Cpu },
  { label: "Reports", path: "/reports", icon: BarChart2 },
  { label: "Administrator Account", path: "/admin_account", icon: Settings },
];

const Sidebar = ({ onToggle }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => setShowLogoutModal(true);

  const confirmLogout = () => {
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
    <>
    <aside
      style={{
        width: collapsed ? "70px" : "280px",
        background: "#1e3a8a",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: "2px 0 8px rgba(0, 0, 0, 0.1)",
        zIndex: 1000,
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        overflow: "hidden",
        willChange: "width",
        transform: "translateZ(0)",
      }}
    >
      {/* Sidebar Header */}
      {collapsed ? (
        /* ── Collapsed: logo on top, toggle below ── */
        <div
          style={{
            borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            padding: "16px 0",
            flexShrink: 0,
          }}
        >
          <img
            src="/logo_without_text_official.png"
            alt="SIGLA logo"
            style={{ width: "72px", height: "72px", objectFit: "contain" }}
          />
          <button
            onClick={handleToggle}
            style={{
              background: "none",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "8px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: transitionStyle,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
            }}
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={20} />
          </button>
        </div>
      ) : (
        /* ── Expanded: [logo] [SIGLA] on the left, toggle on the right ── */
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <img
            src="/logo_without_text_official.png"
            alt="SIGLA logo"
            style={{
              width: "72px",
              height: "72px",
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "white",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            SIGLA
          </span>
          <button
            onClick={handleToggle}
            style={{
              background: "none",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "8px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: transitionStyle,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
            }}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={20} />
          </button>
        </div>
      )}

      {/* User Info - conditionally rendered */}
      {!collapsed && user?.name && (
        <div
          style={{
            padding: "12px 24px",
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
            style={({ isActive }) => ({
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
              background: isActive
                ? collapsed
                  ? "rgba(255, 255, 255, 0.2)"
                  : "rgba(255, 255, 255, 0.1)"
                : "transparent",
              color: isActive ? "white" : "rgba(255, 255, 255, 0.8)",
              borderLeft: isActive && !collapsed ? "3px solid white" : "none",
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

    {/* Logout confirmation modal */}
    {showLogoutModal && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          background: "rgba(0,0,0,0.4)",
        }}
        onClick={() => setShowLogoutModal(false)}
      >
        <div
          style={{
            background: "white",
            borderRadius: "16px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            width: "100%",
            maxWidth: "380px",
            padding: "24px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>
              Sign Out
            </h3>
            <button
              onClick={() => setShowLogoutModal(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: "4px", borderRadius: "6px", display: "flex" }}
            >
              <X size={18} />
            </button>
          </div>
          <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "24px" }}>
            Are you sure you want to sign out? Any unsaved changes will be lost.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowLogoutModal(false)}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                background: "white",
                color: "#374151",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              onClick={confirmLogout}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                border: "none",
                background: "#1e3a8a",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Sidebar;
