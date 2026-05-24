import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sdm: {
          bg: "var(--sdm-bg)",
          surface: "var(--sdm-surface)",
          "surface-soft": "var(--sdm-surface-soft)",
          border: "var(--sdm-border)",
          text: "var(--sdm-text)",
          muted: "var(--sdm-muted)",
          heading: "var(--sdm-heading)",
          accent: "var(--sdm-accent)",
          "accent-2": "var(--sdm-accent-2)",
          "accent-blue": "var(--sdm-accent-blue)",
          success: "var(--sdm-success)",
          warning: "var(--sdm-warning)",
          danger: "var(--sdm-danger)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
