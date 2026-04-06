import { useState, useEffect } from "react";
import {
  getAllUsers,
  getDeactivatedUsers,
  getWarnedUsers,
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
  Check,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ── Color Palette ────────────────────────────────────────────
const C = {
  text: "#1f2937",
  background: "#f3f4f6",
  primary: "#1e3a8a",
  secondary: "#1d4ed8",
  accent: "#3f8efc",
  yellow: "#f59e0b",
  red: "#ef4444",
  orange: "#f97316",
  green: "#22c55e",
  muted: "#9ca3af",
  border: "#e5e7eb",
  borderLight: "#f0f0f0",
  surface: "#ffffff",
};

// ── Dashboard card styles ──
const injectCardStyles = () => {
  if (document.getElementById("manage-users-card-styles")) return;
  const s = document.createElement("style");
  s.id = "manage-users-card-styles";
  s.textContent = `
    .mv-stat-card {
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      border: 1px solid #f0f0f0;
      transition: all 0.3s ease;
      position: relative;
    }
    .mv-stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 6px rgba(0,0,0,0.07);
    }
  `;
  document.head.appendChild(s);
};

const chipStyle = (bg) => ({
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: bg + "18",
  color: bg,
});

// ── Stat Card ────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="mv-stat-card flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

// ── Skeleton ─────────────────────────────────────────────────
const SkeletonCard = () => (
  <div className="mv-stat-card flex items-center gap-4" style={{ opacity: 0.6 }}>
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-10 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

const SkeletonRows = ({ rows = 5, cols = 7 }) =>
  Array.from({ length: rows }).map((_, i) => (
    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-5 py-3.5">
          <div
            className="h-4 rounded animate-pulse w-3/4"
            style={{ background: C.border }}
          />
        </td>
      ))}
    </tr>
  ));

// ── Sortable Header ──────────────────────────────────────────
const SortableHeader = ({ label, sortKey, sortField, sortDir, onSort }) => {
  const active = sortField === sortKey;
  return (
    <th
      className="px-5 py-3.5 select-none"
      style={{
        cursor: sortKey ? "pointer" : "default",
        transition: "background .15s",
      }}
      onClick={() => sortKey && onSort(sortKey)}
      onMouseEnter={(e) =>
        sortKey && (e.currentTarget.style.background = "#f9fafb")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: C.muted }}
        >
          {label}
        </span>
        {sortKey &&
          (active ? (
            sortDir === "asc" ? (
              <ChevronUp size={14} style={{ color: C.primary }} />
            ) : (
              <ChevronDown size={14} style={{ color: C.primary }} />
            )
          ) : (
            <ChevronUp size={14} style={{ color: C.border }} />
          ))}
      </div>
    </th>
  );
};

// ── Pagination ───────────────────────────────────────────────
const Pagination = ({
  page,
  totalPages,
  onPage,
  pageSize,
  onPageSize,
  total,
}) => (
  <div
    className="flex items-center justify-between px-5 py-3.5"
    style={{
      borderTop: `1px solid ${C.border}`,
      fontSize: 13,
      color: "#6b7280",
    }}
  >
    <div className="flex items-center gap-3">
      <span>
        {total} result{total !== 1 ? "s" : ""}
      </span>
      <select
        value={pageSize}
        onChange={(e) => onPageSize(+e.target.value)}
        className="rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
        style={{ border: `1px solid ${C.border}` }}
      >
        <option value={10}>10 / page</option>
        <option value={25}>25 / page</option>
        <option value={50}>50 / page</option>
        <option value={100}>100 / page</option>
      </select>
    </div>
    <div className="flex items-center gap-1">
      {[
        {
          icon: <ChevronsLeft size={16} />,
          action: () => onPage(1),
          disabled: page === 1,
        },
        {
          icon: <ChevronLeft size={16} />,
          action: () => onPage(page - 1),
          disabled: page === 1,
        },
      ].map((b, i) => (
        <button
          key={i}
          onClick={b.action}
          disabled={b.disabled}
          className="p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-gray-100"
          aria-label={b.disabled ? "" : "pagination"}
        >
          {b.icon}
        </button>
      ))}
      <span className="px-3 font-medium" style={{ color: C.text }}>
        Page {page} of {totalPages || 1}
      </span>
      {[
        {
          icon: <ChevronRight size={16} />,
          action: () => onPage(page + 1),
          disabled: page >= totalPages,
        },
        {
          icon: <ChevronsRight size={16} />,
          action: () => onPage(totalPages),
          disabled: page >= totalPages,
        },
      ].map((b, i) => (
        <button
          key={i}
          onClick={b.action}
          disabled={b.disabled}
          className="p-1.5 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-gray-100"
          aria-label={b.disabled ? "" : "pagination"}
        >
          {b.icon}
        </button>
      ))}
    </div>
  </div>
);

// ── Status Badge ─────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    active: C.green,
    pending: C.yellow,
    deactivated: C.red,
    deleted: C.muted,
  };
  const bg = map[status] || C.muted;
  return <span style={chipStyle(bg)}>{status}</span>;
};

// ── Warning Badge ────────────────────────────────────────────
const WarningBadge = ({ count }) => {
  if (!count || count === 0) return null;
  return (
    <span className="ml-2" style={chipStyle(count >= 2 ? C.red : C.orange)}>
      {count}/2
    </span>
  );
};

// ── Modal ────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        style={{ background: C.surface }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: C.text }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition hover:bg-gray-100"
            style={{ color: C.muted }}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ── Action Button ────────────────────────────────────────────
const ActionBtn = ({ label, bg, onClick, disabled, title }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
    style={{
      background: bg + "18",
      color: bg,
    }}
    onMouseEnter={(e) => (e.currentTarget.style.background = bg + "30")}
    onMouseLeave={(e) => (e.currentTarget.style.background = bg + "18")}
  >
    {label}
  </button>
);

// ════════════════════════════════════════════════════════════
// ── Main Component ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════
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
      } else if (activeTab === "warned") {
        const data = await getWarnedUsers();
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
    injectCardStyles();
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
    page * pageSize,
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

  // ── Tabs ────────────────────────────────────────────────────
  const tabs = [
    { key: "all", label: "All Users" },
    { key: "warned", label: "Warned" },
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
            className="text-center py-10"
            style={{ color: C.muted, fontSize: 13 }}
          >
            No records found
          </td>
        </tr>
      );
    }

    return paginatedUsers.map((u) => (
      <tr
        key={u.id}
        className="border-t hover:bg-gray-50 text-sm"
        style={{
          borderTop: `1px solid ${C.border}`,
          transition: "background .15s",
        }}
      >
        <td
          className="px-5 py-3.5 font-mono"
          style={{ color: C.muted, fontSize: 12 }}
        >
          {u.id}
        </td>
        <td className="px-5 py-3.5 font-semibold" style={{ color: C.text }}>
          {u.username}
          <WarningBadge count={u.warning_count} />
        </td>
        <td className="px-5 py-3.5" style={{ color: "#4b5563" }}>
          {u.name}
        </td>
        <td className="px-5 py-3.5" style={{ color: "#4b5563" }}>
          {u.email}
        </td>
        <td className="px-5 py-3.5">
          <StatusBadge status={u.status} />
        </td>
        {activeTab === "deactivated" && (
          <td className="px-5 py-3.5" style={{ color: C.muted, fontSize: 12 }}>
            Auto-reactivates: {getReactivationDate(u.deactivated_at)}
          </td>
        )}
        <td className="px-5 py-3.5">
          <div className="flex gap-1.5 flex-wrap">
            {activeTab === "all" && (
              <>
                <ActionBtn
                  label="Edit"
                  bg={C.primary}
                  onClick={() => handleEditOpen(u)}
                />
                <ActionBtn
                  label="Warn"
                  bg={C.orange}
                  onClick={() => handleWarnOpen(u)}
                  disabled={(u.warning_count || 0) >= 2}
                  title={
                    (u.warning_count || 0) >= 2
                      ? "User already has 2 warnings"
                      : "Issue a warning"
                  }
                />
                <ActionBtn
                  label="Deactivate"
                  bg={C.red}
                  onClick={() => handleDeactivate(u.id, u.warning_count)}
                  disabled={(u.warning_count || 0) < 2}
                  title={
                    (u.warning_count || 0) < 2
                      ? `User needs ${2 - (u.warning_count || 0)} more warning(s) before deactivation`
                      : "Deactivate user"
                  }
                />
              </>
            )}
            {activeTab === "warned" && (
              <>
                <ActionBtn
                  label="Warn"
                  bg={C.orange}
                  onClick={() => handleWarnOpen(u)}
                  disabled={(u.warning_count || 0) >= 2}
                  title={
                    (u.warning_count || 0) >= 2
                      ? "User already has 2 warnings"
                      : "Issue a warning"
                  }
                />
                <ActionBtn
                  label="Deactivate"
                  bg={C.red}
                  onClick={() => handleDeactivate(u.id, u.warning_count)}
                  disabled={(u.warning_count || 0) < 2}
                  title={
                    (u.warning_count || 0) < 2
                      ? `User needs ${2 - (u.warning_count || 0)} more warning(s) before deactivation`
                      : "Deactivate user"
                  }
                />
              </>
            )}
            {activeTab === "deactivated" && (
              <>
                <ActionBtn
                  label="Reactivate"
                  bg={C.green}
                  onClick={() => handleReactivate(u.id)}
                />
                <ActionBtn
                  label="Delete"
                  bg={C.red}
                  onClick={() => handleDelete(u.id)}
                />
              </>
            )}
          </div>
        </td>
      </tr>
    ));
  };

  const tableCols = activeTab === "deactivated" ? 7 : 6;
  const isDeactivated = activeTab === "deactivated";

  // ── JSX ─────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: C.text, margin: 0 }}>
            Manage Users
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#6b7280", margin: "4px 0 0" }}>
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
            title="Active"
            value={stats?.active}
            icon={Check}
            color="bg-green-500"
          />
          <StatCard
            title="Warned"
            value={stats?.warned}
            icon={AlertTriangle}
            color="bg-yellow-500"
          />
          <StatCard
            title="Deactivated"
            value={stats?.deactivated}
            icon={UserX}
            color="bg-red-500"
          />
        </div>
      )}

      {/* Tabs */}
      <div
        className="flex gap-1 mb-4 rounded-xl p-1"
        style={{ background: C.border, width: "fit-content" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 text-sm font-medium rounded-lg transition"
            style={{
              background: activeTab === tab.key ? C.surface : "transparent",
              color: activeTab === tab.key ? C.primary : C.muted,
              boxShadow:
                activeTab === tab.key ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {activeTab === "all" && (
        <div className="relative mb-4 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: C.muted }}
          />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl focus:outline-none"
            style={{
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
            }}
          />
        </div>
      )}

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        {loading ? (
          <table className="w-full text-left">
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                <th className="px-5 py-3">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    ID
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    Username
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    Name
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    Email
                  </span>
                </th>
                <th className="px-5 py-3">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    Status
                  </span>
                </th>
                {isDeactivated && (
                  <th className="px-5 py-3">
                    <span
                      className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: C.muted }}
                    >
                      Auto-Reactivates
                    </span>
                  </th>
                )}
                <th className="px-5 py-3">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: C.muted }}
                  >
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRows rows={5} cols={tableCols} />
            </tbody>
          </table>
        ) : (
          <>
            <table className="w-full text-left">
              <thead style={{ background: "#f9fafb" }}>
                <tr>
                  <SortableHeader
                    label="ID"
                    sortKey="id"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Username"
                    sortKey="username"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Name"
                    sortKey="name"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Email"
                    sortKey="email"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Status"
                    sortKey="status"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  {isDeactivated && (
                    <th className="px-5 py-3">
                      <span
                        className="text-xs font-semibold uppercase tracking-wider"
                        style={{ color: C.muted }}
                      >
                        Auto-Reactivates
                      </span>
                    </th>
                  )}
                  <th className="px-5 py-3">
                    <span
                      className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: C.muted }}
                    >
                      Actions
                    </span>
                  </th>
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
            <p className="text-sm leading-relaxed" style={{ color: "#4b5563" }}>
              This user currently has{" "}
              <span className="font-semibold" style={{ color: C.orange }}>
                {warnModal.warning_count || 0}/2
              </span>{" "}
              warnings. After 2 warnings, the account can be deactivated.
            </p>
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Reason <span style={{ color: C.muted }}>(optional)</span>
              </label>
              <textarea
                value={warnReason}
                onChange={(e) => setWarnReason(e.target.value)}
                placeholder="Describe the reason for this warning..."
                rows={3}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none resize-none"
                style={{ borderColor: C.border, background: C.surface }}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleWarnSubmit}
                disabled={actionLoading}
                className="flex-1 text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-50"
                style={{ background: C.orange, color: "#fff" }}
              >
                {actionLoading ? "Issuing..." : "Issue Warning"}
              </button>
              <button
                onClick={() => setWarnModal(null)}
                className="flex-1 border text-sm font-semibold py-2.5 rounded-xl transition"
                style={{ borderColor: C.border, color: "#4b5563" }}
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
                <label
                  className="block text-xs font-medium mb-1 capitalize"
                  style={{ color: "#4b5563" }}
                >
                  {field}
                </label>
                <input
                  type={field === "age" ? "number" : "text"}
                  value={editForm[field]}
                  onChange={(e) =>
                    setEditForm({ ...editForm, [field]: e.target.value })
                  }
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                  style={{
                    borderColor: C.border,
                    background: C.surface,
                    color: C.text,
                  }}
                />
              </div>
            ))}
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Gender
              </label>
              <select
                value={editForm.gender}
                onChange={(e) =>
                  setEditForm({ ...editForm, gender: e.target.value })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
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
                className="flex-1 text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-50"
                style={{ background: C.primary, color: "#fff" }}
              >
                {actionLoading ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 border text-sm font-semibold py-2.5 rounded-xl transition"
                style={{ borderColor: C.border, color: "#4b5563" }}
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
