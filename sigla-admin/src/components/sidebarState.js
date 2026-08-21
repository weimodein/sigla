// Persisted sidebar collapse preference.
//
// The collapsed flag cannot live in component state alone: Manage Administrators
// is guarded by SuperRoute while every other route uses ProtectedRoute, so
// navigating to it swaps the element type at that tree position and React
// remounts Layout -> Sidebar, resetting any local useState. Local state is also
// lost on a page refresh. Persisting here keeps the sidebar as the user left it.

const KEY = "sidebarCollapsed";

// Shared so Sidebar's width and Layout's content margin cannot drift apart —
// they were previously separate hardcoded literals in the two files, kept in
// sync by hand. Below `lg` the sidebar is an off-canvas drawer and the content
// margin is 0, so only the drawer uses EXPANDED there.
export const SIDEBAR_EXPANDED = "280px";
export const SIDEBAR_COLLAPSED = "70px";

// Read synchronously so it can seed a lazy useState initialiser — the correct
// width is then present on first paint, with no expand-then-collapse flash.
export const getSidebarCollapsed = () => {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    // Private mode / storage disabled — fall back to expanded.
    return false;
  }
};

export const setSidebarCollapsed = (collapsed) => {
  try {
    localStorage.setItem(KEY, String(collapsed));
  } catch {
    // Non-blocking: the toggle still works for this session.
  }
};
