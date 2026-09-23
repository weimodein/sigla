import { useState, useEffect } from "react";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import { StatCard, SkeletonCard } from "../../components/StatCard.jsx";
import { TableSkeletonRows } from "../../components/Skeleton.jsx";
import { listStagger } from "../../utils/motion.js";
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
  resetAdministratorPassword,
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
  KeyRound,
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

// This page used to inject its own `.mv-stat-card` at runtime — a near-duplicate
// of `.dash-stat-card` in index.css with a different duration and hover lift, so
// its stat cards behaved unlike the other five pages'. Removed in favour of the
// shared class.

const chipStyle = (bg) => ({
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  background: bg + "18",
  color: bg,
});

// ── Stat Card ────────────────────────────────────────────────

// ── Skeleton ─────────────────────────────────────────────────

const ADMIN_SKELETON_COLUMNS = [
  { width: "w-10" },
  { type: "stack", width: "w-28" },
  { width: "w-40" },
  { type: "pill", width: "w-20" },
  { width: "w-24" },
  { type: "actions", count: 2 },
];

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
    className="meta-text flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-gray-500"
    style={{ borderTop: `1px solid ${C.border}` }}
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
  const [statsError, setStatsError] = useState(false);
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

  // Edit form. Username and email are edited directly by the super admin so a
  // locked-out account can be recovered. Password is never typed here — it is
  // display-only, and changing it goes through the Reset Password dialog.
  const [editForm, setEditForm] = useState({
    username: "",
    email: "",
  });

  // Reset-password dialog: the target admin, the typed temporary password, and
  // a final confirmation step before it is applied.
  const [resetModal, setResetModal] = useState(null);
  const [resetForm, setResetForm] = useState({ password: "", confirm: "" });
  const [confirmReset, setConfirmReset] = useState(false);

  // ── Fetch data ──────────────────────────────────────────────
  // These four cards are the module's headline content, so a failure has to be
  // visible. Swallowing it left every card showing "—", which reads exactly like
  // a legitimate zero: there was no way to tell "0 deleted administrators" from
  // "the stats endpoint is down". Non-blocking still — the table below renders
  // from its own request.
  const fetchStats = async () => {
    setStatsError(false);
    try {
      const data = await getAdministratorStats();
      setStats(data);
    } catch {
      setStats(null);
      setStatsError(true);
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

  // The action itself already succeeded by the time the server answers — only
  // the courtesy email to the administrator may have failed. Say so rather than
  // reporting a plain success the super admin would read as "they were told".
  const reportOutcome = (data, successMsg) => {
    if (data?.notified === false) {
      toast.warning(`${successMsg} The notification email could not be sent.`);
    } else {
      showSuccess(successMsg);
    }
  };

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
      const data = await deactivateAdministrator(id);
      reportOutcome(data, "Administrator deactivated.");
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
      const data = await reactivateAdministrator(id);
      reportOutcome(data, "Administrator reactivated successfully.");
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
      const data = await deleteAdministrator(id);
      reportOutcome(data, "Administrator permanently deleted");
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
      username: admin.username || "",
      email: admin.email || "",
    });
    setEditModal(admin);
  };

  const handleEditSave = async () => {
    if (!editForm.username.trim()) {
      showError("Username is required");
      return;
    }
    const email = editForm.email.trim();
    // Email is optional — an account may have none linked yet. Shape is checked
    // server-side by validateEmail; this is just an early, friendlier catch.
    if (email && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) {
      showError("Please enter a valid email address");
      return;
    }
    setActionLoading(true);
    try {
      const data = await updateAdministrator(editModal.id, {
        username: editForm.username.trim(),
        email,
      });
      // The change is saved either way; only the notice may have failed.
      reportOutcome(data, "Administrator updated successfully.");
      setEditModal(null);
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to update administrator");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Reset Password ───────────────────────────────────────────
  const handleResetOpen = (admin) => {
    setResetForm({ password: "", confirm: "" });
    setConfirmReset(false);
    setResetModal(admin);
  };

  // Step 1: validate the typed temporary password, then confirm.
  const handleResetSubmit = () => {
    if (!resetForm.password) {
      showError("Enter a temporary password");
      return;
    }
    if (!isValidPassword(resetForm.password)) {
      showError(
        "Password must be at least 8 characters and include a letter and a number",
      );
      return;
    }
    if (resetForm.password !== resetForm.confirm) {
      showError("Passwords do not match");
      return;
    }
    setConfirmReset(true);
  };

  // Step 2: apply it.
  const confirmResetPassword = async () => {
    setActionLoading(true);
    try {
      const data = await resetAdministratorPassword(
        resetModal.id,
        resetForm.password,
      );
      setConfirmReset(false);
      setResetModal(null);
      setResetForm({ password: "", confirm: "" });
      if (data?.has_email && data?.notified === false) {
        toast.warning(
          "Password reset, but the notification email could not be sent.",
        );
      } else {
        showSuccess(
          "Password reset. Give the temporary password to the administrator directly.",
        );
      }
      fetchTabData();
    } catch (err) {
      showError(err.response?.data?.message || "Failed to reset password");
      setConfirmReset(false);
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
            className="py-10 text-center text-sm"
            style={{ color: C.muted }}
          >
            No records found
          </td>
        </tr>
      );
    }

    return paginatedAdmins.map((u, i) => (
      <tr
        key={u.id}
        className="border-t row-interactive list-item-in text-sm"
        style={{
          borderTop: `1px solid ${C.border}`,
          ...listStagger(i),
        }}
      >
        <td
          className="px-5 py-3.5 font-mono"
          style={{ color: C.muted, fontSize: 15 }}
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
        <td className="px-5 py-3.5" style={{ color: C.muted, fontSize: 15 }}>
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
              <span style={{ color: C.muted, fontSize: 15 }}>—</span>
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="page-title">
            Manage Administrators
          </h2>
          <p className="page-subtitle">
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
            fontSize: "var(--type-body)",
            fontWeight: 600,
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard index={i} key={i} />
          ))}
        </div>
      ) : statsError ? (
        <div
          className="mb-6 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
          style={{ background: "#fef2f2", border: "1px solid #fecaca" }}
        >
          <p className="text-sm" style={{ color: "#b91c1c" }}>
            Could not load the administrator counts. The list below is unaffected.
          </p>
          <button
            onClick={fetchStats}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
            style={{ background: "#b91c1c", color: "#fff" }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard index={0}
            title="Total Administrators"
            value={stats?.total}
            icon={Users}
            color="bg-blue-900"
          />
          <StatCard index={1}
            title="Active"
            value={stats?.active}
            icon={Check}
            color="bg-green-500"
          />
          <StatCard index={2}
            title="Deactivated"
            value={stats?.deactivated}
            icon={UserX}
            color="bg-red-500"
          />
          <StatCard index={3}
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
          <div className="table-scroll" role="region" aria-label="Administrators table" tabIndex={0}>
            <table className="data-table table-text text-left" style={{ minWidth: 800 }}>
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
                <TableSkeletonRows rows={5} columns={ADMIN_SKELETON_COLUMNS} />
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="table-scroll" role="region" aria-label="Administrators table" tabIndex={0}>
              <table className="data-table table-text text-left" style={{ minWidth: 800 }}>
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
        <AppModal
          title="Administrator Details"
          onClose={() => setEditModal(null)}
          onEnter={() => { if (!actionLoading) handleEditSave(); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditModal(null)}>
                Cancel
              </Button>
              <Button onClick={handleEditSave} loading={actionLoading}>
                {actionLoading ? "Saving..." : "Save Changes"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Username
              </label>
              <input
                type="text"
                value={editForm.username}
                onChange={(e) =>
                  setEditForm({ ...editForm, username: e.target.value })
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
                Email
              </label>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm({ ...editForm, email: e.target.value })
                }
                placeholder="No email linked yet"
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
              />
              <p className="text-[13px] mt-1" style={{ color: C.muted }}>
                Changing this notifies the administrator at both the old and the
                new address.
              </p>
            </div>
            {/* Password is display-only — it is never typed into this form. */}
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Password
              </label>
              <div
                className="w-full border rounded-xl px-3 py-2 flex items-center justify-between gap-3"
                style={{ borderColor: C.border, background: "#f9fafb" }}
              >
                <span
                  className="text-sm tracking-[0.3em] select-none"
                  style={{ color: C.muted }}
                >
                  ••••••••
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const target = editModal;
                    setEditModal(null);
                    handleResetOpen(target);
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition whitespace-nowrap"
                  style={{ background: C.orange + "18", color: C.orange }}
                >
                  <KeyRound size={13} />
                  Reset Password
                </button>
              </div>
            </div>
          </div>
        </AppModal>
      )}

      {/* Create Administrator Modal */}
      {createModal && (
        <AppModal
          title="Create Administrator"
          onClose={() => setCreateModal(false)}
          onEnter={() => { if (!actionLoading) handleCreateAdmin(); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreateModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateAdmin} loading={actionLoading}>
                Create
              </Button>
            </>
          }
        >
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
              <p className="text-[13px] mt-1" style={{ color: C.muted }}>
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
          </div>
        </AppModal>
      )}

      {/* Create Confirmation Dialog */}
      {confirmCreate && (
        <AppModal
          title="Confirm Administrator Creation"
          onClose={() => setConfirmCreate(false)}
          onEnter={() => { if (!actionLoading) confirmCreateAdmin(); }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmCreate(false)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button onClick={confirmCreateAdmin} loading={actionLoading}>
                {actionLoading ? "Creating..." : "Confirm & Create"}
              </Button>
            </>
          }
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
          </div>
        </AppModal>
      )}

      {/* Reset Password Modal */}
      {resetModal && !confirmReset && (
        <AppModal
          title="Reset Password"
          onClose={() => setResetModal(null)}
          onEnter={() => { if (!actionLoading) handleResetSubmit(); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetModal(null)}>
                Cancel
              </Button>
              <Button onClick={handleResetSubmit} loading={actionLoading}>
                Reset Password
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm leading-relaxed" style={{ color: "#4b5563" }}>
              Set a temporary password for{" "}
              <strong style={{ color: C.text }}>{resetModal.username}</strong>.
              Give it to them directly — they will be asked to choose their own
              username and password the next time they sign in.
            </p>
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Temporary Password
              </label>
              <input
                type="password"
                value={resetForm.password}
                onChange={(e) =>
                  setResetForm({ ...resetForm, password: e.target.value })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
              />
              <p className="text-[13px] mt-1" style={{ color: C.muted }}>
                At least 8 characters, including a letter and a number.
              </p>
            </div>
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "#4b5563" }}
              >
                Confirm Temporary Password
              </label>
              <input
                type="password"
                value={resetForm.confirm}
                onChange={(e) =>
                  setResetForm({ ...resetForm, confirm: e.target.value })
                }
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{
                  borderColor: C.border,
                  background: C.surface,
                  color: C.text,
                }}
              />
            </div>
          </div>
        </AppModal>
      )}

      {/* Reset Password Confirmation */}
      {resetModal && confirmReset && (
        <AppModal
          title="Confirm Password Reset"
          onClose={() => setConfirmReset(false)}
          onEnter={() => { if (!actionLoading) confirmResetPassword(); }}
          footer={
            <>
              {/* "Back" rather than "Cancel" — this steps back to the password
                  form, it does not dismiss the whole flow. */}
              <Button
                variant="secondary"
                onClick={() => setConfirmReset(false)}
                disabled={actionLoading}
              >
                Back
              </Button>
              <Button onClick={confirmResetPassword} loading={actionLoading}>
                {actionLoading ? "Resetting..." : "Confirm Reset"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed" style={{ color: "#4b5563" }}>
              Reset the password for{" "}
              <strong style={{ color: C.text }}>{resetModal.username}</strong>?
              Their current password stops working immediately. They sign in with
              the temporary password and are asked to set their own password
              before they can continue.
              {!resetModal.email &&
                " Because this account has no linked email yet, they will also be asked to link one."}
            </p>
            {resetModal.email && (
              <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>
                They will be notified at {maskEmail(resetModal.email)}. For
                security, the temporary password is not included in that email —
                give it to them yourself.
              </p>
            )}
          </div>
        </AppModal>
      )}
    </div>
  );
};

export default ManageAdministrators;
