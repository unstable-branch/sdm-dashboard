import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  where: vi.fn(),
  returning: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../db/index.js", () => ({ db: { transaction: state.transaction } }));

const { revokeBrowserSession } = await import("./sessions.js");

describe("revokeBrowserSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.returning.mockResolvedValue([{ id: "session-row" }]);
    state.where.mockReturnValue({ returning: state.returning });
    state.update.mockReturnValue({ set: () => ({ where: state.where }) });
    state.transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run({ update: state.update }));
  });

  it("conditionally revokes only the unrevoked, unexpired token owned by the principal", async () => {
    expect(await revokeBrowserSession("principal-user", "hashed-refresh-credential")).toBe(true);
    const condition = state.where.mock.calls[0][0];
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"user_id"');
    expect(query.sql).toContain('"token_hash"');
    expect(query.sql).toContain('"revoked_at" is null');
    expect(query.sql).toContain('"expires_at" > CURRENT_TIMESTAMP');
    expect(query.params).toContain("principal-user");
    expect(query.params).toContain("hashed-refresh-credential");
    expect(state.returning).toHaveBeenCalledOnce();
  });

  it("reports no revocation when the conditional update matches no session row", async () => {
    state.returning.mockResolvedValueOnce([]);
    expect(await revokeBrowserSession("principal-user", "hashed-refresh-credential")).toBe(false);
  });
});
