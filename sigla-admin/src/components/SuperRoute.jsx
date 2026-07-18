import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

// Guards a route so only a super administrator can access it. Non-super
// admins are redirected to the dashboard; unauthenticated users to login.
const SuperRoute = ({ children }) => {
  const { isLoggedIn, isSuper, needsSetup, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-900" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // New admins must finish first-login setup before accessing the platform.
  if (needsSetup) {
    return <Navigate to="/onboarding" replace />;
  }

  if (!isSuper) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default SuperRoute;
