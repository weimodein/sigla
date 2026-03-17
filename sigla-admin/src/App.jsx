import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Layout from "./components/Layout.jsx";

// Pages
import Login from "./pages/auth/Login.jsx";
import Dashboard from "./pages/dashboard/Dashboard.jsx";
import ManageUsers from "./pages/users/ManageUsers.jsx";
import ManageWordBank from "./pages/words/ManageWordBank.jsx";
import ManageModel from "./pages/model/ManageModel.jsx";
import Settings from "./pages/settings/Settings.jsx";
import ReportsAnalytics from "./pages/reports/ReportsAnalytics.jsx"; // Placeholder for future implementation

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected — with sidebar layout */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <Layout>
                  <ManageUsers />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/word_bank"
            element={
              <ProtectedRoute>
                <Layout>
                  <ManageWordBank />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/model"
            element={
              <ProtectedRoute>
                <Layout>
                  <ManageModel />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout>
                  <Settings />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Layout>
                  <ReportsAnalytics />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Redirects */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
