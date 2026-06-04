"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Database, Cloud, HardDrive, Globe, Key, Mail, User, Eye, EyeOff } from "lucide-react";
import { ApiKeyManager } from "@/components/settings/api-key-manager";
import { useSettingsStore } from "@/stores/settings-store";

interface HealthStatus {
  status: string;
  services: {
    plumber: string;
    redis: string;
  };
}

interface ConfigDefaults {
  biovars?: number[];
  background_n?: number;
  cv_folds?: number;
  cv_strategy?: string;
  threshold?: number;
  extent_presets?: Record<string, number[]>;
}

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [defaults, setDefaults] = useState<ConfigDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const settings = useSettingsStore((s) => s.settings);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [gbifUsername, setGbifUsername] = useState("");
  const [gbifPassword, setGbifPassword] = useState("");
  const [gbifEmail, setGbifEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingGbif, setSavingGbif] = useState(false);
  const [gbifSaved, setGbifSaved] = useState(false);
  const [gbifError, setGbifError] = useState<string | null>(null);
  const [hasGbifPassword, setHasGbifPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  useEffect(() => {
    const signal = AbortSignal.timeout(15000);
    Promise.all([
      fetch("/health", { signal }).then((res) => res.json()).catch(() => null),
      fetch("/api/v1/sdm/config/defaults", { signal }).then((res) => res.json()).catch(() => null),
    ]).then(([h, d]) => {
      setHealth(h);
      setDefaults(d);
      setLoading(false);
    });
  }, []);

  // Load GBIF credentials from settings
  useEffect(() => {
    if (!settings) fetchSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setGbifUsername(settings.gbifUsername || "");
      setGbifPassword(settings.hasGbifPassword ? "••••••••" : "");
      setHasGbifPassword(!!settings.hasGbifPassword);
      setGbifEmail(settings.gbifEmail || "");
    }
  }, [settings]);

  const handleSaveGbif = async () => {
    setSavingGbif(true);
    setGbifError(null);
    setGbifSaved(false);
    try {
      const updates: Record<string, unknown> = {
        gbifUsername: gbifUsername || null,
        gbifEmail: gbifEmail || null,
      };
      if (passwordChanged) {
        updates.gbifPassword = gbifPassword || null;
      }
      // If not changed and hasGbifPassword is true, don't send gbifPassword
      // backend keeps existing encrypted value
      await updateSettings(updates as any);
      setGbifSaved(true);
      setPasswordChanged(false);
      setHasGbifPassword(!!gbifPassword);
      setTimeout(() => setGbifSaved(false), 3000);
    } catch (err) {
      setGbifError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setSavingGbif(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Settings</h1>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      </div>
    );
  }

  const serviceStatus = (status: string) => {
    if (status === "ok" || status === "connected") return { color: "text-green-500", icon: <CheckCircle2 className="h-4 w-4" />, label: "Connected" };
    if (status === "unreachable" || status === "disconnected") return { color: "text-red-500", icon: <AlertCircle className="h-4 w-4" />, label: "Disconnected" };
    return { color: "text-sdm-muted", icon: <AlertCircle className="h-4 w-4" />, label: status };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Settings</h1>
        <p className="text-sdm-muted mt-1">System status, service connections, and default configuration.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <Database className="h-4 w-4 text-sdm-accent" />
            Service status
          </h3>
          {health && (
            <div className="space-y-2">
              {Object.entries(health.services).map(([service, status]) => {
                const s = serviceStatus(status);
                return (
                  <div key={service} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-sdm-text capitalize">{service}</span>
                    <span className={`flex shrink-0 items-center gap-1.5 ${s.color}`}>
                      {s.icon} {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <Cloud className="h-4 w-4 text-sdm-accent" />
            Climate defaults
          </h3>
          {defaults && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
                <span className="text-sdm-muted">Default BIO variables</span>
                <span className="break-words font-mono text-sdm-text sm:text-right">{defaults.biovars?.join(", ") || "—"}</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
                <span className="text-sdm-muted">Background points</span>
                <span className="text-sdm-text sm:text-right">{defaults.background_n?.toLocaleString() || "—"}</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
                <span className="text-sdm-muted">CV folds</span>
                <span className="text-sdm-text sm:text-right">{defaults.cv_folds || "—"}</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
                <span className="text-sdm-muted">CV strategy</span>
                <span className="text-sdm-text sm:text-right">{defaults.cv_strategy || "—"}</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
                <span className="text-sdm-muted">Threshold</span>
                <span className="text-sdm-text sm:text-right">{defaults.threshold || "—"}</span>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-sdm-accent" />
            Storage
          </h3>
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
              <span className="text-sdm-muted">Object storage</span>
              <span className="break-words text-sdm-text sm:text-right">Garage (S3-compatible)</span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
              <span className="text-sdm-muted">Database</span>
              <span className="break-words text-sdm-text sm:text-right">PostgreSQL 16 + PostGIS</span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
              <span className="text-sdm-muted">Job queue</span>
              <span className="break-words text-sdm-text sm:text-right">Redis 7 + BullMQ</span>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading">Extent presets</h3>
          {defaults?.extent_presets && (
            <div className="space-y-1 text-sm">
              {Object.entries(defaults.extent_presets).map(([key, extent]) => (
                <div key={key} className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
                  <span className="text-sdm-muted capitalize">{key.replace("_", " ")}</span>
                  <span className="break-all font-mono text-xs text-sdm-text sm:text-right">{Array.isArray(extent) ? extent.join(", ") : String(extent ?? "—")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">GBIF Credentials</h3>
            <p className="text-xs text-sdm-muted">
              Used for authenticated occurrence downloads with unlimited record limits.
              Your password is encrypted at rest.
            </p>
          </div>
        </div>

        {gbifError && (
          <div className="flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{gbifError}</span>
          </div>
        )}

        {gbifSaved && (
          <div className="flex items-center gap-2 rounded-md border border-sdm-success/30 bg-sdm-success/5 p-3 text-sm text-sdm-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>GBIF credentials saved</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-sdm-muted mb-1">
              <User className="h-3 w-3" /> Username
            </label>
            <input type="text" value={gbifUsername} onChange={(e) => setGbifUsername(e.target.value)}
              placeholder="GBIF username"
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted" />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-sdm-muted mb-1">
              <Key className="h-3 w-3" /> Password or API Key
            </label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={gbifPassword}
                onChange={(e) => { setGbifPassword(e.target.value); setPasswordChanged(true); }}
                onFocus={() => { if (!passwordChanged && hasGbifPassword) { setGbifPassword(""); } }}
                placeholder={hasGbifPassword && !passwordChanged ? "Saved password — click to change" : "GBIF password or API key"}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 pr-8 text-sm text-sdm-text placeholder:text-sdm-muted" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-sdm-muted hover:text-sdm-text">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {hasGbifPassword && !passwordChanged && (
              <p className="text-xs text-sdm-success flex items-center gap-1 mt-1">
                <CheckCircle2 className="h-3 w-3" /> Password saved
              </p>
            )}
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-sdm-muted mb-1">
              <Mail className="h-3 w-3" /> Email
            </label>
            <input type="email" value={gbifEmail} onChange={(e) => setGbifEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted" />
          </div>
        </div>

        <button onClick={handleSaveGbif} disabled={savingGbif}
          className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50">
          {savingGbif ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {savingGbif ? "Saving..." : "Save GBIF credentials"}
        </button>
      </div>

      <ApiKeyManager />
    </div>
  );
}
