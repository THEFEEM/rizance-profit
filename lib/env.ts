/** True when running on Vercel (production or preview). */
export function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

export const DEFAULT_APP_URL = "https://rizance.com";

/** True on Vercel production deployments (not preview, not local). */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/** Public app origin used for canonical URLs and old-host redirects. */
export function getAppUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return value || DEFAULT_APP_URL;
}

/**
 * Session cookies must be `Secure` on any HTTPS host (Vercel prod + preview).
 * Local `next dev` is plain HTTP, so Secure is off there.
 */
export function useSecureCookies(): boolean {
  return isVercel();
}

/** Cross-subdomain session cookie (e.g. `.rizance.com`). Unset in local dev. */
export function sessionCookieDomain(): string | undefined {
  return process.env.SESSION_COOKIE_DOMAIN || undefined;
}

/** POS web app origin for CORS on /api/pos/* (e.g. https://pos.rizance.com). */
export function getPosAppOrigin(): string {
  return process.env.POS_APP_ORIGIN?.trim() || "http://localhost:3001";
}

/** Public POS app URL for dashboard links (NEXT_PUBLIC_POS_APP_URL). */
export function getPublicPosAppUrl(): string {
  return process.env.NEXT_PUBLIC_POS_APP_URL?.trim() || "http://localhost:3001";
}
