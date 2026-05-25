import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  avatarUrl: string | null;
  bio: string | null;
  organization: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
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
  updateProfile: (profile: Partial<User>) => void;
  hydrateProfile: (profile: Partial<User>) => void;
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
      updateProfile: (profile) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...profile } : null,
        })),
      hydrateProfile: (profile) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...profile } : null,
        })),
    }),
    {
      name: "sdm-auth",
      partialize: (state) => ({
        user: state.user,
        token: null,
        project: state.project,
        projects: state.projects,
      }),
    }
  )
);
