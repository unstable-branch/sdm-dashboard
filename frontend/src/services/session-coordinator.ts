const CHANNEL_NAME = "sdm-browser-session-v1";
const STORAGE_KEY = "sdm-browser-session-revision";
const LOCK_NAME = "sdm-browser-session-mutation";
type NoticeKind = "changed" | "refreshed" | "logout-pending";
type Notice = { revision: number; kind: NoticeKind };
let revision = 0;
let generation = 0;
let currentKind: NoticeKind | undefined;
let sharedLogoutPending = false;
let localLogoutPending = false;
let uncertain = false;
let channel: BroadcastChannel | null = null;
let initialized = false;
let lockOwned = false;

export class SessionCoordinationError extends Error {
  constructor(message = "Secure browser session coordination is unavailable. Use HTTPS or localhost and try again.") {
    super(message); this.name = "SessionCoordinationError";
  }
}
function storage(): Storage {
  if (typeof window === "undefined") throw new SessionCoordinationError();
  try { return window.localStorage; } catch { throw new SessionCoordinationError(); }
}
function isNotice(value: unknown): value is Notice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const notice = value as Record<string, unknown>;
  return Object.keys(notice).length === 2 && Number.isSafeInteger(notice.revision) &&
    (notice.revision as number) >= 0 &&
    (notice.kind === "changed" || notice.kind === "refreshed" || notice.kind === "logout-pending");
}
function notifySessionChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sdm:session-changed"));
}
function failClosed() {
  if (!uncertain) { generation += 1; notifySessionChanged(); }
  uncertain = true; sharedLogoutPending = true;
}
function receive(value: unknown) {
  if (!isNotice(value)) { failClosed(); return; }
  const notice = value;
  if (notice.revision < revision) return;
  if (notice.revision === revision) {
    if (currentKind !== undefined && currentKind !== notice.kind) failClosed();
    return; // duplicate metadata is idempotent; conflict fails closed above
  }
  revision = notice.revision; currentKind = notice.kind;
  sharedLogoutPending = notice.kind === "logout-pending";
  if (notice.kind === "changed") uncertain = false;
  if (notice.kind !== "refreshed") { generation += 1; notifySessionChanged(); }
}
function readPersisted(): Notice | null {
  const raw = storage().getItem(STORAGE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { failClosed(); return null; }
  if (!isNotice(parsed)) { failClosed(); return null; }
  return parsed;
}
function readAndReceive(): Notice | null {
  const persisted = readPersisted();
  if (persisted) receive(persisted);
  return persisted;
}
function setup() {
  if (initialized || typeof window === "undefined") return;
  try {
    readAndReceive();
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === null) { failClosed(); return; }
      try { receive(JSON.parse(event.newValue)); } catch { failClosed(); }
    });
    if ("BroadcastChannel" in window && !channel) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
    }
    initialized = true;
  } catch { /* No unsafe fallback when secure browser capabilities are unavailable. */ }
}
setup();
export function currentSessionGeneration() { return generation; }
export function isLogoutPending() {
  try { readAndReceive(); } catch { failClosed(); }
  return localLogoutPending || sharedLogoutPending || uncertain;
}
export function currentSessionRevision() { try { readAndReceive(); } catch { failClosed(); } return revision; }

/** Durable session publications may only be called by an operation holding the origin-wide lock. */
function publishLocked(kind: NoticeKind, recovery = false): boolean {
  if (!lockOwned) throw new SessionCoordinationError("Session state may only be published while holding the origin-wide lock.");
  const localStorage = storage();
  const persisted = readAndReceive();
  if (uncertain && kind !== "logout-pending" && !recovery) return false;
  if (kind === "refreshed" && isLogoutPending()) return false;
  if (isLogoutPending() && kind !== "logout-pending" && !recovery) return false;
  const nextRevision = Math.max(revision, persisted?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(nextRevision)) { failClosed(); return false; }
  const notice: Notice = { revision: nextRevision, kind };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notice)); }
  catch { failClosed(); throw new SessionCoordinationError("Could not persist browser session coordination state."); }
  revision = nextRevision; currentKind = kind; sharedLogoutPending = kind === "logout-pending";
  uncertain = false;
  if (kind !== "refreshed") { generation += 1; notifySessionChanged(); }
  channel?.postMessage(notice);
  return true;
}
/** Local cancellation barrier only; durable publication waits until logout owns the lock. */
export function announceLogoutPending() {
  if (!localLogoutPending) { localLogoutPending = true; generation += 1; notifySessionChanged(); }
  return true;
}
export function publishSessionChanged() { return publishLocked("changed"); }
export function publishLogoutStarted() { return publishLocked("logout-pending"); }
export function publishLogoutFinished(recovery = false) {
  const published = publishLocked("changed", recovery);
  if (published) localLogoutPending = false;
  return published;
}
export function publishSessionRefreshed() { return publishLocked("refreshed"); }

export async function withSessionMutation<T>(operation: (revisionAtLock: number) => Promise<T>): Promise<T> {
  setup();
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof BroadcastChannel === "undefined") throw new SessionCoordinationError();
  let acquired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortLockWait = new AbortController();
  const lockTask = locks.request(LOCK_NAME, { mode: "exclusive", signal: abortLockWait.signal }, async () => {
    acquired = true;
    if (timer) clearTimeout(timer);
    const persisted = readAndReceive();
    revision = Math.max(revision, persisted?.revision ?? 0);
    lockOwned = true;
    try { return await operation(revision); }
    finally { lockOwned = false; }
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!acquired) { abortLockWait.abort(); reject(new SessionCoordinationError("Timed out waiting for browser session coordination.")); }
      // Once acquired, never race completion against an operation that can still publish.
    }, 12000);
  });
  try { return await Promise.race([lockTask, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
