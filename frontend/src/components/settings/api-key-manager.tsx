"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { Key, Plus, Trash2, Copy, CheckCircle2, AlertTriangle } from "lucide-react";

interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export function ApiKeyManager() {
  const { token } = useAuthStore();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    try {
      const res = await fetch("/api/v1/auth/api-keys", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setKeys(await res.json());
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setError(null);

    try {
      const res = await fetch("/api/v1/auth/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newKeyName,
          expiresAt: newKeyExpiry || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create key");

      setShowNewKey(data.key);
      setNewKeyName("");
      setNewKeyExpiry("");
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/auth/api-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== id));
      }
    } catch {
      // Silently fail
    }
  };

  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Key className="h-5 w-5 text-sdm-accent" />
        <h2 className="text-lg font-semibold text-sdm-heading">API Keys</h2>
      </div>

      {showNewKey && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-400">Copy your API key now</p>
              <p className="text-xs text-sdm-muted">This key will not be shown again</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 rounded-md bg-sdm-surface-soft px-3 py-2 text-xs font-mono text-sdm-text">
              {showNewKey}
            </code>
            <button
              onClick={() => handleCopy(showNewKey)}
              className="rounded-md px-3 py-2 text-xs text-sdm-accent hover:bg-sdm-accent/10 transition-colors"
            >
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
        <h3 className="text-sm font-medium text-sdm-heading">Create new key</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g., CI/CD, Scripts)"
            className="flex-1 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
          />
          <input
            type="date"
            value={newKeyExpiry}
            onChange={(e) => setNewKeyExpiry(e.target.value)}
            className="rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
          />
          <button
            onClick={handleCreate}
            disabled={!newKeyName.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-sdm-muted">Loading API keys...</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-sdm-muted">No API keys yet. Create one to get started.</p>
      ) : (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-sdm-border">
                <th className="text-left px-4 py-2 font-medium text-sdm-muted">Name</th>
                <th className="text-left px-4 py-2 font-medium text-sdm-muted">Created</th>
                <th className="text-left px-4 py-2 font-medium text-sdm-muted">Last used</th>
                <th className="text-left px-4 py-2 font-medium text-sdm-muted">Expires</th>
                <th className="text-right px-4 py-2 font-medium text-sdm-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-sdm-border/50">
                  <td className="px-4 py-2 text-sdm-text font-medium">{key.name}</td>
                  <td className="px-4 py-2 text-sdm-muted">{new Date(key.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-sdm-muted">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}</td>
                  <td className="px-4 py-2 text-sdm-muted">{key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "Never"}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="text-red-400 hover:text-red-300 transition-colors"
                      aria-label={`Delete API key ${key.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
