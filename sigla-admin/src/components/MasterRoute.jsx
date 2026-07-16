import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

// Guards a route so only a master administrator can access it. Non-master
// admins are redirected to the dashboard; unauthenticated users to login.
const MasterRoute = ({ children }) => {
  const { isLoggedIn, isMaster, loading } = useAuth();

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

  if (!isMaster) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default MasterRoute;
