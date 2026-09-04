import { describe, it, expect } from "vitest";
import { toNum } from "./utils";

describe("toNum", () => {
  it("returns null for null", () => {
    expect(toNum(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toNum(undefined)).toBeNull();
  });

  it("returns the number for a valid number", () => {
    expect(toNum(42)).toBe(42);
    expect(toNum(3.14)).toBe(3.14);
    expect(toNum(0)).toBe(0);
    expect(toNum(-0)).toBe(-0);
  });

  it("parses a valid string", () => {
    expect(toNum("42")).toBe(42);
    expect(toNum("3.14")).toBe(3.14);
  });

  it("returns null for NaN", () => {
    expect(toNum(NaN)).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(toNum(Infinity)).toBeNull();
  });

  it("returns null for -Infinity", () => {
    expect(toNum(-Infinity)).toBeNull();
  });

  it("returns null for non-numeric strings", () => {
    expect(toNum("hello")).toBeNull();
    expect(toNum("")).toBe(0);
  });
});
