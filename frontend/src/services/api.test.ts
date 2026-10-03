import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchWithAuth, loginBrowserSession, registerBrowserSession, SessionChangedError } from "./api";
import { currentSessionGeneration, publishSessionChanged } from "./session-coordinator";
import { useAuthStore } from "@/stores/auth-store";
import { announceLogoutPending, isLogoutPending, publishLogoutFinished, withSessionMutation } from "./session-coordinator";

let lockRequest = vi.fn();
describe("cookie browser-session requests", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null, project: null, projects: [], error: null, status: "unknown" });
    class TestChannel { onmessage: ((event: MessageEvent) => void) | null = null; postMessage() {} }
    vi.stubGlobal("BroadcastChannel", TestChannel);
    lockRequest = vi.fn(async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: lockRequest } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });

  it("uses same-origin cookies without reading legacy bearer storage", async () => {
    localStorage.setItem("sdm_token", "legacy-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAuth("/api/v1/data", { method: "GET" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/data");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(new Headers(init.headers).get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it("rejects a deferred protected response after the session generation changes", async () => {
    let finishResponse!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finishResponse = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const responsePromise = fetchWithAuth("/api/v1/data", { method: "GET" });
    await vi.waitFor(() => expect(finishResponse).toBeTypeOf("function"));
    await withSessionMutation(async () => { publishSessionChanged(); });
    finishResponse(new Response('{"principal":"A"}', { status: 200 }));
    await expect(responsePromise).rejects.toMatchObject({ name: "SessionChangedError" });
    expect(currentSessionGeneration()).toBeGreaterThan(0);
  });

  it("rejects a stale 401 before refresh, replay, or session-expired publication", async () => {
    let finish401!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish401 = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const expired = vi.fn(); window.addEventListener("sdm:session-expired", expired);
    const pending = fetchWithAuth("/api/v1/data", { method: "GET" });
    await vi.waitFor(() => expect(finish401).toBeTypeOf("function"));
    await withSessionMutation(async () => { publishSessionChanged(); });
    finish401(new Response('{"error":"unauthorized"}', { status: 401 }));
    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener("sdm:session-expired", expired);
  });

  it("returns a current raw Response without claiming to cancel later consumer body reads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"principal":"A"}', { status: 200 })));
    const response = await fetchWithAuth("/api/v1/data", { method: "GET" });
    await withSessionMutation(async () => { publishSessionChanged(); });
    await expect(response.json()).resolves.toEqual({ principal: "A" });
  });

  it("rejects an ordinary error after the session generation changes during body parsing", async () => {
    let finishErrorBody!: (value: unknown) => void;
    const response = new Response(null, { status: 403 });
    response.json = vi.fn(() => new Promise((resolve) => { finishErrorBody = resolve; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const pending = fetchWithAuth("/api/v1/data", { method: "GET" });
    await vi.waitFor(() => expect(finishErrorBody).toBeTypeOf("function"));
    await withSessionMutation(async () => { publishSessionChanged(); });
    finishErrorBody({ error: "forbidden" });
    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
  });

  it("rechecks generation when JSON body parsing finishes", async () => {
    let finishBody!: (value: unknown) => void;
    const response = new Response(null, { status: 200 });
    response.json = vi.fn(() => new Promise((resolve) => { finishBody = resolve; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { apiGet, SessionChangedError } = await import("./api");
    const result = apiGet("/api/v1/data");
    await vi.waitFor(() => expect(finishBody).toBeTypeOf("function"));
    await withSessionMutation(async () => { publishSessionChanged(); });
    finishBody({ principal: "A" });
    await expect(result).rejects.toBeInstanceOf(SessionChangedError);
  });

  it("does not publish a download whose blob body finishes after the session changes", async () => {
    let finishBlob!: (value: Blob) => void;
    const response = new Response(null, { status: 200 });
    response.blob = vi.fn(() => new Promise<Blob>((resolve) => { finishBlob = resolve; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const { apiDownload } = await import("./api");
    const download = apiDownload("/api/v1/download");
    await vi.waitFor(() => expect(finishBlob).toBeTypeOf("function"));
    await withSessionMutation(async () => { publishSessionChanged(); });
    finishBlob(new Blob(["principal A"]));
    await expect(download).rejects.toBeInstanceOf(SessionChangedError);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("sends browser login metadata and accepts a user-only response", async () => {
    const user = { id: "u1", email: "synthetic@example.test" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await loginBrowserSession<{ user: typeof user }>("/api/v1/auth/login", { email: user.email, password: "synthetic-fixture-password", remember_me: false });
    expect(result.user).toEqual(user);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ email: user.email, password: "synthetic-fixture-password", remember_me: false, browser_session: true });
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(lockRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["login", loginBrowserSession, "/api/v1/auth/login"],
    ["register", registerBrowserSession, "/api/v1/auth/register"],
  ] as const)("aborts a stalled %s body before releasing its mutation lock", async (_name, authMutation, endpoint) => {
    vi.useFakeTimers();
    let active = false;
    let lockTail = Promise.resolve();
    lockRequest = vi.fn(async (_name: string, _options: unknown, callback: () => Promise<unknown>) => {
      const previous = lockTail;
      let release!: () => void;
      lockTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      active = true;
      try { return await callback(); }
      finally { active = false; release(); }
    });
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: lockRequest } });
    let bodyStarted!: () => void;
    const bodyPending = new Promise<void>((resolve) => { bodyStarted = resolve; });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const response = new Response(null, { status: 200 });
      response.json = vi.fn(() => new Promise((_resolve, reject) => {
        bodyStarted();
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const login = authMutation(endpoint, { email: "synthetic@example.test", password: "synthetic-fixture-password" });
    const loginOutcome = login.then(() => ({ error: null as Error | null }), (error: Error) => ({ error }));
    await bodyPending;
    let queuedMutationRan = false;
    const nextMutation = withSessionMutation(async () => { queuedMutationRan = true; return "next"; });
    await Promise.resolve();
    expect(queuedMutationRan).toBe(false);

    await vi.advanceTimersByTimeAsync(10001);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const loginResult = await loginOutcome;
    expect(loginResult.error).toMatchObject({ name: "AbortError" });
    await expect(nextMutation).resolves.toBe("next");
    expect(queuedMutationRan).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(active).toBe(false);
    expect(localStorage.getItem("sdm-browser-session-revision")).toBeNull();
    vi.useRealTimers();
  });

  it("coalesces concurrent protected GET refresh and retries each read once", async () => {
    let refreshCalls = 0;
    const calls = new Map<string, number>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      calls.set(url, (calls.get(url) ?? 0) + 1);
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response('{"ok":true}', { status: 200 });
      }
      if (calls.get(url) === 1) return new Response("{}", { status: 401 });
      return new Response("{}", { status: 200 });
    }));

    const responses = await Promise.all([
      fetchWithAuth("/api/v1/one", { method: "GET" }),
      fetchWithAuth("/api/v1/two", { method: "HEAD" }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(refreshCalls).toBe(1);
    expect(calls.get("/api/v1/one")).toBe(2);
    expect(calls.get("/api/v1/two")).toBe(2);
  });

  it("does not refresh or replay a mutation after a 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithAuth("/api/v1/record", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/v1/record")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/v1/auth/refresh")).toHaveLength(1);
  });

  it("does not refresh a forbidden response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithAuth("/api/v1/forbidden", { method: "GET" })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lockRequest).not.toHaveBeenCalled();
  });

  it("does not sign out on service unavailability", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithAuth("/api/v1/unavailable", { method: "GET" })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).not.toBe("signed-out");
  });

  it("does not restore a pending refresh over an in-progress logout", async () => {
    let finishRefresh!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/protected") return Promise.resolve(new Response("{}", { status: 401 }));
      return new Promise<Response>((resolve) => { finishRefresh = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const expired = vi.fn(); window.addEventListener("sdm:session-expired", expired);
    const pendingRequest = fetchWithAuth("/api/v1/protected", { method: "GET" });
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    announceLogoutPending();
    finishRefresh(new Response('{"ok":true}', { status: 200 }));
    await expect(pendingRequest).rejects.toBeInstanceOf(SessionChangedError);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/protected")).toHaveLength(1);
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener("sdm:session-expired", expired);
    await withSessionMutation(async () => { publishLogoutFinished(true); });
  });

  it("does not overwrite a peer logout-pending revision after a refresh response", async () => {
    let finishRefresh!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/protected") return Promise.resolve(new Response("{}", { status: 401 }));
      return new Promise<Response>((resolve) => { finishRefresh = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pendingRequest = fetchWithAuth("/api/v1/protected", { method: "GET" });
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    localStorage.setItem("sdm-browser-session-revision", JSON.stringify({ revision: 9999999, kind: "logout-pending" }));
    finishRefresh(new Response('{"ok":true}', { status: 200 }));
    await expect(pendingRequest).rejects.toBeInstanceOf(SessionChangedError);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/v1/protected")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("sdm-browser-session-revision") || "{}").kind).toBe("logout-pending");
    await withSessionMutation(async () => { publishLogoutFinished(true); });
  });

  it("keeps logout intent until /me confirms bounded recovery after logout failure", async () => {
    const { logoutBrowserSession } = await import("./api");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"temporary"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"user":{"id":"u1"}}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(logoutBrowserSession()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/v1/auth/logout", "/api/v1/auth/me"]);
    expect(isLogoutPending()).toBe(false);
    expect(JSON.parse(localStorage.getItem("sdm-browser-session-revision") || "{}").kind).toBe("changed");
  });

  it("does not retry mutations after a transient server failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithAuth("/api/v1/record", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
