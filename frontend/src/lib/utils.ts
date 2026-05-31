import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtFixed(v: unknown, decimals: number): string {
  const n = toNum(v);
  return n !== null ? n.toFixed(decimals) : "—";
}
