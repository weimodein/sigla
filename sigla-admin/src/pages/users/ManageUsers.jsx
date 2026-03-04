import { useState, useEffect } from "react";
import {
  getAllUsers,
  getPendingUsers,
  getDeactivatedUsers,
  getUserStats,
  approveUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  updateUser,
  getAllAdmins,
  createAdmin,
  deleteAdmin,
} from "../../api/userApi.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { Users, ClipboardList, UserX, Shield, Search, X } from "lucide-react";

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

// ── Badge ─────────────────────────────────────────────────────
const Badge = ({ status }) => {
  const styles = {
    active: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    deactivated: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || "bg-gray-100 text-gray-600"}`}
    >
      {status}
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
  const { isSuperAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState("all");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");

  // Modal state
  const [editModal, setEditModal] = useState(null); // user object
  const [adminModal, setAdminModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit form
  const [editForm, setEditForm] = useState({
    name: "",
    username: "",
    email: "",
    age: "",
    gender: "",
  });

  // Create admin form
  const [adminForm, setAdminForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
  });

  // ── Fetch data ──────────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const [statsData, allUsers] = await Promise.all([
        getUserStats(),
        getAllUsers({ search }),
      ]);
      setStats(statsData);
      setUsers(allUsers.users);

      if (isSuperAdmin) {
        const adminsData = await getAllAdmins();
        setAdmins(adminsData.admins);
      }
    } catch (err) {
      setError("Failed to load users");
    } finally {
      setLoading(false);
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
      } else if (activeTab === "admins") {
        const data = await getAllAdmins();
        setAdmins(data.admins);
      }
    } catch (err) {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);
  useEffect(() => {
    fetchTabData();
  }, [activeTab, search]);

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 3000);
  };

  // ── Actions ─────────────────────────────────────────────────
  const handleApprove = async (id) => {
    setActionLoading(true);
    try {
      await approveUser(id);
      showSuccess("User approved successfully");
      fetchData();
      fetchTabData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to approve user");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivate = async (id) => {
    if (!window.confirm("Deactivate this user?")) return;
    setActionLoading(true);
    try {
      await deactivateUser(id);
      showSuccess("User deactivated successfully");
      fetchData();
      fetchTabData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to deactivate user");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async (id) => {
    setActionLoading(true);
    try {
      await reactivateUser(id);
      showSuccess("User reactivated successfully");
      fetchData();
      fetchTabData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reactivate user");
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
      showSuccess("User deleted successfully");
      fetchData();
      fetchTabData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete user");
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
      fetchData();
      fetchTabData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update user");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateAdmin = async () => {
    setActionLoading(true);
    try {
      await createAdmin(adminForm);
      showSuccess("Admin created successfully");
      setAdminModal(false);
      setAdminForm({ name: "", username: "", email: "", password: "" });
      fetchData();
      fetchTabData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create admin");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAdmin = async (id) => {
    if (!window.confirm("Remove this admin?")) return;
    setActionLoading(true);
    try {
      await deleteAdmin(id);
      showSuccess("Admin removed successfully");
      fetchData();
      fetchTabData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to remove admin");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Tabs ─────────────────────────────────────────────────────
  const tabs = [
    { key: "all", label: "All Users" },
    { key: "pending", label: "Pending" },
    { key: "deactivated", label: "Deactivated" },
    ...(isSuperAdmin ? [{ key: "admins", label: "Administrators" }] : []),
  ];

  // ── Render table rows ─────────────────────────────────────────
  const renderRows = () => {
    const list = activeTab === "admins" ? admins : users;

    if (list.length === 0) {
      return (
        <tr>
          <td colSpan={6} className="text-center py-8 text-gray-400 text-sm">
            No records found
          </td>
        </tr>
      );
    }

    return list.map((u) => (
      <tr key={u.id} className="border-t hover:bg-gray-50 text-sm">
        <td className="px-4 py-3 text-gray-500">{u.id}</td>
        <td className="px-4 py-3 font-medium text-gray-800">{u.username}</td>
        <td className="px-4 py-3 text-gray-600">{u.name}</td>
        <td className="px-4 py-3 text-gray-600">{u.email}</td>
        <td className="px-4 py-3">
          {activeTab !== "admins" && <Badge status={u.status} />}
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-2 flex-wrap">
            {activeTab === "all" && (
              <>
                <button
                  onClick={() => handleEditOpen(u)}
                  className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1 rounded-lg"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeactivate(u.id)}
                  className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                >
                  Deactivate
                </button>
              </>
            )}
            {activeTab === "pending" && (
              <>
                <button
                  onClick={() => handleApprove(u.id)}
                  className="text-xs bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1 rounded-lg"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDeactivate(u.id)}
                  className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
                >
                  Deny
                </button>
              </>
            )}
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
            {activeTab === "admins" && isSuperAdmin && (
              <button
                onClick={() => handleDeleteAdmin(u.id)}
                className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-3 py-1 rounded-lg"
              >
                Remove
              </button>
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
        {isSuperAdmin && (
          <button
            onClick={() => setAdminModal(true)}
            className="bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            + Create Admin
          </button>
        )}
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
          title="Administrators"
          value={stats?.admins}
          icon={Shield}
          color="bg-purple-600"
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
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>{renderRows()}</tbody>
          </table>
        )}
      </div>

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

      {/* Create Admin Modal */}
      {adminModal && (
        <Modal title="Create Admin" onClose={() => setAdminModal(false)}>
          <div className="space-y-3">
            {["name", "username", "email", "password"].map((field) => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-600 mb-1 capitalize">
                  {field}
                </label>
                <input
                  type={field === "password" ? "password" : "text"}
                  value={adminForm[field]}
                  onChange={(e) =>
                    setAdminForm({ ...adminForm, [field]: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreateAdmin}
                disabled={actionLoading}
                className="flex-1 bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {actionLoading ? "Creating..." : "Create Admin"}
              </button>
              <button
                onClick={() => setAdminModal(false)}
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
