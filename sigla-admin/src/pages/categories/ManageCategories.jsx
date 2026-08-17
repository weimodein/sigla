import { useState, useEffect } from "react";
import AppModal from "../../components/AppModal.jsx";
import Button from "../../components/Button.jsx";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../../api/categoryApi.js";
import { useToast } from "../../context/ToastContext.jsx";
import {
  Plus,
  Pencil,
  Trash2,
  Tag,
  Check,
  AlertCircle,
} from "lucide-react";

const C = {
  primary: "#1e3a8a",
  border: "#e5e7eb",
  muted: "#9ca3af",
  green: "#22c55e",
  red: "#ef4444",
};

// ── Stat Card ─────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="dash-stat-card flex items-center gap-4">
    <div className={`p-3 rounded-full ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

const SkeletonCard = () => (
  <div className="dash-stat-card flex items-center gap-4">
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-10 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

const CategoryFormModal = ({ open, onClose, onSubmit, initial, title, submitLabel }) => {
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: initial?.name || "", description: initial?.description || "" });
    }
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      title={title}
      onClose={onClose}
      onEnter={() => { if (!saving && form.name.trim()) handleSubmit(); }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            loading={saving}
            disabled={!form.name.trim()}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
        <div>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Name *</label>
          {/* maxLength matches Category.name's VARCHAR(50) so the limit is visible
              instead of arriving as a 500. Enter-to-submit is handled modal-wide by
              AppModal's onEnter. */}
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            maxLength={50}
            placeholder="e.g. greeting, food, color"
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151" }}>Description</label>
          <textarea
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3}
            style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "0.875rem", marginTop: "4px", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>
      </div>
    </AppModal>
  );
};

const PAGE_SIZE = 10;

const ManageCategories = () => {
  const { success, error: errorToast } = useToast();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await getCategories();
      setCategories(data.categories || []);
    } catch {
      errorToast("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCategories(); }, []);

  // Keep the current page valid as the list changes.
  const totalPages = Math.max(1, Math.ceil(categories.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const paginatedCategories = categories.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  // Summary counts derived from the category list already in state — each row
  // carries word_count from the API, so no extra request is needed.
  const inUseCount = categories.filter((c) => c.word_count > 0).length;
  const emptyCount = categories.length - inUseCount;

  const handleAdd = async (form) => {
    try {
      await createCategory(form);
      success(`Category "${form.name}" created`);
      setAddOpen(false);
      fetchCategories();
    } catch (err) {
      errorToast(err.response?.data?.message || "Failed to create");
    }
  };

  const handleEdit = async (form) => {
    try {
      await updateCategory(editTarget.id, form);
      success(`Category updated`);
      setEditTarget(null);
      fetchCategories();
    } catch (err) {
      errorToast(err.response?.data?.message || "Failed to update");
    }
  };

  const handleDelete = async () => {
    // Guard against a double-click: without the flag a second call fires while
    // the first is in flight, 404s, and shows "not found" AFTER the delete
    // actually succeeded.
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteCategory(deleteTarget.id);
      success(`Category "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      fetchCategories();
    } catch (err) {
      errorToast(err.response?.data?.message || "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1f2937", margin: 0 }}>
            Manage Categories
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#6b7280", margin: "4px 0 0" }}>
            Organize words into categories
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "8px 16px", background: C.primary, color: "white",
            border: "none", borderRadius: "8px",
            fontSize: "0.85rem", fontWeight: 500, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <Plus size={16} /> Add Category
        </button>
      </div>

      {/* ── Summary cards ── */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard
            title="Total Categories"
            value={categories.length}
            icon={Tag}
            color="bg-blue-900"
          />
          <StatCard
            title="In Use"
            value={inUseCount}
            icon={Check}
            color="bg-green-500"
          />
          <StatCard
            title="Empty"
            value={emptyCount}
            icon={AlertCircle}
            color="bg-gray-500"
          />
        </div>
      )}

      {/* Table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "white",
          border: `1px solid ${C.border}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 600, fontSize: "0.875rem" }}>
            <thead style={{ background: "#f9fafb" }}>
              <tr>
                {["Name", "Description", "Words", "Actions"].map(h => (
                  <th key={h} className="px-5 py-3">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>{h}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ textAlign: "center", padding: "40px", color: C.muted }}>Loading...</td></tr>
              ) : categories.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: "center", padding: "40px", color: C.muted }}>No categories yet. Add your first one.</td></tr>
              ) : paginatedCategories.map(cat => (
                <tr key={cat.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td className="px-5 py-3" style={{ fontWeight: 600, color: "#1f2937", textTransform: "capitalize" }}>{cat.name}</td>
                  <td className="px-5 py-3" style={{ color: "#6b7280" }}>{cat.description || "—"}</td>
                  <td className="px-5 py-3" style={{ color: "#374151" }}>
                    <span style={{ padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 600,
                      background: cat.word_count > 0 ? "#eff6ff" : "#f3f4f6",
                      color: cat.word_count > 0 ? "#1e40af" : "#6b7280" }}>
                      {cat.word_count}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button title="Edit" onClick={() => setEditTarget(cat)}
                        style={{ padding: "6px", borderRadius: "6px", border: `1px solid ${C.border}`, background: "white", cursor: "pointer", display: "flex", alignItems: "center" }}>
                        <Pencil size={14} color="#374151" />
                      </button>
                      <button title="Delete" onClick={() => setDeleteTarget(cat)}
                        style={{ padding: "6px", borderRadius: "6px", border: `1px solid #fecaca`, background: "#fff5f5", cursor: "pointer", display: "flex", alignItems: "center" }}>
                        <Trash2 size={14} color={C.red} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && categories.length > PAGE_SIZE && (
          <div
            className="flex items-center justify-between px-5 py-3.5"
            style={{ borderTop: `1px solid ${C.border}`, fontSize: 13, color: "#6b7280" }}
          >
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, categories.length)} of {categories.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition"
                style={{ borderColor: C.border }}
              >
                Prev
              </button>
              <span className="px-3 font-medium" style={{ color: "#374151" }}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition"
                style={{ borderColor: C.border }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <CategoryFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
        title="Add Category"
        submitLabel="Create"
      />

      <CategoryFormModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={handleEdit}
        initial={editTarget}
        title="Edit Category"
        submitLabel="Save"
      />

      {deleteTarget && (
        <AppModal
          title="Delete Category"
          onClose={() => setDeleteTarget(null)}
          onEnter={() => {
            // Mirrors the Delete button's disabled state — a category still in
            // use cannot be deleted.
            if (!deleting && !(deleteTarget.word_count > 0)) handleDelete();
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                loading={deleting}
                disabled={deleteTarget.word_count > 0}
                title={deleteTarget.word_count > 0 ? "This category is still in use" : undefined}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </>
          }
        >
          <p style={{ fontSize: "0.9rem", color: "#374151", marginBottom: "12px" }}>
            Delete category <strong>"{deleteTarget.name}"</strong>?
          </p>
          {/* A category still in use cannot be deleted, so the button is
              disabled rather than offering an action that is guaranteed to fail
              (it used to say "the backend will block this deletion" and stay
              clickable). The rule is enforced server-side in
              categoryController.deleteCategory. */}
          {deleteTarget.word_count > 0 && (
            <p style={{ fontSize: "0.85rem", color: C.red }}>
              ⚠ This category is used by {deleteTarget.word_count} word(s). Move
              those words to another category, or delete them first.
            </p>
          )}
        </AppModal>
      )}
    </div>
  );
};

export default ManageCategories;
