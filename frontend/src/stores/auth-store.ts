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
  error: string | null;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  setProject: (project: { id: string; name: string; role: string }) => void;
  setProjects: (projects: Array<{ id: string; name: string; role: string }>) => void;
  updateProfile: (profile: Partial<User>) => void;
  setError: (error: string | null) => void;
}

function writeStorageToken(token: string, remember = true) {
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem("sdm_token", token);
  if (typeof document !== "undefined") {
    const maxAge = remember ? "; Max-Age=86400" : "";
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `sdm_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax${maxAge}${secure}`;
  }
}

function clearStorageToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("sdm_token");
    sessionStorage.removeItem("sdm_token");
    document.cookie = "sdm_token=; Path=/; SameSite=Lax; Max-Age=0";
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      project: null,
      projects: [],
      error: null,
      setAuth: (user, token) => {
        writeStorageToken(token, true);
        set({ user, token, error: null });
      },
      clearAuth: () => {
        clearStorageToken();
        set({ user: null, token: null, project: null, projects: [], error: null });
      },
      setProject: (project) => set({ project }),
      setProjects: (projects) => set({ projects }),
      setError: (error) => set({ error }),
      updateProfile: (profile) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...profile } : null,
        })),
    }),
    {
      name: "sdm-auth",
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        project: state.project,
        projects: state.projects,
      }),
    }
  )
);
