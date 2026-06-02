const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

let _redirecting = false;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface FetchOptions extends RequestInit {
  retry?: number;
  timeout?: number;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const localToken = localStorage.getItem("sdm_token");
  if (localToken) {
    writeTokenCookie(localToken, true);
    return localToken;
  }

  const sessionToken = sessionStorage.getItem("sdm_token");
  if (sessionToken) {
    writeTokenCookie(sessionToken, false);
    return sessionToken;
  }

  return null;
}

function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("sdm_token");
    sessionStorage.removeItem("sdm_token");
    document.cookie = "sdm_token=; Path=/; SameSite=Lax; Max-Age=0";
  }
}

function writeTokenCookie(token: string, remember: boolean) {
  const maxAge = remember ? "; Max-Age=86400" : "";
  document.cookie = `sdm_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax${maxAge}`;
}

export async function fetchWithAuth(url: string, options: FetchOptions = {}): Promise<Response> {
  const { retry = 1, timeout = 15000, headers, ...rest } = options;

  const token = getToken();
  const isFormData = rest.body instanceof FormData;
  const defaultHeaders: Record<string, string> = {};
  defaultHeaders["X-Requested-With"] = "XMLHttpRequest";
  if (!isFormData) {
    defaultHeaders["Content-Type"] = "application/json";
  }
  if (token) {
    defaultHeaders.Authorization = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = {
    ...rest,
    headers: { ...defaultHeaders, ...headers },
  };
  if (!fetchOptions.signal) {
    fetchOptions.signal = AbortSignal.timeout(timeout);
  }

  const res = await fetch(`${API_BASE}${url}`, fetchOptions);

  if (!res.ok && retry > 0 && res.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && !_redirecting) {
      _redirecting = true;
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = "/login?redirect=" + redirect;
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    let data: Record<string, unknown> | null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const message = data?.error as string | undefined || `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, data);
  }

  return res;
}

export async function apiGet<T>(url: string, options?: FetchOptions): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", ...options });
  return res.json();
}

export async function apiPost<T>(url: string, body?: unknown, options?: FetchOptions): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
  return res.json();
}

export async function apiDelete<T>(url: string, options?: FetchOptions): Promise<T> {
  const res = await fetchWithAuth(url, { method: "DELETE", ...options });
  return res.json();
}

export async function apiPut<T>(url: string, body?: unknown, options?: FetchOptions): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: "PUT",
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
  return res.json();
}

export async function apiPatch<T>(url: string, body?: unknown, options?: FetchOptions): Promise<T> {
  const res = await fetchWithAuth(url, {
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
  return res.json();
}

export async function apiUpload<T>(url: string, file: File, extraFields?: Record<string, string>, timeout?: number): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);
  if (extraFields) {
    Object.entries(extraFields).forEach(([key, value]) => formData.append(key, value));
  }

  const token = getToken();
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchWithAuth(url, {
    method: "POST",
    body: formData,
    headers,
    timeout,
  });
  return res.json();
}

export function setAuthToken(token: string, remember = true) {
  if (typeof window !== "undefined") {
    clearToken();
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem("sdm_token", token);
    writeTokenCookie(token, remember);
  }
}

export function clearAuthToken() {
  clearToken();
}

export function getAuthToken(): string | null {
  return getToken();
}

export async function apiDownload(url: string, filename?: string): Promise<void> {
  const res = await fetchWithAuth(url, { method: "GET" });
  const blob = await res.blob();
  const disp = res.headers.get("Content-Disposition");
  const name = filename || (disp ? disp.split("filename=")[1]?.replace(/"/g, "") : undefined) || url.split("/").pop() || "download";
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}
