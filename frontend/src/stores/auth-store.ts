import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clearSharedJobs } from "@/hooks/use-job-sse";

export interface User {
  id: string; email: string; name: string | null; role: string; avatarUrl: string | null; bio: string | null;
  organization: string | null; lastLoginAt: string | null; createdAt: string | null;
}
export type AuthStatus = "unknown" | "authenticated" | "signed-out" | "unavailable" | "signing-out";
interface AuthState {
  user: User | null;
  project: { id: string; name: string; role: string } | null;
  projects: Array<{ id: string; name: string; role: string }>;
  status: AuthStatus;
  error: string | null;
  setAuth: (user: User) => void;
  clearAuth: () => void;
  setStatus: (status: AuthStatus) => void;
  setProject: (project: { id: string; name: string; role: string }) => void;
  setProjects: (projects: Array<{ id: string; name: string; role: string }>) => void;
  updateProfile: (profile: Partial<User>) => void;
  setError: (error: string | null) => void;
}
function clearLegacyCredentials() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem("sdm_token"); sessionStorage.removeItem("sdm_token"); } catch { /* storage may be unavailable */ }
  document.cookie = "sdm_token=; Path=/; SameSite=Lax; Max-Age=0";
}
clearLegacyCredentials();
export const useAuthStore = create<AuthState>()(persist((set) => ({
  user: null, project: null, projects: [], status: "unknown", error: null,
  setAuth: (user) => { clearLegacyCredentials(); set({ user, status: "authenticated", error: null }); },
  clearAuth: () => { clearLegacyCredentials(); clearSharedJobs(); set({ user: null, project: null, projects: [], status: "signed-out", error: null }); },
  setStatus: (status) => set({ status }),
  setProject: (project) => set({ project }),
  setProjects: (projects) => set({ projects }),
  setError: (error) => set({ error }),
  updateProfile: (profile) => set((state) => ({ user: state.user ? { ...state.user, ...profile } : null })),
}), {
  name: "sdm-auth",
  partialize: (state) => ({ user: state.user, project: state.project, projects: state.projects }),
  onRehydrateStorage: () => (state) => { state?.setStatus("unknown"); },
}));

if (typeof window !== "undefined") {
  window.addEventListener("sdm:session-expired", () => useAuthStore.getState().clearAuth());
}
