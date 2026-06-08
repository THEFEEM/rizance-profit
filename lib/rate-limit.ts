import type { NextRequest } from "next/server";

/** In-memory sliding-window rate limiter (per serverless instance on Vercel). */
const hits = new Map<string, number[]>();

const AUTH_LIMIT = 10; // max attempts
const AUTH_WINDOW_MS = 60_000; // per minute

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Returns seconds until the client may retry, or null if under the limit.
 * @param key — typically `login:1.2.3.4` or `register:1.2.3.4`
 */
export function authRateLimitExceeded(key: string): number | null {
  const now = Date.now();
  const windowStart = now - AUTH_WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= AUTH_LIMIT) {
    const retryAfterMs = recent[0] + AUTH_WINDOW_MS - now;
    return Math.max(1, Math.ceil(retryAfterMs / 1000));
  }

  recent.push(now);
  hits.set(key, recent);
  return null;
}
