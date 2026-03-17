import { useState, useEffect } from "react";
import {
  getAllUsers,
  getPendingUsers,
  getDeactivatedUsers,
  getUserStats,
  approveUser,
  warnUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  updateUser,
} from "../../api/userApi.js";
import {
  Users,
  ClipboardList,
  UserX,
  AlertTriangle,
  Search,
  X,
} from "lucide-react";

// ── Stat Card ─────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

// ── Status Badge ──────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const styles = {
    active: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    deactivated: "bg-red-100 text-red-700",
    deleted: "bg-gray-100 text-gray-500",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || "bg-gray-100 text-gray-600"}`}
    >
      {status}
    </span>
  );
};

// ── Warning Badge ─────────────────────────────────────────────
const WarningBadge = ({ count }) => {
  if (!count || count === 0) return null;
  const color =
    count >= 2 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700";
  return (
    <span
      className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}
    >
      ⚠ {count}/2
    </span>
  );
};

// ── Modal ─────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────
const ManageUsers = () => {
  const [activeTab, setActiveTab] = useState("all");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Modal state
  const [editModal, setEditModal] = useState(null);
  const [warnModal, setWarnModal] = useState(null); // user object
  const [warnReason, setWarnReason] = useState("");

  // Edit form
  const [editForm, setEditForm] = useState({
    name: "",
    username: "",
    email: "",
    age: "",
    gender: "",
  });

  // ── Fetch data ──────────────────────────────────────────────
  const fetchStats = async () => {
    try {
      const data = await getUserStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats");
    }
  };

  const fetchTabData = async () => {
    setLoading(true);
    setError("");
    try {
      if (activeTab === "all") {
        const data = await getAllUsers({ search });
        setUsers(data.users);
      } else if (activeTab === "pending") {
        const data = await getPendingUsers();
        setUsers(data.users);
      } else if (activeTab === "deactivated") {
        const data = await getDeactivatedUsers();
        setUsers(data.users);
      }
    } catch (err) {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);
  useEffect(() => {
    fetchTabData();
  }, [activeTab, search]);

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 3000);
  };

  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(""), 4000);
  };

  // ── Actions ─────────────────────────────────────────────────
  const handleApprove = async (id) => {
    setActionLoading(true);
    try {
      await approveUser(id);
      showSuccess("User approved successfully");
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to approve user");
    } finally {
      setActionLoading(false);
    }
  };

  const handleWarnOpen = (user) => {
    setWarnReason("");
    setWarnModal(user);
  };

  const handleWarnSubmit = async () => {
    setActionLoading(true);
    try {
      const res = await warnUser(warnModal.id, { reason: warnReason });
      showSuccess(
        `Warning issued. User now has ${res.warning_count}/2 warnings.`,
      );
      setWarnModal(null);
      setWarnReason("");
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to issue warning");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivate = async (id, warningCount) => {
    // Enforce 2-warning requirement on the frontend as well
    if ((warningCount || 0) < 2) {
      showError(
        `User must have 2 warnings before being deactivated. Current: ${warningCount || 0}/2`,
      );
      return;
    }
    if (
      !window.confirm(
        "Deactivate this user? Their account will auto-reactivate after 30 days.",
      )
    )
      return;
    setActionLoading(true);
    try {
      await deactivateUser(id);
      showSuccess(
        "User deactivated. Account will auto-reactivate after 30 days.",
      );
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to deactivate user");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async (id) => {
    setActionLoading(true);
    try {
      await reactivateUser(id);
      showSuccess("User reactivated successfully. Warning count reset to 0.");
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reactivate user");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Permanently delete this user? This cannot be undone."))
      return;
    setActionLoading(true);
    try {
      await deleteUser(id);
      showSuccess("User permanently deleted");
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to delete user");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditOpen = (user) => {
    setEditForm({
      name: user.name || "",
      username: user.username || "",
      email: user.email || "",
      age: user.age || "",
      gender: user.gender || "",
    });
    setEditModal(user);
  };

  const handleEditSave = async () => {
    setActionLoading(true);
    try {
      await updateUser(editModal.id, editForm);
      showSuccess("User updated successfully");
      setEditModal(null);
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to update user");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Tabs ─────────────────────────────────────────────────────
  const tabs = [
    { key: "all", label: "All Users" },
    { key: "pending", label: "Pending" },
    { key: "deactivated", label: "Deactivated" },
  ];

  // ── Format reactivation date ──────────────────────────────────
  const getReactivationDate = (deactivatedAt) => {
    if (!deactivatedAt) return "—";
    const date = new Date(deactivatedAt);
    date.setDate(date.getDate() + 30);
    return date.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // ── Render table rows ─────────────────────────────────────────
  const renderRows = () => {
    if (users.length === 0) {
      return (
        <tr>
          <td colSpan={7} className="text-center py-8 text-gray-400 text-sm">
            No records found
          </td>
        </tr>
      );
    }

    return users.map((u) => (
      <tr key={u.id} className="border-t hover:bg-gray-50 text-sm">
        <td className="px-4 py-3 text-gray-500">{u.id}</td>
        <td className="px-4 py-3 font-medium text-gray-800">
          {u.username}
          <WarningBadge count={u.warning_count} />
        </td>
        <td className="px-4 py-3 text-gray-600">{u.name}</td>
        <td className="px-4 py-3 text-gray-600">{u.email}</td>
        <td className="px-4 py-3">
          <StatusBadge status={u.status} />
        </td>
        {/* Reactivation date — only shown in deactivated tab */}
        {activeTab === "deactivated" && (
          <td className="px-4 py-3 text-xs text-gray-500">
            Auto-reactivates: {getReactivationDate(u.deactivated_at)}
          </td>
        )}
        <td className="px-4 py-3">
          <div className="flex gap-2 flex-wrap">
            {/* All Users tab */}
            {activeTab === "all" && (
              <>
                <button
                  onClick={() => handleEditOpen(u)}
                  className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1 rounded-lg"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleWarnOpen(u)}
                  disabled={(u.warning_count || 0) >= 2}
                  className="text-xs bg-orange-50 text-orange-700 hover:bg-orange-100 px-3 py-1 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    (u.warning_count || 0) >= 2
                      ? "User already has 2 warnings"
                      : "Issue a warning"
                  }
                >
                  Warn
                </button>
                <button
                  onClick={() => handleDeactivate(u.id, u.warning_count)}
                  disabled={(u.warning_count || 0) < 2}
                  className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    (u.warning_count || 0) < 2
                      ? `User needs ${2 - (u.warning_count || 0)} more warning(s) before deactivation`
                      : "Deactivate user"
                  }
                >
                  Deactivate
                </button>
              </>
            )}

            {/* Pending tab */}
            {activeTab === "pending" && (
              <>
                <button
                  onClick={() => handleApprove(u.id)}
                  className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1 rounded-lg"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDelete(u.id)}
                  className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                >
                  Deny
                </button>
              </>
            )}

            {/* Deactivated tab */}
            {activeTab === "deactivated" && (
              <>
                <button
                  onClick={() => handleReactivate(u.id)}
                  className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1 rounded-lg"
                >
                  Reactivate
                </button>
                <button
                  onClick={() => handleDelete(u.id)}
                  className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    ));
  };

  // ── JSX ───────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Manage Users</h2>
          <p className="text-gray-500 text-sm mt-1">
            Manage user accounts and access
          </p>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">
          {success}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Users"
          value={stats?.total}
          icon={Users}
          color="bg-blue-900"
        />
        <StatCard
          title="Pending"
          value={stats?.pending}
          icon={ClipboardList}
          color="bg-yellow-500"
        />
        <StatCard
          title="Deactivated"
          value={stats?.deactivated}
          icon={UserX}
          color="bg-red-500"
        />
        <StatCard
          title="Warned"
          value={stats?.warned}
          icon={AlertTriangle}
          color="bg-orange-500"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition
              ${
                activeTab === tab.key
                  ? "border-blue-900 text-blue-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {activeTab === "all" && (
        <div className="relative mb-4 max-w-sm">
          <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
          />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-900" />
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                {activeTab === "deactivated" && (
                  <th className="px-4 py-3">Auto-Reactivates</th>
                )}
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>{renderRows()}</tbody>
          </table>
        )}
      </div>

      {/* Warn Modal */}
      {warnModal && (
        <Modal
          title={`Issue Warning to ${warnModal.username}`}
          onClose={() => setWarnModal(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              This user currently has{" "}
              <span className="font-semibold text-orange-600">
                {warnModal.warning_count || 0}/2
              </span>{" "}
              warnings. After 2 warnings, the account can be deactivated.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Reason <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={warnReason}
                onChange={(e) => setWarnReason(e.target.value)}
                placeholder="Describe the reason for this warning..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleWarnSubmit}
                disabled={actionLoading}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Issuing..." : "Issue Warning"}
              </button>
              <button
                onClick={() => setWarnModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit User Modal */}
      {editModal && (
        <Modal title="Edit User" onClose={() => setEditModal(null)}>
          <div className="space-y-3">
            {["name", "username", "email", "age"].map((field) => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-600 mb-1 capitalize">
                  {field}
                </label>
                <input
                  type={field === "age" ? "number" : "text"}
                  value={editForm[field]}
                  onChange={(e) =>
                    setEditForm({ ...editForm, [field]: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Gender
              </label>
              <select
                value={editForm.gender}
                onChange={(e) =>
                  setEditForm({ ...editForm, gender: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleEditSave}
                disabled={actionLoading}
                className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 border border-gray-300 text-gray-600 text-sm font-semibold py-2 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ManageUsers;
