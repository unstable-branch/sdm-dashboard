const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

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

async function fetchWithAuth(url: string, options: FetchOptions = {}): Promise<Response> {
  const { retry = 1, timeout = 15000, headers, ...rest } = options;

  const token = typeof window !== "undefined" ? localStorage.getItem("sdm_token") : null;
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
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
    localStorage.removeItem("sdm_token");
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const message = (data as any)?.error || `Request failed with status ${res.status}`;
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

export async function apiUpload<T>(url: string, file: File, extraFields?: Record<string, string>): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);
  if (extraFields) {
    Object.entries(extraFields).forEach(([key, value]) => formData.append(key, value));
  }

  const token = typeof window !== "undefined" ? localStorage.getItem("sdm_token") : null;
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchWithAuth(url, {
    method: "POST",
    body: formData,
    headers,
  });
  return res.json();
}

export function setAuthToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("sdm_token", token);
  }
}

export function clearAuthToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("sdm_token");
  }
}

export function getAuthToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("sdm_token") : null;
}
