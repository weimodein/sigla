import { useState, useEffect } from "react";
import Sidebar from "./Sidebar.jsx";

const SIDEBAR_EXPANDED  = "280px";
const SIDEBAR_COLLAPSED = "70px";

const Layout = ({ children }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Keep CSS variable in sync so modals can centre themselves within the content area
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", SIDEBAR_EXPANDED);
  }, []);

  const handleToggle = (collapsed) => {
    document.body.classList.add("sidebar-transitioning");
    setSidebarCollapsed(collapsed);
    document.documentElement.style.setProperty(
      "--sidebar-width",
      collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED
    );
    setTimeout(() => {
      document.body.classList.remove("sidebar-transitioning");
    }, 250);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
      }}
    >
      <Sidebar onToggle={handleToggle} />
      <main
        style={{
          marginLeft: sidebarCollapsed ? "70px" : "280px",
          padding: "32px",
          overflow: "auto",
          background: "#f3f4f6",
          transition: "margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "margin-left",
          minHeight: "100vh",
        }}
      >
        {children}
      </main>
    </div>
  );
};

export default Layout;
