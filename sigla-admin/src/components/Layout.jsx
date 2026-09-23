import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Sidebar from "./Sidebar.jsx";
import Button from "./Button.jsx";
import { useModalKeys } from "./useModalKeys.js";
import { setAuthMessage } from "../utils/authMessage.js";
import {
  getSidebarCollapsed,
  SIDEBAR_EXPANDED,
  SIDEBAR_COLLAPSED,
} from "./sidebarState.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { X, Menu } from "lucide-react";

const Layout = ({ children }) => {
  // Mirrors the Sidebar's persisted state so the content margin matches the
  // sidebar width on first paint (see components/sidebarState.js).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getSidebarCollapsed);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isMobile = useIsMobile();

  // Drawer state lives HERE, not in Sidebar. Manage Administrators is guarded by
  // SuperRoute while every other route uses ProtectedRoute, so navigating there
  // swaps the element type and remounts Layout -> Sidebar. State held inside
  // Sidebar would be lost; see the note at the top of sidebarState.js.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The drawer force-closes on two events, both handled during render rather
  // than in an effect (the pattern React recommends for resetting state when
  // something changes — an effect would paint the stale open drawer for a frame
  // first, then close it):
  //
  //   1. Navigation. Otherwise tapping a nav link leaves the drawer covering
  //      the page it just opened.
  //   2. Crossing up past the breakpoint. Otherwise `drawerOpen` stays true
  //      behind the desktop rail, and returning to mobile shows it already open
  //      with no backdrop.
  const [drawerKey, setDrawerKey] = useState(
    () => `${location.pathname}|${isMobile}`,
  );
  const currentKey = `${location.pathname}|${isMobile}`;
  if (drawerKey !== currentKey) {
    setDrawerKey(currentKey);
    if (drawerOpen) setDrawerOpen(false);
  }

  // Escape closes the drawer, matching the modal contract elsewhere in the app.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // The page behind an open drawer must not scroll under the finger.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [drawerOpen]);

  // Keep CSS variable in sync so modals can centre themselves within the content
  // area — seeded from the restored state, not hardcoded to expanded. On mobile
  // the sidebar is off-canvas and occupies no layout space, so it reads 0px.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      isMobile ? "0px" : sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
    );
  }, [sidebarCollapsed, isMobile]);

  // This used to also toggle a `sidebar-transitioning` class on <body> for 250ms,
  // with a timer and cleanup effect to manage it. No CSS rule anywhere in the app
  // ever matched that class, so the whole mechanism was removed.
  const handleToggle = (collapsed) => {
    // --sidebar-width is updated by the effect above, which reacts to this state.
    setSidebarCollapsed(collapsed);
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
      <Sidebar
        onToggle={handleToggle}
        onLogout={() => setShowLogoutModal(true)}
        isMobile={isMobile}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />

      {/* Drawer backdrop — mobile only, and only while open. Sits below the
          sidebar (1050) and above page content. */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(2px)",
            zIndex: 1040,
          }}
        />
      )}

      <div
        style={{
          /* The line that reclaims the screen: on mobile the sidebar is
             off-canvas, so the content must not be pushed over at all. */
          marginLeft: isMobile
            ? 0
            : sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
          transition: "margin-left var(--dur-base) var(--ease-standard)",
          willChange: "margin-left",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          /* Without this a wide child (a table at its min-width) can stretch the
             flex item and scroll the whole page sideways instead of scrolling
             inside its own wrapper. */
          minWidth: 0,
        }}
      >
        {/* Mobile header — the app has no topbar, so the hamburger needs a home.
            Pages render their own <h2>, so this carries no title. */}
        {isMobile && (
          <header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 900,
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "10px 16px",
              background: "#ffffff",
              borderBottom: "1px solid #f0f0f0",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              style={{
                background: "none",
                border: "none",
                color: "#1f2937",
                cursor: "pointer",
                padding: "8px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Menu size={22} />
            </button>
            <span
              style={{
                fontSize: "1.05rem",
                fontWeight: 700,
                color: "#1f2937",
                letterSpacing: "0.02em",
              }}
            >
              SIGLA
            </span>
          </header>
        )}

        <main
          className="app-main"
          style={{
            flex: 1,
            overflow: "auto",
            background: "var(--app-bg)",
            minWidth: 0,
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
            // Without this the dialog clips with no way to reach it on a short
            // screen (a landscape phone), since the panel is centred, not top-aligned.
            overflowY: "auto",
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
              <h3 className="section-title" style={{ color: "#1f2937", margin: 0 }}>
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
            <p className="text-sm" style={{ color: "#6b7280", marginBottom: "24px" }}>
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
