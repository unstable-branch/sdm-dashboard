import { describe, expect, it } from "vitest";
import { getIdempotencyKeyFromHeaders, hashRequestBody, stableStringify } from "./idempotency.js";

describe("idempotency helpers", () => {
  it("canonicalizes object key order before hashing", () => {
    const first = { species: "Acacia mearnsii", config: { seed: 42, biovars: [1, 4, 6] } };
    const second = { config: { biovars: [1, 4, 6], seed: 42 }, species: "Acacia mearnsii" };

    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(hashRequestBody(first)).toBe(hashRequestBody(second));
  });

  it("normalizes unsupported JSON values without throwing", () => {
    expect(stableStringify({ keep: true, drop: undefined, nested: [Number.POSITIVE_INFINITY] })).toBe(
      '{"keep":true,"nested":[null]}'
    );
  });

  it("reads idempotency keys from web Headers", () => {
    const headers = new Headers({ "Idempotency-Key": " retry-key " });

    expect(getIdempotencyKeyFromHeaders(headers)).toBe("retry-key");
  });

  it("reads idempotency keys from plain header records", () => {
    expect(getIdempotencyKeyFromHeaders({ "x-idempotency-key": ["", " secondary-key "] })).toBe("secondary-key");
  });
});
