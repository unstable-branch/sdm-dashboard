import type { Context } from "hono";

/**
 * Resolve the effective client IP for logging and rate-limit accounting.
 *
 * Behaviour:
 *   - If `TRUSTED_PROXY_CIDRS` env var is set (comma-separated CIDR list, e.g.
 *     "10.0.0.0/8,127.0.0.1/32") AND the immediate peer matches one of
 *     those CIDRs, honour `X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP`
 *     (taking the leftmost value).
 *   - Otherwise fall back to "unknown" — do NOT trust client-supplied headers,
 *     because an attacker can spoof those headers to bypass per-IP rate limits
 *     or poison audit logs.
 *
 * The peer IP is read from Hono's `remoteAddr` when available (it is the
 * literal TCP peer). When not exposed (e.g. behind a reverse proxy that
 * strips it), the function returns "unknown".
 */

const TRUSTED_PROXY_CIDRS_ENV = "TRUSTED_PROXY_CIDRS";

let cachedCidrs: { parsed: Array<{ host: number[]; mask: number }>; raw: string } | null = null;
let cachedRaw = "";

function parseCidrs(spec: string): Array<{ host: number[]; mask: number }> {
  const result: Array<{ host: number[]; mask: number }> = [];
  for (const entry of spec.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [ipPart, maskPart] = trimmed.split("/");
    const parsedMask = maskPart ? parseInt(maskPart, 10) : 32;
    if (Number.isNaN(parsedMask)) continue;
    const host = parseIp(ipPart);
    if (host.length === 0) continue;
    result.push({ host, mask: parsedMask });
  }
  return result;
}

function parseIp(ip: string): number[] {
  const rawParts = ip.split(".").map((p) => parseInt(p, 10));
  const parts: number[] = [];
  for (const p of rawParts) {
    if (Number.isNaN(p) || p < 0 || p > 255) {
      return [];
    }
    parts.push(p);
  }
  if (parts.length === 4) return parts;
  return [];
}

function ipToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ipParts: number[], cidr: { host: number[]; mask: number }): boolean {
  if (ipParts.length !== 4 || cidr.host.length !== 4) return false;
  const ipInt = ipToInt(ipParts);
  const cidrInt = ipToInt(cidr.host);
  if (cidr.mask === 0) return true;
  const mask = cidr.mask === 32 ? 0xffffffff : (~0 << (32 - cidr.mask)) >>> 0;
  return (ipInt & mask) === (cidrInt & mask);
}

export function getClientIp(c: Context): string {
  const rawSpec = process.env[TRUSTED_PROXY_CIDRS_ENV] ?? "";
  if (rawSpec !== cachedRaw) {
    cachedRaw = rawSpec;
    cachedCidrs = rawSpec ? { parsed: parseCidrs(rawSpec), raw: rawSpec } : null;
  }

  const peerAddr = c.env ? c.env["x-hono-request-remote-addr"] ?? "" : "";
  const peerIpv4 = parseIp(peerAddr.split(":")[0] ?? "");
  const trusted = cachedCidrs !== null && peerIpv4.length > 0 &&
    cachedCidrs.parsed.some((c) => ipv4InCidr(peerIpv4, c));

  if (!trusted) {
    return peerAddr ? peerAddr.split(":")[0] || "unknown" : "unknown";
  }

  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();

  return "unknown";
}

export function clearTrustedProxyCacheForTests(): void {
  cachedRaw = "";
  cachedCidrs = null;
}
