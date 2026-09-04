import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtFixed(v: unknown, d: number): string {
  const n = toNum(v);
  return n !== null ? n.toFixed(d) : "—";
}

export function fmtLocale(v: unknown): string {
  const n = toNum(v);
  return n !== null ? n.toLocaleString() : "—";
}
