import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { navItems } from "./navItems.js";
import { getSidebarCollapsed, setSidebarCollapsed } from "./sidebarState.js";
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const SURFACE = "#ffffff";
const BORDER = "#f0f0f0";
const ACTIVE = "#1e3a8a";
const HOVER = "#f3f4f6";
const TEXT = "#1f2937";
const MUTED = "#6b7280";

const Sidebar = ({ onToggle, onLogout }) => {
  // Lazy initialiser: restores the persisted width on the first render.
  const [collapsed, setCollapsed] = useState(getSidebarCollapsed);
  const { isSuper } = useAuth();

  // Manage Administrators is exclusive to the super administrator.
  const visibleNavItems = navItems.filter((item) => !item.superOnly || isSuper);

  const handleLogout = () => onLogout?.();

  const handleToggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    setSidebarCollapsed(next);
    if (onToggle) onToggle(next);
  };

  // Explicit properties rather than `all`. These elements also change padding,
  // gap and justifyContent on collapse, so `all` meant every nav item animated
  // its own layout alongside the container — and at a different duration.
  const transitionStyle =
    "background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)";

  // Toggle button hover (light)
  const toggleHoverIn = (e) => { e.currentTarget.style.background = HOVER; };
  const toggleHoverOut = (e) => { e.currentTarget.style.background = "none"; };

  return (
    <aside
      style={{
        width: collapsed ? "70px" : "280px",
        background: SURFACE,
        display: "flex",
        flexDirection: "column",
        /* Matches the content wrapper's margin-left in Layout.jsx — the two
           halves of one interaction previously ran at different durations. */
        transition: "width var(--dur-base) var(--ease-standard)",
        borderRight: `1px solid ${BORDER}`,
        boxShadow: "1px 0 2px rgba(0, 0, 0, 0.03)",
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
        /* ── Collapsed: logo tile on top, toggle below ── */
        <div
          style={{
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            padding: "16px 0",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              background: ACTIVE,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              // Clips the up-scaled mark below to the rounded tile.
              overflow: "hidden",
            }}
          >
            {/* The source PNG is ~43% artwork and ~57% transparent padding, so
                it is scaled up and cropped by the tile to fill the square. */}
            <img
              src="/logo_without_text_official.png"
              alt="SIGLA logo"
              style={{
                width: "48px",
                height: "48px",
                objectFit: "contain",
                transform: "scale(2.2)",
              }}
            />
          </span>
          <button
            onClick={handleToggle}
            style={{
              background: "none",
              border: "none",
              color: MUTED,
              cursor: "pointer",
              padding: "8px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: transitionStyle,
            }}
            onMouseEnter={toggleHoverIn}
            onMouseLeave={toggleHoverOut}
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={20} />
          </button>
        </div>
      ) : (
        /* ── Expanded: [logo tile] [SIGLA] on the left, toggle on the right ── */
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "12px",
              background: ACTIVE,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              // Clips the up-scaled mark below to the rounded tile.
              overflow: "hidden",
            }}
          >
            {/* The source PNG is ~43% artwork and ~57% transparent padding, so
                it is scaled up and cropped by the tile to fill the square. */}
            <img
              src="/logo_without_text_official.png"
              alt="SIGLA logo"
              style={{
                width: "52px",
                height: "52px",
                objectFit: "contain",
                transform: "scale(2.2)",
              }}
            />
          </span>
          <span
            style={{
              fontSize: "1.3rem",
              fontWeight: 700,
              color: TEXT,
              whiteSpace: "nowrap",
              flex: 1,
              letterSpacing: "0.02em",
            }}
          >
            SIGLA
          </span>
          <button
            onClick={handleToggle}
            style={{
              background: "none",
              border: "none",
              color: MUTED,
              cursor: "pointer",
              padding: "8px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: transitionStyle,
              flexShrink: 0,
            }}
            onMouseEnter={toggleHoverIn}
            onMouseLeave={toggleHoverOut}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={20} />
          </button>
        </div>
      )}


      {/* Navigation Menu */}
      <nav
        className="sidebar-nav"
        style={{
          flex: 1,
          padding: "12px 12px",
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        {visibleNavItems.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={collapsed ? label : undefined}
            /* The `active` class is what .nav-item:hover:not(.active) keys off.
               NavLink only adds it automatically when className is a string, and
               this one is a function, so it is applied explicitly here. */
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start",
              gap: collapsed ? 0 : "12px",
              padding: collapsed ? "0" : "0 12px",
              textDecoration: "none",
              height: "42px",
              borderRadius: "8px",
              whiteSpace: "nowrap",
              background: isActive ? ACTIVE : "transparent",
              color: isActive ? "#ffffff" : MUTED,
              fontWeight: isActive ? 600 : 500,
            })}
          >
            <Icon size={20} style={{ flexShrink: 0 }} />
            {!collapsed && (
              <span
                style={{
                  fontSize: "0.92rem",
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
          borderTop: `1px solid ${BORDER}`,
          padding: "12px",
          flexShrink: 0,
          background: SURFACE,
        }}
      >
        <button
          onClick={handleLogout}
          title={collapsed ? "Logout" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: collapsed ? 0 : "12px",
            width: "100%",
            background: "none",
            border: "none",
            padding: collapsed ? "0" : "0 12px",
            height: "42px",
            borderRadius: "8px",
            color: MUTED,
            cursor: "pointer",
            transition: transitionStyle,
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fef2f2";
            e.currentTarget.style.color = "#dc2626";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.color = MUTED;
          }}
        >
          <LogOut size={20} style={{ flexShrink: 0 }} />
          {!collapsed && (
            <span style={{ fontWeight: 500, fontSize: "0.92rem" }}>
              Logout
            </span>
          )}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
