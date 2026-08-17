import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Sidebar from "./Sidebar.jsx";
import Button from "./Button.jsx";
import { useModalKeys } from "./useModalKeys.js";
import { getSidebarCollapsed } from "./sidebarState.js";
import { X } from "lucide-react";

const SIDEBAR_EXPANDED  = "280px";
const SIDEBAR_COLLAPSED = "70px";

const Layout = ({ children }) => {
  // Mirrors the Sidebar's persisted state so the content margin matches the
  // sidebar width on first paint (see components/sidebarState.js).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getSidebarCollapsed);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Keep CSS variable in sync so modals can centre themselves within the content
  // area — seeded from the restored state, not hardcoded to expanded.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
    );
  }, [sidebarCollapsed]);

  // Tracked so rapid toggling cannot stack timeouts — an earlier one would
  // otherwise strip the transitioning class while a later transition is still
  // running — and so an unmount mid-transition does not leave the class behind.
  const transitionTimerRef = useRef(null);

  useEffect(() => () => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
  }, []);

  const handleToggle = (collapsed) => {
    document.body.classList.add("sidebar-transitioning");
    // --sidebar-width is updated by the effect above, which reacts to this state.
    setSidebarCollapsed(collapsed);
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => {
      document.body.classList.remove("sidebar-transitioning");
      transitionTimerRef.current = null;
    }, 250);
  };

  const confirmLogout = () => {
    logout();
    navigate("/login");
  };

  // This overlay is hand-rolled rather than an AppModal, so it needs the keyboard
  // contract wired explicitly. `enabled` gates on the open state since the hook
  // has to be called unconditionally.
  useModalKeys({
    onEscape: () => setShowLogoutModal(false),
    onEnter: confirmLogout,
    enabled: () => showLogoutModal,
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--app-bg)" }}>
      <Sidebar onToggle={handleToggle} onLogout={() => setShowLogoutModal(true)} />
      <div
        style={{
          marginLeft: sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
          transition: "margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "margin-left",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <main
          style={{
            flex: 1,
            padding: "32px",
            overflow: "auto",
            background: "var(--app-bg)",
          }}
        >
          {children}
        </main>
      </div>

      {/* Logout confirmation — triggered from the sidebar */}
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
              <Button variant="secondary" onClick={() => setShowLogoutModal(false)}>
                Cancel
              </Button>
              <Button onClick={confirmLogout}>Sign Out</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
