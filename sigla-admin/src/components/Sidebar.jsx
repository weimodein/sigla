import { createElement, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { navItems } from "./navItems.js";
import {
  getSidebarCollapsed,
  setSidebarCollapsed,
  SIDEBAR_EXPANDED,
  SIDEBAR_COLLAPSED,
} from "./sidebarState.js";
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

const SURFACE = "#ffffff";
const BORDER = "#f0f0f0";
const ACTIVE = "#1e3a8a";
const HOVER = "#f3f4f6";
const TEXT = "#1f2937";
const MUTED = "#6b7280";

const Sidebar = ({ onToggle, onLogout, isMobile = false, drawerOpen = false, onCloseDrawer }) => {
  // Lazy initialiser: restores the persisted width on the first render.
  const [collapsed, setCollapsed] = useState(getSidebarCollapsed);
  const { isSuper } = useAuth();

  // On mobile the rail-collapse idea does not apply: the drawer is either
  // off-canvas or fully open at full width. Rendering it collapsed there would
  // give a 70px drawer of unlabelled icons. The persisted desktop preference is
  // untouched — it is simply ignored while mobile.
  const isCollapsed = isMobile ? false : collapsed;

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
      /* Hidden from assistive tech (and from tab order, via inert) while the
         drawer is closed — an off-canvas element is still focusable otherwise,
         so keyboard users would tab into an invisible nav. */
      aria-hidden={isMobile && !drawerOpen ? "true" : undefined}
      inert={isMobile && !drawerOpen}
      style={{
        width: isCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
        background: SURFACE,
        display: "flex",
        flexDirection: "column",
        /* Mobile animates transform (composited, cheap); desktop animates width
           and matches the content wrapper's margin-left transition in Layout.jsx
           — the two halves of one interaction previously ran at different
           durations. Animating width on the drawer would reflow every frame. */
        transition: isMobile
          ? "transform var(--dur-base) var(--ease-standard)"
          : "width var(--dur-base) var(--ease-standard)",
        borderRight: `1px solid ${BORDER}`,
        boxShadow: isMobile && drawerOpen
          ? "0 0 40px rgba(0, 0, 0, 0.18)"
          : "1px 0 2px rgba(0, 0, 0, 0.03)",
        /* Above the drawer backdrop (1040) so the panel sits on top of it. */
        zIndex: 1050,
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        overflow: "hidden",
        willChange: isMobile ? "transform" : "width",
        transform: isMobile && !drawerOpen
          ? "translateX(-100%)"
          : "translateX(0)",
      }}
    >
      {/* Sidebar Header */}
      {isCollapsed ? (
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
              fontSize: "1.5rem",
              fontWeight: 700,
              color: TEXT,
              whiteSpace: "nowrap",
              flex: 1,
              letterSpacing: "0.02em",
            }}
          >
            SIGLA
          </span>
          {/* Mobile closes the drawer; desktop collapses to the icon rail. */}
          <button
            onClick={isMobile ? onCloseDrawer : handleToggle}
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
            aria-label={isMobile ? "Close menu" : "Collapse sidebar"}
          >
            {isMobile ? <X size={20} /> : <PanelLeftClose size={20} />}
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
        {visibleNavItems.map(({ label, path, icon }) => (
          <NavLink
            key={path}
            to={path}
            title={isCollapsed ? label : undefined}
            /* The `active` class is what .nav-item:hover:not(.active) keys off.
               NavLink only adds it automatically when className is a string, and
               this one is a function, so it is applied explicitly here. */
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              justifyContent: isCollapsed ? "center" : "flex-start",
              gap: isCollapsed ? 0 : "12px",
              padding: isCollapsed ? "0" : "0 12px",
              textDecoration: "none",
              height: "42px",
              borderRadius: "8px",
              whiteSpace: "nowrap",
              background: isActive ? ACTIVE : "transparent",
              color: isActive ? "#ffffff" : MUTED,
              fontWeight: isActive ? 600 : 500,
            })}
          >
            {createElement(icon, { size: 20, style: { flexShrink: 0 } })}
            {!isCollapsed && (
              <span
                style={{
                  fontSize: "var(--type-body)",
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
          title={isCollapsed ? "Logout" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: isCollapsed ? "center" : "flex-start",
            gap: isCollapsed ? 0 : "12px",
            width: "100%",
            background: "none",
            border: "none",
            padding: isCollapsed ? "0" : "0 12px",
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
          {!isCollapsed && (
            <span style={{ fontWeight: 500, fontSize: "var(--type-body)" }}>
              Logout
            </span>
          )}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
