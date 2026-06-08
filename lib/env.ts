/** True when running on Vercel (production or preview). */
export function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

/** True on Vercel production deployments (not preview, not local). */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/**
 * Session cookies must be `Secure` on any HTTPS host (Vercel prod + preview).
 * Local `next dev` is plain HTTP, so Secure is off there.
 */
export function useSecureCookies(): boolean {
  return isVercel();
}
