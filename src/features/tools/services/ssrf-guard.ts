import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;

function isBlockedIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

/** Expands an IPv6 address to its 8 groups, or null if it can't be parsed. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  // The trailing dotted form (::ffff:127.0.0.1) as two hex groups.
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (text.includes("::") === false && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((g) => parseInt(g, 16));
  return groups.some(Number.isNaN) ? null : groups;
}

/** Pure: true for loopback, private, link-local and reserved addresses. */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family !== 6) return true;

  const g = ipv6Groups(ip);
  if (!g) return true;
  const leadingZeros = g.slice(0, 6).every((x) => x === 0);
  if (leadingZeros && g[6] === 0 && g[7] <= 1) return true; // :: and ::1
  // IPv4 inside IPv6 (mapped, compatible, translated): judge the IPv4 part.
  const embedded =
    (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) ||
    leadingZeros ||
    (g[0] === 0x64 && g[1] === 0xff9b);
  if (embedded) {
    return isBlockedIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local
    (g[0] & 0xffc0) === 0xfe80 || // link-local
    (g[0] & 0xff00) === 0xff00 // multicast
  );
}

/**
 * SEC-08: Validates an outbound URL before fetching.
 * Returns an error string if the URL is unsafe, null if it is safe.
 *
 * Checks:
 *   1. Must be a valid URL
 *   2. Protocol must be HTTPS (or HTTP too, with allowHttp)
 *   3. Every address it resolves to, IPv4 and IPv6, must be public
 *
 * It can't stop a DNS answer that changes between this check and the fetch.
 */
export async function validateWebhookUrl(
  url: string,
  opts?: { allowHttp?: boolean },
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  const allowed = opts?.allowHttp ? ["https:", "http:"] : ["https:"];
  if (!allowed.includes(parsed.protocol)) {
    return "Only HTTPS webhooks are allowed (SEC-08)";
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return "Cannot resolve hostname";
  }

  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      return `Blocked: ${ip} is a private/internal IP address (SEC-08 anti-SSRF)`;
    }
  }

  return null;
}

/**
 * fetch that validates the URL and every redirect it follows: a public page
 * must not be able to bounce the server into an internal address.
 */
export async function fetchPublicUrl(
  url: string,
  init: RequestInit,
  opts?: { allowHttp?: boolean },
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = await validateWebhookUrl(current, opts);
    if (problem) throw new Error("URL no permitida");
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    current = new URL(location, current).toString();
  }
  throw new Error("La URL redirige demasiadas veces");
}
