import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  consoleLog: vi.fn(),
  consoleError: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => null),
    getTestMessageUrl: vi.fn(() => "smtp://test"),
  },
}));

vi.mock("../db/index.js", () => ({ db: {} }));

describe("GE-01: email.ts does not leak password-reset tokens in production", () => {
  beforeEach(() => {
    mocks.consoleLog.mockClear();
    mocks.consoleError.mockClear();
    vi.stubGlobal("console", { ...console, log: mocks.consoleLog, error: mocks.consoleError });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not print the reset URL when NODE_ENV=production (token leak)", async () => {
    vi.resetModules();
    process.env.NODE_ENV = "production";
    const { sendPasswordResetEmail } = await import("../services/email.js");
    await sendPasswordResetEmail("[email protected]", "very-secret-token-12345");
    const allLogged = mocks.consoleLog.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(allLogged).not.toContain("very-secret-token-12345");
    expect(allLogged).not.toContain("/reset-password");
  });

  it("prints a non-secret summary when NODE_ENV != production (dev mode)", async () => {
    vi.resetModules();
    delete process.env.NODE_ENV;
    const { sendPasswordResetEmail } = await import("../services/email.js");
    await sendPasswordResetEmail("[email protected]", "dev-token");
    const allLogged = mocks.consoleLog.mock.calls.map((c) => c.join(" ")).join("\n");
    // dev mode still should not print the full URL/token in stdout because
    // the audit found that the token was leaking to log sinks. dev mode
    // returns devUrl to the caller (only in-memory), not to stdout.
    expect(allLogged).not.toContain("dev-token");
  });
});
