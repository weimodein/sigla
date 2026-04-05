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
import { useToast } from "../../context/ToastContext.jsx";
import {
  Users,
  ClipboardList,
  UserX,
  AlertTriangle,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
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

// ── Skeleton Components ───────────────────────────────────────────
const SkeletonCard = () => (
  <div className="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4">
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-12 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

const SkeletonTableRows = ({ rows = 5, cols = 7 }) =>
  Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="border-t">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
        </td>
      ))}
    </tr>
  ));

// ── Sortable Header ──────────────────────────────────────────────
const SortableHeader = ({ label, sortKey, sortField, sortDir, onSort }) => {
  const active = sortField === sortKey;
  return (
    <th
      className={`px-4 py-3 cursor-pointer select-none group ${
        sortKey ? "hover:bg-gray-100" : ""
      }`}
      onClick={() => sortKey && onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey && (
          <span className="text-gray-400">
            {active ? (
              sortDir === "asc" ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )
            ) : (
              <ChevronUp size={14} className="opacity-0 group-hover:opacity-50" />
            )}
          </span>
        )}
      </div>
    </th>
  );
};

// ── Pagination ─────────────────────────────────────────────────────
const Pagination = ({ page, totalPages, onPage, pageSize, onPageSize, total }) => (
  <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
    <div className="flex items-center gap-2">
      <span>
        {total} result{total !== 1 ? "s" : ""}
      </span>
      <select
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-900"
      >
        <option value={10}>10 / page</option>
        <option value={25}>25 / page</option>
        <option value={50}>50 / page</option>
        <option value={100}>100 / page</option>
      </select>
    </div>
    <div className="flex items-center gap-1">
      <button
        onClick={() => onPage(1)}
        disabled={page === 1}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
        aria-label="First page"
      >
        <ChevronsLeft size={16} />
      </button>
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="px-2">
        Page {page} of {totalPages || 1}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
      <button
        onClick={() => onPage(totalPages)}
        disabled={page >= totalPages}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
        aria-label="Last page"
      >
        <ChevronsRight size={16} />
      </button>
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
      {count}/2
    </span>
  );
};

// ── Modal ─────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
  <div
    className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4"
    onKeyDown={(e) => e.key === "Escape" && onClose()}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">{title}</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition"
          aria-label="Close dialog"
        >
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
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting
  const [sortField, setSortField] = useState("id");
  const [sortDir, setSortDir] = useState("asc");

  // Modal state
  const [editModal, setEditModal] = useState(null);
  const [warnModal, setWarnModal] = useState(null);
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
    } catch {
      // non-blocking
    }
  };

  const fetchTabData = async () => {
    setLoading(true);
    try {
      if (activeTab === "all") {
        const data = await getAllUsers({ search, limit: 500 });
        setUsers(data.users || []);
      } else if (activeTab === "pending") {
        const data = await getPendingUsers();
        setUsers(data.users || []);
      } else if (activeTab === "deactivated") {
        const data = await getDeactivatedUsers();
        setUsers(data.users || []);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load users");
    } finally {
      setLoading(false);
      setPage(1);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);
  useEffect(() => {
    fetchTabData();
  }, [activeTab, search]);

  // ── Sort ────────────────────────────────────────────────────
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    let va = a[sortField] ?? "";
    let vb = b[sortField] ?? "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // ── Paginate ────────────────────────────────────────────────
  const totalPages = Math.ceil(sortedUsers.length / pageSize);
  const paginatedUsers = sortedUsers.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  // ── Actions ─────────────────────────────────────────────────
  const showSuccess = (msg) => toast.success(msg);
  const showError = (msg) => toast.error(msg);

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
        `Warning issued. User now has ${res.warning_count}/2 warnings.`
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
    if ((warningCount || 0) < 2) {
      showError(
        `User must have 2 warnings before being deactivated. Current: ${warningCount || 0}/2`
      );
      return;
    }
    if (
      !window.confirm(
        "Deactivate this user? Their account will auto-reactivate after 30 days."
      )
    )
      return;
    setActionLoading(true);
    try {
      await deactivateUser(id);
      showSuccess(
        "User deactivated. Account will auto-reactivate after 30 days."
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

  // ── Tabs ────────────────────────────────────────────────────
  const tabs = [
    { key: "all", label: "All Users" },
    { key: "pending", label: "Pending" },
    { key: "deactivated", label: "Deactivated" },
  ];

  // ── Format reactivation date ────────────────────────────────
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

  // ── Render table rows ───────────────────────────────────────
  const renderRows = () => {
    if (paginatedUsers.length === 0) {
      return (
        <tr>
          <td
            colSpan={activeTab === "deactivated" ? 7 : 6}
            className="text-center py-8 text-gray-400 text-sm"
          >
            No records found
          </td>
        </tr>
      );
    }

    return paginatedUsers.map((u) => (
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
        {activeTab === "deactivated" && (
          <td className="px-4 py-3 text-xs text-gray-500">
            Auto-reactivates: {getReactivationDate(u.deactivated_at)}
          </td>
        )}
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

  const tableCols = activeTab === "deactivated" ? 7 : 6;

  // ── JSX ─────────────────────────────────────────────────────
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

      {/* Stat Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
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
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
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
            <tbody>
              <SkeletonTableRows rows={5} cols={tableCols} />
            </tbody>
          </table>
        ) : (
          <>
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <SortableHeader label="ID" sortKey="id" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Username" sortKey="username" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Name" sortKey="name" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Email" sortKey="email" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Status" sortKey="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  {activeTab === "deactivated" && (
                    <th className="px-4 py-3">Auto-Reactivates</th>
                  )}
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>{renderRows()}</tbody>
            </table>
            {sortedUsers.length > pageSize && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onPage={setPage}
                pageSize={pageSize}
                onPageSize={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                total={sortedUsers.length}
              />
            )}
          </>
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
