import { useState, useEffect } from "react";
import AppModal from "../../components/AppModal.jsx";
import {
  getAllAdministrators,
  getDeactivatedAdministrators,
  getDeletedAdministrators,
  getAdministratorStats,
  deactivateAdministrator,
  reactivateAdministrator,
  deleteAdministrator,
  updateAdministrator,
  createAdministrator,
} from "../../api/administratorApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Users,
  UserX,
  Trash2,
  Check,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  UserPlus,
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
  if (document.getElementById("manage-admins-card-styles")) return;
  const s = document.createElement("style");
  s.id = "manage-admins-card-styles";
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

const SkeletonRows = ({ rows = 5, cols = 6 }) =>
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
    deactivated: C.red,
    deleted: C.muted,
  };
  const bg = map[status] || C.muted;
  return <span style={chipStyle(bg)}>{status}</span>;
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

// ── Password rule: ≥8 chars, ≥1 letter, ≥1 number ─────────────
const isValidPassword = (pw) =>
  pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

// ════════════════════════════════════════════════════════════
// ── Main Component ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════
const ManageAdministrators = () => {
  const [activeTab, setActiveTab] = useState("all");
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting
  const [sortField, setSortField] = useState("id");
  const [sortDir, setSortDir] = useState("asc");

  // Modal state
  const [editModal, setEditModal] = useState(null);
  const [createModal, setCreateModal] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
  });

  // Edit form
  const [editForm, setEditForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
  });

  // ── Fetch data ──────────────────────────────────────────────
  const fetchStats = async () => {
    try {
      const data = await getAdministratorStats();
      setStats(data);
    } catch {
      // non-blocking
    }
  };

  const fetchTabData = async () => {
    setLoading(true);
    try {
      if (activeTab === "all") {
        const data = await getAllAdministrators({ search: debouncedSearch, limit: 500 });
        setAdmins(data.administrators || []);
      } else if (activeTab === "deactivated") {
        const data = await getDeactivatedAdministrators();
        setAdmins(data.administrators || []);
      } else if (activeTab === "deleted") {
        const data = await getDeletedAdministrators();
        setAdmins(data.administrators || []);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load administrators");
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
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    fetchTabData();
  }, [activeTab, debouncedSearch]);

  // ── Sort ────────────────────────────────────────────────────
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortedAdmins = [...admins].sort((a, b) => {
    let va = a[sortField] ?? "";
    let vb = b[sortField] ?? "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // ── Paginate ────────────────────────────────────────────────
  const totalPages = Math.ceil(sortedAdmins.length / pageSize);
  const paginatedAdmins = sortedAdmins.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  // ── Actions ─────────────────────────────────────────────────
  const showSuccess = (msg) => toast.success(msg);
  const showError = (msg) => toast.error(msg);

  // ── Create Administrator ─────────────────────────────────────
  // Step 1: validate the form, then open a confirmation dialog.
  const handleCreateAdmin = () => {
    if (!createForm.username.trim() || !createForm.password.trim()) {
      showError("Username and password are required");
      return;
    }
    if (!isValidPassword(createForm.password)) {
      showError(
        "Password must be at least 8 characters and include a letter and a number",
      );
      return;
    }
    if (createForm.password !== createForm.confirmPassword) {
      showError("Passwords do not match");
      return;
    }
    setConfirmCreate(true);
  };

  // Step 2: actually create the administrator after confirmation.
  const confirmCreateAdmin = async () => {
    setActionLoading(true);
    try {
      await createAdministrator({
        username: createForm.username.trim(),
        password: createForm.password,
      });
      showSuccess("Administrator created successfully");
      setConfirmCreate(false);
      setCreateModal(false);
      setCreateForm({ username: "", password: "", confirmPassword: "" });
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to create administrator");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivate = async (id) => {
    if (!window.confirm("Deactivate this administrator? They will not be able to log in until reactivated."))
      return;
    setActionLoading(true);
    try {
      await deactivateAdministrator(id);
      showSuccess("Administrator deactivated.");
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to deactivate administrator");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async (id) => {
    setActionLoading(true);
    try {
      await reactivateAdministrator(id);
      showSuccess("Administrator reactivated successfully.");
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reactivate administrator");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Permanently delete this administrator? This cannot be undone."))
      return;
    setActionLoading(true);
    try {
      await deleteAdministrator(id);
      showSuccess("Administrator permanently deleted");
      fetchStats();
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to delete administrator");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditOpen = (admin) => {
    setEditForm({
      name: admin.name || "",
      username: admin.username || "",
      email: admin.email || "",
      password: "",
    });
    setEditModal(admin);
  };

  const handleEditSave = async () => {
    // Password is optional on edit; validate only when a new one is entered.
    if (editForm.password && !isValidPassword(editForm.password)) {
      showError(
        "Password must be at least 8 characters and include a letter and a number",
      );
      return;
    }
    setActionLoading(true);
    try {
      const payload = {
        name: editForm.name,
        username: editForm.username,
        email: editForm.email,
      };
      if (editForm.password) payload.password = editForm.password;
      await updateAdministrator(editModal.id, payload);
      showSuccess("Administrator updated successfully");
      setEditModal(null);
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to update administrator");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Tabs ────────────────────────────────────────────────────
  const tabs = [
    { key: "all", label: "All Administrators" },
    { key: "deactivated", label: "Deactivated" },
    { key: "deleted", label: "Deleted" },
  ];

  // ── Mask email ──────────────────────────────────────────────
  const maskEmail = (email) => {
    if (!email) return "—";
    const [local, domain] = email.split("@");
    if (!domain) return email;
    const masked =
      local.length <= 2 ? local[0] + "*" : local.slice(0, 2) + "***";
    return `${masked}@${domain}`;
  };

  // ── Render table rows ───────────────────────────────────────
  const renderRows = () => {
    if (paginatedAdmins.length === 0) {
      return (
        <tr>
          <td
            colSpan={6}
            className="text-center py-10"
            style={{ color: C.muted, fontSize: 13 }}
          >
            No records found
          </td>
        </tr>
      );
    }

    return paginatedAdmins.map((u) => (
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
        </td>
        <td className="px-5 py-3.5" style={{ color: "#4b5563" }}>
          {maskEmail(u.email)}
        </td>
        <td className="px-5 py-3.5">
          <StatusBadge status={u.status} />
        </td>
        <td className="px-5 py-3.5" style={{ color: C.muted, fontSize: 12 }}>
          {u.created_at ? new Date(u.created_at).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—"}
        </td>
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
                  label="Deactivate"
                  bg={C.red}
                  onClick={() => handleDeactivate(u.id)}
                />
                <ActionBtn
                  label="Delete"
                  bg="#6b7280"
                  onClick={() => handleDelete(u.id)}
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
            {activeTab === "deleted" && (
              <span style={{ color: C.muted, fontSize: 12 }}>—</span>
            )}
          </div>
        </td>
      </tr>
    ));
  };

  // ── JSX ─────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: C.text, margin: 0 }}>
            Manage Administrators
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#6b7280", margin: "4px 0 0" }}>
            Create and manage administrator accounts
          </p>
        </div>
        <button
          onClick={() => setCreateModal(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 16px",
            background: C.primary,
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "0.85rem",
            fontWeight: 500,
            cursor: "pointer",
            transition: "background 0.2s",
            fontFamily: "inherit",
          }}
        >
          <UserPlus size={16} />
          Create Administrator
        </button>
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
            title="Total Administrators"
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
            title="Deactivated"
            value={stats?.deactivated}
            icon={UserX}
            color="bg-red-500"
          />
          <StatCard
            title="Deleted"
            value={stats?.deleted}
            icon={Trash2}
            color="bg-gray-500"
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
            placeholder="Search administrators..."
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
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: 640 }}>
              <thead style={{ background: "#f9fafb" }}>
                <tr>
                  {["ID", "Username", "Email", "Status", "Registered", "Actions"].map((h) => (
                    <th key={h} className="px-5 py-3">
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>{h}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SkeletonRows rows={5} cols={6} />
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ minWidth: 640 }}>
                <thead style={{ background: "#f9fafb" }}>
                  <tr>
                    <SortableHeader label="ID" sortKey="id" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Username" sortKey="username" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Email" sortKey="email" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Status" sortKey="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader label="Registered" sortKey="created_at" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-5 py-3">
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>{renderRows()}</tbody>
              </table>
            </div>
            {sortedAdmins.length > pageSize && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onPage={setPage}
                pageSize={pageSize}
                onPageSize={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                total={sortedAdmins.length}
              />
            )}
          </>
        )}
      </div>

      {/* Edit Administrator Modal */}
      {editModal && (
        <AppModal title="Edit Administrator" onClose={() => setEditModal(null)}>
          <div className="space-y-3">
            {["name", "username", "email"].map((field) => (
              <div key={field}>
                <label
                  className="block text-xs font-medium mb-1 capitalize"
                  style={{ color: "#4b5563" }}
                >
                  {field}
                </label>
                <input
                  type="text"
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
                New Password <span style={{ color: C.muted }}>(optional)</span>
              </label>
              <input
                type="password"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm({ ...editForm, password: e.target.value })
                }
                placeholder="Leave blank to keep current password"
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
              />
              <p className="text-[11px] mt-1" style={{ color: C.muted }}>
                If set: at least 8 characters, including a letter and a number.
              </p>
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
        </AppModal>
      )}

      {/* Create Administrator Modal */}
      {createModal && (
        <AppModal title="Create Administrator" onClose={() => setCreateModal(false)}>
          <div className="space-y-3">
            <p className="text-sm leading-relaxed" style={{ color: "#4b5563" }}>
              Create an administrator account with a username and password. The
              administrator links their email address on first login.
            </p>
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Username
              </label>
              <input
                type="text"
                value={createForm.username}
                onChange={(e) =>
                  setCreateForm({ ...createForm, username: e.target.value })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
              />
            </div>
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Password
              </label>
              <input
                type="password"
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm({ ...createForm, password: e.target.value })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
              />
              <p className="text-[11px] mt-1" style={{ color: C.muted }}>
                At least 8 characters, including a letter and a number.
              </p>
            </div>
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Confirm Password
              </label>
              <input
                type="password"
                value={createForm.confirmPassword}
                onChange={(e) =>
                  setCreateForm({ ...createForm, confirmPassword: e.target.value })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleCreateAdmin}
                disabled={actionLoading}
                className="flex-1 text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-50"
                style={{ background: C.primary, color: "#fff" }}
              >
                Create
              </button>
              <button
                onClick={() => setCreateModal(false)}
                className="flex-1 border text-sm font-semibold py-2.5 rounded-xl transition"
                style={{ borderColor: C.border, color: "#4b5563" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}

      {/* Create Confirmation Dialog */}
      {confirmCreate && (
        <AppModal
          title="Confirm Administrator Creation"
          onClose={() => setConfirmCreate(false)}
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed" style={{ color: "#4b5563" }}>
              Create a new administrator account with username{" "}
              <strong style={{ color: C.text }}>
                {createForm.username.trim()}
              </strong>
              ? The assigned person can log in with these credentials and will
              be asked to link an email on first login.
            </p>
            <div className="flex gap-2">
              <button
                onClick={confirmCreateAdmin}
                disabled={actionLoading}
                className="flex-1 text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-50"
                style={{ background: C.primary, color: "#fff" }}
              >
                {actionLoading ? "Creating..." : "Confirm & Create"}
              </button>
              <button
                onClick={() => setConfirmCreate(false)}
                disabled={actionLoading}
                className="flex-1 border text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-50"
                style={{ borderColor: C.border, color: "#4b5563" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
};

export default ManageAdministrators;
