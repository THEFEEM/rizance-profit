/** Detect hosted Postgres that requires TLS (Supabase pooler, Neon, RDS, etc.). */
export function needsPgSsl(connectionString: string): boolean {
  return (
    /sslmode=require/i.test(connectionString) ||
    /\b(pooler\.supabase\.com|neon\.tech|supabase\.co|amazonaws\.com)\b/i.test(connectionString)
  );
}

/**
 * pg v8+ treats sslmode=require in the URL as verify-full, which breaks on
 * Supabase/Neon managed certs. Strip sslmode from the URL and set
 * ssl.rejectUnauthorized=false explicitly on the Pool/Client instead.
 */
export function pgPoolOptions(connectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: false };
} {
  if (!needsPgSsl(connectionString)) {
    return { connectionString };
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  const cleaned = url.toString().replace(/^postgres:/, "postgresql:");
  return { connectionString: cleaned, ssl: { rejectUnauthorized: false } };
}
