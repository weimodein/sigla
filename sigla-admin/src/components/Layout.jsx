import { useState } from "react";
import Sidebar from "./Sidebar.jsx";

const Layout = ({ children }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleToggle = (collapsed) => {
    // Add class to body before transition starts
    document.body.classList.add("sidebar-transitioning");
    setSidebarCollapsed(collapsed);
    // Remove class after transition ends (250ms)
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
          transform: "translateZ(0)",
          minHeight: "100vh",
        }}
      >
        {children}
      </main>
    </div>
  );
};

export default Layout;
