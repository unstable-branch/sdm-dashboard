"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useRouter } from "next/navigation";
import { Settings, LogOut, Key, User } from "lucide-react";

export function UserMenu() {
  const router = useRouter();
  const { user, clearAuth, projects, project, setProject } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) {
    return (
      <button
        onClick={() => router.push("/login")}
        className="rounded-md bg-sdm-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sdm-accent/90 transition-colors"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="font-medium">{user.name || user.email}</span>
        <span className="text-sdm-muted">({user.role})</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border border-sdm-border bg-sdm-surface shadow-lg z-50" role="menu">
          <div className="p-3 border-b border-sdm-border">
            <p className="text-sm font-medium text-sdm-heading">{user.name || user.email}</p>
            <p className="text-xs text-sdm-muted">{user.email}</p>
          </div>

          {projects.length > 1 && (
            <div className="p-3 border-b border-sdm-border">
              <label className="text-xs font-medium text-sdm-muted mb-1 block">Project</label>
              <select
                value={project?.id || ""}
                onChange={(e) => {
                  const p = projects.find((p) => p.id === e.target.value);
                  if (p) setProject(p);
                }}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="p-2">
            <button
              onClick={() => { router.push("/settings"); setIsOpen(false); }}
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-sdm-text hover:bg-sdm-surface-soft transition-colors"
              role="menuitem"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </button>
            <button
              onClick={() => { router.push("/settings?tab=api-keys"); setIsOpen(false); }}
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-sdm-text hover:bg-sdm-surface-soft transition-colors"
              role="menuitem"
            >
              <Key className="h-3.5 w-3.5" />
              API Keys
            </button>
            <button
              onClick={() => { clearAuth(); router.push("/login"); setIsOpen(false); }}
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
              role="menuitem"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
