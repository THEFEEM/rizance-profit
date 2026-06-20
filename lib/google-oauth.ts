import { OAuth2Client } from "google-auth-library";

/** True when all Google OAuth env vars are configured (API routes). */
export function isGoogleAuthEnabled(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

/** True when Google sign-in button should be shown (UI only needs client ID). */
export function isGoogleLoginUiEnabled(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID;
}

export function createGoogleOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured");
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}
