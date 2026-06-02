"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiDelete, apiPut } from "@/services/api";
import type { Project } from "@/services/types";
import { Loader2, Plus, Pencil, Trash2, Users } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CardSkeleton } from "@/components/ui/skeleton";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Project[]>("/api/v1/projects");
      setProjects(data);
    } catch {
      // Projects may not be available yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setFormLoading(true);
    setError(null);

    try {
      if (editingProject) {
        await apiPut(`/api/v1/projects/${editingProject.id}`, { name, description });
      } else {
        await apiPost("/api/v1/projects", { name, description });
      }
      setName("");
      setDescription("");
      setShowCreate(false);
      setEditingProject(null);
      fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save project");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiDelete(`/api/v1/projects/${deleteTarget}`);
      fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeleteTarget(null);
    }
  };

  const startEdit = (project: Project) => {
    setEditingProject(project);
    setName(project.name);
    setDescription(project.description || "");
    setShowCreate(true);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Projects</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sdm-heading">Projects</h1>
          <p className="text-sdm-muted mt-1">Manage your SDM projects and collaborate with team members.</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditingProject(null); setName(""); setDescription(""); }}
          className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90"
        >
          <Plus className="h-4 w-4" /> New Project
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
          <h2 className="text-sm font-semibold text-sdm-heading mb-3">
            {editingProject ? "Edit project" : "Create project"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
                placeholder="Project name"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:outline-none focus:ring-1 focus:ring-sdm-accent/50"
                placeholder="Optional description"
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={formLoading || !name.trim()}
                className="rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50"
              >
                {formLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingProject ? "Save" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setEditingProject(null); }}
                className="rounded-md border border-sdm-border px-4 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center">
          <Users className="h-10 w-10 text-sdm-muted mx-auto mb-3" />
          <p className="text-sm font-medium text-sdm-heading">No projects yet</p>
          <p className="text-xs text-sdm-muted mt-1">Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <div key={project.id} className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-sdm-heading">{project.name}</h3>
                  {project.description && (
                    <p className="text-xs text-sdm-muted mt-1 line-clamp-2">{project.description}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  project.role === "owner" ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"
                }`}>
                  {project.role}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-sdm-muted">
                <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => startEdit(project)}
                    className="p-1 rounded hover:bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text"
                    aria-label="Edit project"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {project.role === "owner" && (
                    <button
                      onClick={() => handleDelete(project.id)}
                      className="p-1 rounded hover:bg-red-500/10 text-sdm-muted hover:text-red-400"
                      aria-label="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete project"
        message="Delete this project? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
