import type { z } from "zod";
import { announceLogoutPending, currentSessionGeneration, currentSessionRevision, isLogoutPending, publishLogoutFinished, publishLogoutStarted, publishSessionChanged, publishSessionRefreshed, withSessionMutation } from "./session-coordinator";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); this.name = "ApiError"; }
}
export class ApiUnavailableError extends Error {
  constructor(message = "The service is temporarily unavailable. Please retry.") { super(message); this.name = "ApiUnavailableError"; }
}
export class SessionChangedError extends Error {
  constructor() { super("The session changed while this request was in flight."); this.name = "SessionChangedError"; }
}
function assertCurrentGeneration(generation: number): void {
  if (generation !== currentSessionGeneration()) throw new SessionChangedError();
}
const responseGenerations = new WeakMap<Response, number>();
async function readJson<T>(response: Response, schema?: z.ZodType<unknown>): Promise<T> {
  const generation = responseGenerations.get(response) ?? currentSessionGeneration();
  const data = await response.json();
  assertCurrentGeneration(generation);
  return validateResponse<T>(data, schema);
}
interface FetchOptions extends RequestInit { retry?: number; timeout?: number; schema?: z.ZodType<unknown>; }
function validateResponse<T>(data: unknown, schema?: z.ZodType<unknown>): T {
  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      if (process.env.NODE_ENV === "development") console.warn(`[api] Response validation failed: ${result.error.format()}`);
      throw new ApiError(500, `Response validation failed: ${result.error.message}`);
    }
  }
  return data as T;
}
function requestUrl(url: string): string {
  if (typeof window === "undefined") return `${API_BASE}${url}`;
  const resolved = new URL(url, window.location.origin);
  if (resolved.origin !== window.location.origin) throw new ApiError(0, "Cross-origin API requests are not supported by browser sessions");
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
function requestHeaders(headers?: HeadersInit, body?: BodyInit | null): Headers {
  const result = new Headers(headers);
  result.set("X-Requested-With", "XMLHttpRequest");
  if (!(typeof FormData !== "undefined" && body instanceof FormData) && !result.has("Content-Type")) result.set("Content-Type", "application/json");
  return result;
}
async function withRequestDeadline<T>(timeout: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); }
}
async function responseError(response: Response): Promise<ApiError> {
  let data: Record<string, unknown> | null = null;
  try { data = await response.json(); } catch { /* response may have no JSON body */ }
  return new ApiError(response.status, typeof data?.error === "string" ? data.error : `Request failed with status ${response.status}`, data);
}
const AUTH_ENDPOINT = /\/api\/v1\/auth\/(?:login|register|refresh|logout)(?:\?|$)/;
let refreshFlight: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  if (refreshFlight) return refreshFlight;
  if (isLogoutPending()) return Promise.resolve(false);
  const startingRevision = currentSessionRevision();
  const flight = withSessionMutation(async (lockedRevision) => {
    if (isLogoutPending()) return false;
    if (lockedRevision > startingRevision) return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(requestUrl("/api/v1/auth/refresh"), { method: "POST", credentials: "same-origin", headers: requestHeaders(undefined, "{}"), body: JSON.stringify({ browser_session: true }), signal: controller.signal });
      if (response.status === 401) return false;
      if (!response.ok) throw new ApiUnavailableError(`Session refresh unavailable (${response.status}).`);
      if (isLogoutPending()) return false;
      if (!publishSessionRefreshed()) return false;
      return true;
    } catch (error) {
      if (error instanceof ApiUnavailableError) throw error;
      if (controller.signal.aborted) throw new ApiUnavailableError("Session refresh timed out. Please retry.");
      throw new ApiUnavailableError();
    } finally { clearTimeout(timer); }
  }).catch((error) => { if (error instanceof ApiUnavailableError) throw error; throw new ApiUnavailableError(error instanceof Error ? error.message : undefined); }).finally(() => { if (refreshFlight === flight) refreshFlight = null; });
  refreshFlight = flight;
  return flight;
}
export async function fetchWithAuth(url: string, options: FetchOptions = {}): Promise<Response> {
  // The raw Response is guarded at return; callers that consume it later own body-read race handling.
  const { timeout = 15000, headers, signal, ...rest } = options;
  const method = (rest.method || "GET").toUpperCase();
  const safeRead = method === "GET" || method === "HEAD";
  const target = requestUrl(url);
  const init: RequestInit = { ...rest, credentials: "same-origin", headers: requestHeaders(headers, rest.body) };
  const controller = signal ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  init.signal = controller ? controller.signal : signal;
  const generation = currentSessionGeneration();
  const send = () => fetch(target, init);
  try {
    let response: Response;
    try { response = await send(); } catch (error) { assertCurrentGeneration(generation); if (init.signal?.aborted) throw error; throw new ApiUnavailableError(); }
    assertCurrentGeneration(generation);
    if (response.status === 401 && !AUTH_ENDPOINT.test(target) && !isLogoutPending()) {
      if (init.signal?.aborted) throw new DOMException("The request was aborted", "AbortError");
      const refreshed = await refreshSession();
      if (!refreshed) {
        assertCurrentGeneration(generation);
        if (!isLogoutPending() && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sdm:session-expired"));
        const error = await responseError(response);
        assertCurrentGeneration(generation);
        throw error;
      }
      if (safeRead && !init.signal?.aborted && generation === currentSessionGeneration() && !isLogoutPending()) {
        try { response = await send(); } catch (error) { assertCurrentGeneration(generation); if (init.signal?.aborted) throw error; throw new ApiUnavailableError(); }
        assertCurrentGeneration(generation);
      }
    }
    if (!response.ok) {
      const error = await responseError(response);
      assertCurrentGeneration(generation);
      throw error;
    }
    assertCurrentGeneration(generation);
    responseGenerations.set(response, generation);
    return response;
  } finally { if (timer) clearTimeout(timer); }
}
export async function apiGet<T>(url: string, options?: FetchOptions): Promise<T> { return readJson<T>(await fetchWithAuth(url, { method: "GET", ...options }), options?.schema); }
export async function apiPost<T>(url: string, body?: unknown, options?: FetchOptions): Promise<T> { const res = await fetchWithAuth(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), ...options }); return readJson<T>(res, options?.schema); }
export async function apiDelete<T>(url: string, options?: FetchOptions): Promise<T> { return readJson<T>(await fetchWithAuth(url, { method: "DELETE", ...options }), options?.schema); }
export async function apiPut<T>(url: string, body?: unknown, options?: FetchOptions): Promise<T> { const res = await fetchWithAuth(url, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body), ...options }); return readJson<T>(res, options?.schema); }
export async function apiPatch<T>(url: string, body?: unknown, options?: FetchOptions): Promise<T> { const res = await fetchWithAuth(url, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body), ...options }); return readJson<T>(res, options?.schema); }
export async function apiUpload<T>(url: string, file: File, extraFields?: Record<string, string>, timeout?: number): Promise<T> {
  const formData = new FormData(); formData.append("file", file);
  if (extraFields) Object.entries(extraFields).forEach(([key, value]) => formData.append(key, value));
  return readJson<T>(await fetchWithAuth(url, { method: "POST", body: formData, timeout }));
}
/** @deprecated Browser sessions never expose access credentials to JavaScript. */
export function setAuthToken(_token: string, _remember = true): void { clearAuthToken(); }
/** Remove legacy JS-readable credentials only; HttpOnly cookies are server-managed. */
export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem("sdm_token"); sessionStorage.removeItem("sdm_token"); } catch { /* storage may be unavailable */ }
  document.cookie = "sdm_token=; Path=/; SameSite=Lax; Max-Age=0";
}
/** @deprecated Compatibility export; browser-session credentials are HttpOnly. */
export function getAuthToken(): string | null { clearAuthToken(); return null; }
export function getToken(): string | null { return getAuthToken(); }
export async function loginBrowserSession<T>(url: string, body: Record<string, unknown>): Promise<T> {
  clearAuthToken();
  return withSessionMutation(async () => {
    const result = await withRequestDeadline(10000, (signal) => apiPost<T>(url, { ...body, browser_session: true }, { signal }));
    publishSessionChanged();
    return result;
  });
}
export async function registerBrowserSession<T>(url: string, body: Record<string, unknown>): Promise<T> { return loginBrowserSession<T>(url, body); }
export async function logoutBrowserSession(): Promise<void> {
  clearAuthToken();
  announceLogoutPending();
  await withSessionMutation(async () => {
    if (!publishLogoutStarted()) throw new ApiUnavailableError("Could not safely publish logout intent. Please retry.");
    try {
      const response = await fetch(requestUrl("/api/v1/auth/logout"), { method: "POST", credentials: "same-origin", headers: requestHeaders(undefined, "{}"), body: JSON.stringify({ browser_session: true }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw await responseError(response);
      if (!publishLogoutFinished(true)) throw new ApiUnavailableError("Logout completed but session recovery could not be confirmed. Please retry.");
    } catch (error) {
      // The lock still orders recovery after logout; a /me probe, not local metadata, decides authority.
      const probe = await fetch(requestUrl("/api/v1/auth/me"), { method: "GET", credentials: "same-origin", headers: requestHeaders(), signal: AbortSignal.timeout(5000) });
      if (probe.ok) publishLogoutFinished(true);
      else if (probe.status === 401) publishLogoutFinished(true);
      else throw error;
      throw error;
    }
  });
}
export async function apiDownload(url: string, filename?: string): Promise<void> {
  const res = await fetchWithAuth(url, { method: "GET" }); const generation = responseGenerations.get(res) ?? currentSessionGeneration();
  const blob = await res.blob();
  assertCurrentGeneration(generation);
  const disp = res.headers.get("Content-Disposition");
  const name = filename || (disp ? disp.split("filename=")[1]?.replace(/"/g, "") : undefined) || url.split("/").pop() || "download";
  const blobUrl = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = blobUrl; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}
export async function apiGetSuitabilityValue(runId: string, lat: number, lng: number, band?: string): Promise<{ value: number | null }> {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) }); if (band) params.set("band", band);
  return apiGet(`/api/v1/results/suitability-value/${encodeURIComponent(runId)}?${params.toString()}`);
}
