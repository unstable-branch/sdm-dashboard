"use client";

import { useState, useEffect, useMemo } from "react";
import { apiGet, apiPut } from "@/services/api";
import { Loader2, Save } from "lucide-react";

interface SystemSetting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export default function AdminSystemPage() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        const s = await apiGet<SystemSetting[]>("/api/v1/admin/system/settings");
        setSettings(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  async function saveSetting(key: string) {
    const value = edits[key];
    if (value === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setError("Invalid JSON value for " + key);
      return;
    }
    setSaving(key);
    try {
      await apiPut("/api/v1/admin/system/settings", { key, value: parsed });
      setSuccess(`Saved ${key}`);
      setTimeout(() => setSuccess(null), 3000);
      const s = await apiGet<SystemSetting[]>("/api/v1/admin/system/settings");
      setSettings(s);
      setEdits((prev) => { const next = { ...prev }; delete next[key]; return next; });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  const groups = {
    General: ["site_name", "maintenance_mode", "default_theme"],
    Auth: ["jwt_expiry_seconds", "max_login_attempts", "api_key_default_expiry_days"],
    Climate: ["default_climate_source", "default_climate_resolution"],
    Model: ["default_model", "default_biovars", "default_cv_strategy", "default_cv_k", "default_background_points"],
    UI: ["default_page_size"],
    "Rate Limiting": ["rate_limit_public", "rate_limit_auth"],
  };

  const getValue = (setting: SystemSetting) => {
    if (edits[setting.key] !== undefined) return edits[setting.key];
    return typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value, null, 2);
  };

  const groupedSettings = useMemo(() => {
    const allKeys = Object.values(groups).flat();
    const grouped = Object.entries(groups).map(([group, keys]) => ({
      group,
      settings: settings.filter((s) => keys.includes(s.key)),
    }));
    const ungrouped = settings.filter((s) => !allKeys.includes(s.key));
    return { grouped, ungrouped };
  }, [groups, settings]);

  const allKeys = Object.values(groups).flat();

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-sdm-heading">System Settings</h1>

      {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>}
      {success && <div className="rounded-md bg-sdm-success/10 border border-sdm-success/30 p-3 text-sm text-sdm-success">{success}</div>}

      {groupedSettings.grouped.map(({ group, settings: groupSettings }) => (
        <div key={group} className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
          <h2 className="text-lg font-medium text-sdm-heading">{group}</h2>
          {groupSettings.map((setting) => (
            <div key={setting.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-sdm-text font-mono">{setting.key}</span>
                  {setting.description && <p className="text-xs text-sdm-muted mt-0.5">{setting.description}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <textarea value={getValue(setting)} onChange={(e) => setEdits({ ...edits, [setting.key]: e.target.value })}
                  rows={String(getValue(setting)).includes("{") ? 3 : 1}
                  className="flex-1 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm font-mono text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50 resize-none" />
                <button onClick={() => saveSetting(setting.key)} disabled={saving === setting.key}
                  className="rounded-md bg-sdm-accent px-3 py-2 text-xs font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 shrink-0">
                  {saving === setting.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Fallback: show any settings not in a defined group */}
      {groupedSettings.ungrouped.length > 0 && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
          <h2 className="text-lg font-medium text-sdm-heading">Other Settings</h2>
          <p className="text-xs text-sdm-muted">{groupedSettings.ungrouped.length} setting{groupedSettings.ungrouped.length !== 1 ? "s" : ""} not in any defined group</p>
          {groupedSettings.ungrouped.map((setting) => (
            <div key={setting.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-sdm-text font-mono">{setting.key}</span>
                  {setting.description && <p className="text-xs text-sdm-muted mt-0.5">{setting.description}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <textarea value={getValue(setting)} onChange={(e) => setEdits({ ...edits, [setting.key]: e.target.value })}
                  rows={String(getValue(setting)).includes("{") ? 3 : 1}
                  className="flex-1 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm font-mono text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50 resize-none" />
                <button onClick={() => saveSetting(setting.key)} disabled={saving === setting.key}
                  className="rounded-md bg-sdm-accent px-3 py-2 text-xs font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 shrink-0">
                  {saving === setting.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}