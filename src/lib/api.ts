/**
 * Centralized API host resolution — local.drizzle.studio pattern.
 *
 * Loaded from CF (local.buildwithoracle.com): user passes ?host=white.local:3456
 *   Server auto-detects mkcert and serves HTTPS (same as drizzle-kit).
 * Loaded locally (same origin): uses relative paths.
 *
 * The host param accepts THREE forms:
 *
 *   ?host=white.local:3456              → https://white.local:3456
 *                                         (bare host:port — defaults to https,
 *                                         backwards-compatible behavior)
 *
 *   ?host=https://white.local:3456      → https://white.local:3456
 *                                         (explicit https — same result)
 *
 *   ?host=http://oracle-world:3456      → http://oracle-world:3456
 *                                         (explicit http — needed for plain-HTTP
 *                                         maw-js nodes on the LAN, e.g. oracle-world
 *                                         where mkcert isn't deployed)
 *
 * Discovered the http:// gap during /lens smoke testing on 2026-04-11:
 * the v1.1 PR claimed "the lens reads any maw-js" but the apiUrl helper
 * hardcoded https://, so any HTTP-only node was unreachable. This restores
 * the claim. See ψ/memory/feedback_ground_before_proposing.md (claim drift —
 * incident #5 in the night's count).
 */

const STORAGE_KEY = "maw-host";
const RECENT_KEY = "maw-host-recent";

const params = new URLSearchParams(window.location.search);
const urlHost = params.get("host");

// Auto-persist: ?host= in URL → save to localStorage → redirect clean
if (urlHost) {
  localStorage.setItem(STORAGE_KEY, urlHost);
  addRecentHost(urlHost);
  const url = new URL(window.location.href);
  url.searchParams.delete("host");
  window.location.replace(url.toString());
}

const hostParam = localStorage.getItem(STORAGE_KEY);

/** Whether we're running in remote mode */
export const isRemote = !!hostParam;

/** Where the active host came from (always "config" or "local" after redirect) */
export const hostSource: "config" | "local" =
  localStorage.getItem(STORAGE_KEY) ? "config" : "local";

/** Raw active host value (from URL or config) */
export const activeHost: string | null = hostParam;

/** Read stored host from config */
export function getStoredHost(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Save host to config + add to recent list */
export function setStoredHost(host: string): void {
  localStorage.setItem(STORAGE_KEY, host);
  addRecentHost(host);
}

/** Clear stored host (revert to local) */
export function clearStoredHost(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Get recent hosts list */
export function getRecentHosts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch { return []; }
}

function addRecentHost(host: string): void {
  const recent = getRecentHosts().filter(h => h !== host);
  recent.unshift(host);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 8)));
}

/** Resolved {protocol, host:port} from `hostParam`, or null if same-origin. */
function resolveHost(): { httpProto: string; wsProto: string; host: string } | null {
  if (!hostParam) return null;
  // Strip trailing slash — browsers often append one to the URL, which
  // causes double-slash in constructed paths: "localhost:3456/" + "/api/config"
  // → "localhost:3456//api/config". The double-slash misses the CORS middleware
  // (mounted on "/api/*", not "//api/*") and breaks everything.
  if (hostParam.startsWith("https://")) {
    return { httpProto: "https:", wsProto: "wss:", host: hostParam.slice("https://".length).replace(/\/+$/, "") };
  }
  if (hostParam.startsWith("http://")) {
    return { httpProto: "http:", wsProto: "ws:", host: hostParam.slice("http://".length).replace(/\/+$/, "") };
  }
  // Bare host:port — default to https for backwards compatibility.
  return { httpProto: "https:", wsProto: "wss:", host: hostParam.replace(/\/+$/, "") };
}

/** Build full URL for fetch() calls */
export function apiUrl(path: string): string {
  const r = resolveHost();
  if (!r) return path;
  return `${r.httpProto}//${r.host}${path}`;
}

/** WebSocket URL */
export function wsUrl(path: string): string {
  const r = resolveHost();
  if (!r) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}${path}`;
  }
  return `${r.wsProto}//${r.host}${path}`;
}
