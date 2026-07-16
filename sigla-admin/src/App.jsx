import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Layout from "./components/Layout.jsx";

// Pages
import Login from "./pages/auth/Login.jsx";
import ForgotPassword from "./pages/auth/ForgotPassword.jsx";
import Dashboard from "./pages/dashboard/Dashboard.jsx";
import ManageAdministrators from "./pages/administrators/ManageAdministrators.jsx";
import ManageWordBank from "./pages/words/ManageWordBank.jsx";
import ManageDataset from "./pages/words/ManageDataset.jsx";
import ManageCategories from "./pages/categories/ManageCategories.jsx";
import ManageModel from "./pages/model/ManageModel.jsx";
import AdministratorAccount from "./pages/adminaccount/AdministratorAccount.jsx";
import ReportsAnalytics from "./pages/reports/ReportsAnalytics.jsx";
import ActivityLogs from "./pages/activitylogs/ActivityLogs.jsx";

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />

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
              path="/administrators"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ManageAdministrators />
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
              path="/dataset"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ManageDataset />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/categories"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ManageCategories />
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
              path="/admin_account"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AdministratorAccount />
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
            <Route
              path="/activity-logs"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ActivityLogs />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Redirects */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
