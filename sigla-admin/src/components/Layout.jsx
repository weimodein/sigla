import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Sidebar from "./Sidebar.jsx";
import Button from "./Button.jsx";
import { useModalKeys } from "./useModalKeys.js";
import { setAuthMessage } from "../utils/authMessage.js";
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

  // Exit animation state. The panel has to stay mounted while it animates out,
  // so closing sets `closingModal` and the real unmount waits for animationend —
  // the same deferral AppModal uses.
  const [closingModal, setClosingModal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Guards the whole close/confirm sequence. Without it, holding Enter fires
  // confirmLogout repeatedly while the exit animation plays.
  const closingRef = useRef(false);
  const logoutTimerRef = useRef(null);

  useEffect(() => () => {
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
  }, []);

  const dismissLogoutModal = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosingModal(true);
  };

  // Runs when the exit animation ends — the point where the panel really goes.
  const finishClose = () => {
    setShowLogoutModal(false);
    setClosingModal(false);
    closingRef.current = false;
  };

  const confirmLogout = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setSigningOut(true);
    // Let the dialog leave, hold briefly on "Signing out…", then go. The message
    // is parked for the login page, which is what actually mounts next.
    logoutTimerRef.current = setTimeout(() => {
      setAuthMessage("info", "You've been signed out.");
      logout();
      navigate("/login");
    }, 620);
  };

  // This overlay is hand-rolled rather than an AppModal, so it needs the keyboard
  // contract wired explicitly. `enabled` gates on the open state since the hook
  // has to be called unconditionally.
  useModalKeys({
    onEscape: dismissLogoutModal,
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
          className={closingModal || signingOut ? "modal-backdrop-out" : "modal-backdrop-in"}
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
          onClick={dismissLogoutModal}
        >
          <div
            className={closingModal || signingOut ? "modal-panel-out" : "modal-panel-in"}
            style={{
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
              width: "100%",
              maxWidth: "380px",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
            onAnimationEnd={(e) => {
              // Only a dismissal unmounts here. When signing out the panel stays
              // put until navigation, so the backdrop does not flash away and
              // reveal the dashboard mid-sign-out.
              if (closingModal && e.animationName === "modal-panel-out") finishClose();
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>
                Sign Out
              </h3>
              <button
                onClick={dismissLogoutModal}
                disabled={signingOut}
                style={{ background: "none", border: "none", cursor: signingOut ? "default" : "pointer", color: "#9ca3af", padding: "4px", borderRadius: "6px", display: "flex" }}
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "24px" }}>
              Are you sure you want to sign out? Any unsaved changes will be lost.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={dismissLogoutModal} disabled={signingOut}>
                Cancel
              </Button>
              <Button onClick={confirmLogout} loading={signingOut}>
                {signingOut ? "Signing out…" : "Sign Out"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
