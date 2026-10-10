// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

let server: Server;
let origin: string;
const originalApiBase = process.env.NEXT_PUBLIC_API_URL;
let apiGetArrayBuffer: typeof import("./api").apiGetArrayBuffer;
let requestStarted: Promise<void>;
let notifyRequestStarted!: () => void;
let responseClosed: Promise<void>;
let notifyResponseClosed!: () => void;

beforeAll(async () => {
  requestStarted = new Promise((resolve) => { notifyRequestStarted = resolve; });
  responseClosed = new Promise((resolve) => { notifyResponseClosed = resolve; });
  server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.write(Buffer.from([0, 1, 2, 3]));
    notifyRequestStarted();
    response.once("close", notifyResponseClosed);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP port");
  origin = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_API_URL = origin;
  ({ apiGetArrayBuffer } = await import("./api"));
});

afterAll(async () => {
  if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiBase;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("native response-body cancellation", () => {
  it("aborts a real fetch stream after headers when the whole-body deadline expires", async () => {
    const pending = apiGetArrayBuffer("/api/v1/open-stream", { timeout: 100 });
    await requestStarted;
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await responseClosed;
  });
});
