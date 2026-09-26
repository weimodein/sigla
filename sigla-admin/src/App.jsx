import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { UploadJobsProvider } from "./context/UploadJobsContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import SuperRoute from "./components/SuperRoute.jsx";
import Layout from "./components/Layout.jsx";

// Pages
import Login from "./pages/auth/Login.jsx";
import ForgotPassword from "./pages/auth/ForgotPassword.jsx";
import Dashboard from "./pages/dashboard/Dashboard.jsx";
import ManageAdministrators from "./pages/administrators/ManageAdministrators.jsx";
// ManageWordBank is intentionally not imported — /word_bank now redirects to
// /dataset. The file is kept on disk for reference until its sample-gallery
// logic is confirmed unnecessary, but importing it would bundle 1400 unused
// lines and keep the divergent upload rules alive.
import ManageWord from "./pages/words/ManageWord.jsx";
import ManageCategories from "./pages/categories/ManageCategories.jsx";
import ManageModel from "./pages/model/ManageModel.jsx";
import AdministratorAccount from "./pages/adminaccount/AdministratorAccount.jsx";
import ReportsAnalytics from "./pages/reports/ReportsAnalytics.jsx";
import ActivityLogs from "./pages/activitylogs/ActivityLogs.jsx";
import Onboarding from "./pages/onboarding/Onboarding.jsx";

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <UploadJobsProvider>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />

              {/* Forced first-login onboarding (self-guards on auth + needsSetup) */}
              <Route path="/onboarding" element={<Onboarding />} />

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
                  <SuperRoute>
                    <Layout>
                      <ManageAdministrators />
                    </Layout>
                  </SuperRoute>
                }
              />
              {/* Superseded by /dataset (ManageWord), which is what the sidebar
                  links to and which uses the current video + MediaPipe upload
                  flow. ManageWordBank was built around per-image sample review and
                  manual approval; admin uploads are auto-approved now, so there is
                  nothing left for it to review. Kept as a redirect so existing
                  bookmarks and any stale link still land somewhere useful. */}
              <Route path="/word_bank" element={<Navigate to="/dataset" replace />} />
              <Route
                path="/dataset"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <ManageWord />
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
          </UploadJobsProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
