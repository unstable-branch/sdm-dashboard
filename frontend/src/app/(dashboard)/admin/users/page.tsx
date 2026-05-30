"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/services/api";
import { Loader2, Search, Plus, Trash2, Edit3, Key, X } from "lucide-react";

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "create" | "edit" | "reset"; user?: UserRecord } | null>(null);

  const limit = 25;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const data = await apiGet<{ users: UserRecord[]; total: number }>(`/api/v1/admin/users?${params}`);
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this user?")) return;
    try {
      await apiDelete(`/api/v1/admin/users/${id}`);
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-sdm-heading">User Management</h1>
        <button onClick={() => setModal({ type: "create" })}
          className="rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sdm-muted" />
          <input type="text" value={searchInput} onChange={(e) => {
            setSearchInput(e.target.value);
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
            searchTimerRef.current = setTimeout(() => {
              setSearch(e.target.value);
              setPage(1);
            }, 300);
          }}
            placeholder="Search by email..." className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft pl-9 pr-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50" />
        </div>
      </div>

      {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>
      ) : (
        <>
          <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-sdm-border bg-sdm-surface-soft">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Created</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-sdm-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-sdm-border hover:bg-sdm-surface-soft">
                    <td className="px-4 py-2 text-sdm-text">{u.name || "-"}</td>
                    <td className="px-4 py-2 text-sdm-text">{u.email}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${u.role === "admin" ? "bg-sdm-accent/20 text-sdm-accent" : u.role === "editor" ? "bg-sdm-accent-blue/20 text-sdm-accent-blue" : "bg-sdm-surface-soft text-sdm-muted"}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-sdm-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setModal({ type: "edit", user: u })}
                          className="rounded p-1 text-sdm-muted hover:text-sdm-text hover:bg-sdm-surface-soft"><Edit3 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setModal({ type: "reset", user: u })}
                          className="rounded p-1 text-sdm-muted hover:text-sdm-accent hover:bg-sdm-surface-soft"><Key className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(u.id)}
                          className="rounded p-1 text-sdm-muted hover:text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-sdm-muted">
            <span>{total} users total</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Previous</button>
              <button onClick={() => setPage(page + 1)} disabled={page * limit >= total}
                className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Next</button>
            </div>
          </div>
        </>
      )}

      {modal && <UserModal modal={modal} onClose={() => setModal(null)} onSaved={fetchUsers} />}
    </div>
  );
}

function UserModal({ modal, onClose, onSaved }: { modal: { type: "create" | "edit" | "reset"; user?: UserRecord }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(modal.user?.name || "");
  const [email, setEmail] = useState(modal.user?.email || "");
  const [role, setRole] = useState(modal.user?.role || "viewer");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isReset = modal.type === "reset";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      if (modal.type === "create") {
        await apiPost("/api/v1/admin/users", { email, password, name, role });
      } else if (modal.type === "edit" && modal.user) {
        await apiPut(`/api/v1/admin/users/${modal.user.id}`, { name, email, role });
      } else if (modal.type === "reset" && modal.user) {
        await apiPost(`/api/v1/admin/users/${modal.user.id}/reset-password`, { password });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-sdm-heading">
            {isReset ? "Reset Password" : modal.type === "create" ? "Add User" : "Edit User"}
          </h3>
          <button onClick={onClose} className="text-sdm-muted hover:text-sdm-text"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {!isReset && (
            <>
              <div><label className="block text-xs font-medium text-sdm-muted mb-1">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50" /></div>
              <div><label className="block text-xs font-medium text-sdm-muted mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50" /></div>
              <div><label className="block text-xs font-medium text-sdm-muted mb-1">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select></div>
            </>
          )}
          {(modal.type === "create" || isReset) && (
            <div><label className="block text-xs font-medium text-sdm-muted mb-1">{isReset ? "New Password" : "Password"}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50" /></div>
          )}
          {err && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-400">{err}</div>}
          <button type="submit" disabled={saving}
            className="w-full rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50">
            {saving ? "Saving..." : isReset ? "Reset Password" : modal.type === "create" ? "Create User" : "Save Changes"}
          </button>
        </form>
      </div>
    </div>
  );
}