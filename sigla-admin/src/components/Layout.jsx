// Layout.jsx
import { useState } from "react";
import Sidebar from "./Sidebar.jsx";

const Layout = ({ children }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#f3f4f6", // background color from palette
      }}
    >
      <Sidebar onToggle={(collapsed) => setSidebarCollapsed(collapsed)} />
      <main
        style={{
          flex: 1,
          marginLeft: sidebarCollapsed ? "70px" : "280px",
          padding: "32px",
          overflow: "auto",
          transition: "margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {children}
      </main>
    </div>
  );
};

export default Layout;
