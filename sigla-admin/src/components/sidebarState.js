// Persisted sidebar collapse preference.
//
// The collapsed flag cannot live in component state alone: Manage Administrators
// is guarded by SuperRoute while every other route uses ProtectedRoute, so
// navigating to it swaps the element type at that tree position and React
// remounts Layout -> Sidebar, resetting any local useState. Local state is also
// lost on a page refresh. Persisting here keeps the sidebar as the user left it.

const KEY = "sidebarCollapsed";

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
