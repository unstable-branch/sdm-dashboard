/// <reference types="vitest" />
import { server } from "./server";

export function setupMSW() {
  beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}