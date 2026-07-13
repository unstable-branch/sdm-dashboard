"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPut, apiDelete } from "@/services/api";
import { Loader2, Key, CheckCircle2, AlertTriangle, Trash2, Eye, EyeOff, Plus } from "lucide-react";

interface ServiceKey {
  key: string;
  configured: boolean;
  displayValue: string;
  sensitive: boolean;
  updatedAt: string;
}

const KEY_METADATA: Record<string, { label: string; description: string; docs?: string }> = {
  "service.open_topography_api_key": {
    label: "OpenTopography",
    description: "Free elevation data service. Register at opentopography.org for a free API key.",
    docs: "https://opentopography.org",
  },

};

const KNOWN_KEYS = Object.keys(KEY_METADATA);

export default function AdminKeysPage() {
  const [keys, setKeys] = useState<ServiceKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ServiceKey[]>("/api/v1/admin/system/secrets");
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchKeys is stable (useCallback with [] deps)
    fetchKeys();
  }, [fetchKeys]);

  const handleSave = async (key: string) => {
    setSaving(key);
    setSaveSuccess(null);
    try {
      await apiPut(`/api/v1/admin/system/secrets/${encodeURIComponent(key)}`, { value: editValue });
      setSaveSuccess(key);
      setEditing(null);
      setEditValue("");
      setTimeout(() => setSaveSuccess(null), 2000);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Remove ${KEY_METADATA[key]?.label || key} key?`)) return;
    try {
      await apiDelete(`/api/v1/admin/system/secrets/${encodeURIComponent(key)}`);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete key");
    }
  };

  const handleReveal = async (key: string, isSensitive: boolean) => {
    if (revealed.has(key)) {
      setRevealed((prev) => { const next = new Set(prev); next.delete(key); return next; });
      return;
    }
    try {
      const data = await apiGet<{ value: string; sensitive: boolean }>(
        `/api/v1/admin/system/secrets/${encodeURIComponent(key)}?raw=1`
      );
      setEditValue(data.value);
      setRevealed((prev) => { const next = new Set(prev); next.add(key); return next; });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reveal key");
    }
  };

  const getStatus = (key: ServiceKey) => {
    if (!key.configured) return { dot: "bg-gray-500", label: "Not configured" };
    return { dot: "bg-green-500", label: "Configured" };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">API Keys</h1>
        <p className="text-sm text-sdm-muted mt-1">
          Manage third-party service API keys. Sensitive keys (marked with 🔒) are
          encrypted at rest using AES-256-GCM.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="flex items-center gap-2 rounded-md border border-sdm-success/30 bg-sdm-success/5 p-3 text-sm text-sdm-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Key saved successfully</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-muted" />
        </div>
      ) : (
        <div className="space-y-4">
          {KNOWN_KEYS.map((knownKey) => {
            const meta = KEY_METADATA[knownKey];
            const key = keys.find((k) => k.key === knownKey) || {
              key: knownKey,
              configured: false,
              displayValue: "",
              sensitive: knownKey.startsWith("secret."),
              updatedAt: "",
            };
            const status = getStatus(key);
            const isEditing = editing === knownKey;
            const isSaving = saving === knownKey;
            const isRevealed = revealed.has(knownKey);

            return (
              <div key={knownKey} className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sdm-surface-soft text-lg">
                      {key.sensitive ? "🔒" : "🔑"}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-sdm-heading">{meta.label}</h3>
                      <p className="text-xs text-sdm-muted mt-0.5">{meta.description}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    <input
                      type={isRevealed ? "text" : "password"}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder={key.sensitive ? "Enter sensitive key..." : "Enter API key..."}
                      className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSave(knownKey)}
                        disabled={isSaving || !editValue}
                        className="inline-flex items-center gap-1.5 rounded-md bg-sdm-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 transition-colors"
                      >
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Save
                      </button>
                      <button
                        onClick={() => { setEditing(null); setEditValue(""); setRevealed(new Set()); }}
                        className="rounded-md border border-sdm-border/50 px-3 py-1.5 text-xs font-medium text-sdm-muted hover:text-sdm-text transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setEditing(knownKey)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border/50 px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      {key.configured ? "Update" : "Set Key"}
                    </button>
                    {key.configured && (
                      <>
                        <button
                          onClick={() => { setEditing(knownKey); handleReveal(knownKey, key.sensitive); }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border/50 px-3 py-1.5 text-xs font-medium text-sdm-muted hover:text-sdm-text transition-colors"
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </button>
                        <button
                          onClick={() => handleDelete(knownKey)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border/50 px-3 py-1.5 text-xs font-medium text-sdm-muted hover:text-sdm-danger transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </>
                    )}
                    {key.configured && key.displayValue && (
                      <span className="text-xs text-sdm-muted font-mono ml-2">{key.displayValue}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-4 text-xs text-sdm-muted space-y-1">
            <p className="font-medium text-sdm-text">About cached covariate data</p>
            <p>
              Downloaded covariate layers (elevation, soil, vegetation, etc.) are cached on the
              server and shared across all users. All currently supported data sources are public
              domain or open-access, so per-user data isolation is not needed.
            </p>
            <p>
              API keys you provide are used only for rate-limiting and access purposes &mdash;
              your key is not stored with the cached tiles, and other users benefit from tiles
              already downloaded by any key.
            </p>
          </div>
          <p className="text-xs text-sdm-muted text-center pt-2">
            API keys are stored in the database. Keys prefixed with{" "}
            <code className="text-sdm-text">secret.</code> are encrypted at rest.
            Keys prefixed with <code className="text-sdm-text">service.</code> are stored as plaintext.
          </p>
        </div>
      )}
    </div>
  );
}
