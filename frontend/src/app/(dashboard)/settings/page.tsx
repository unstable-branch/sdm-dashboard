"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Database, Cloud, HardDrive } from "lucide-react";

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

  useEffect(() => {
    Promise.all([
      fetch("/health").then((res) => res.json()).catch(() => null),
      fetch("/api/v1/sdm/config/defaults").then((res) => res.json()).catch(() => null),
    ]).then(([h, d]) => {
      setHealth(h);
      setDefaults(d);
      setLoading(false);
    });
  }, []);

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <Database className="h-4 w-4 text-sdm-accent" />
            Service status
          </h3>
          {health && (
            <div className="space-y-2">
              {Object.entries(health.services).map(([service, status]) => {
                const s = serviceStatus(status);
                return (
                  <div key={service} className="flex items-center justify-between text-sm">
                    <span className="text-sdm-text capitalize">{service}</span>
                    <span className={`flex items-center gap-1.5 ${s.color}`}>
                      {s.icon} {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <Cloud className="h-4 w-4 text-sdm-accent" />
            Climate defaults
          </h3>
          {defaults && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-sdm-muted">Default BIO variables</span>
                <span className="text-sdm-text font-mono">{defaults.biovars?.join(", ") || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sdm-muted">Background points</span>
                <span className="text-sdm-text">{defaults.background_n?.toLocaleString() || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sdm-muted">CV folds</span>
                <span className="text-sdm-text">{defaults.cv_folds || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sdm-muted">CV strategy</span>
                <span className="text-sdm-text">{defaults.cv_strategy || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sdm-muted">Threshold</span>
                <span className="text-sdm-text">{defaults.threshold || "—"}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-sdm-accent" />
            Storage
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-sdm-muted">Object storage</span>
              <span className="text-sdm-text">Garage (S3-compatible)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sdm-muted">Database</span>
              <span className="text-sdm-text">PostgreSQL 16 + PostGIS</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sdm-muted">Job queue</span>
              <span className="text-sdm-text">Redis 7 + BullMQ</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
          <h3 className="text-sm font-semibold text-sdm-heading">Extent presets</h3>
          {defaults?.extent_presets && (
            <div className="space-y-1 text-sm">
              {Object.entries(defaults.extent_presets).map(([key, extent]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-sdm-muted capitalize">{key.replace("_", " ")}</span>
                  <span className="text-sdm-text font-mono text-xs">{extent.join(", ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
