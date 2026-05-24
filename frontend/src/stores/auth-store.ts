import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  project: { id: string; name: string; role: string } | null;
  projects: Array<{ id: string; name: string; role: string }>;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  setProject: (project: { id: string; name: string; role: string }) => void;
  setProjects: (projects: Array<{ id: string; name: string; role: string }>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      project: null,
      projects: [],
      setAuth: (user, token) => set({ user, token }),
      clearAuth: () => set({ user: null, token: null, project: null, projects: [] }),
      setProject: (project) => set({ project }),
      setProjects: (projects) => set({ projects }),
    }),
    {
      name: "sdm-auth",
      // Exclude token from persistence — it's managed centrally in api.ts via sdm_token key
      // This prevents token duplication and sync issues between stores
      partialize: (state) => ({
        user: state.user,
        token: null,
        project: state.project,
        projects: state.projects,
      }),
    }
  )
);
