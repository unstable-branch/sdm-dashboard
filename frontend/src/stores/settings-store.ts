import { create } from "zustand";
import { apiGet, apiPut, apiDelete } from "../services/api";

export interface UserSettings {
  id: string;
  userId: string;
  defaultModelId: string;
  pinnedModelIds: string[];
  defaultBiovars: string;
  defaultClimateSource: string;
  defaultClimateRes: number;
  defaultCvStrategy: string;
  defaultCvK: number;
  defaultBackgroundN: number;
  defaultPaReplications: number;
  theme: string;
  tablePageSize: number;
  compactMode: boolean;
  gbifUsername?: string | null;
  gbifPassword?: string | null;
  hasGbifPassword?: boolean;
  gbifEmail?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SettingsState {
  settings: UserSettings | null;
  isLoading: boolean;
  error: string | null;

  fetchSettings: () => Promise<void>;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: null,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiGet("/api/v1/settings");
      set({ settings: data as UserSettings, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch settings",
        isLoading: false,
      });
    }
  },

  updateSettings: async (updates: Partial<UserSettings>) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiPut("/api/v1/settings", updates);
      set({ settings: data as UserSettings, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update settings",
        isLoading: false,
      });
    }
  },

  resetSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiDelete("/api/v1/settings");
      set({ settings: data as UserSettings, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to reset settings",
        isLoading: false,
      });
    }
  },
}));
