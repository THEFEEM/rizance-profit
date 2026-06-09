/** Shared pg SSL config for migrate/test scripts (mirrors lib/pg-config.ts). */
export function needsPgSsl(connectionString) {
  return (
    /sslmode=require/i.test(connectionString) ||
    /\b(pooler\.supabase\.com|neon\.tech|supabase\.co|amazonaws\.com)\b/i.test(connectionString)
  );
}

export function pgClientOptions(connectionString) {
  if (!needsPgSsl(connectionString)) {
    return { connectionString };
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  const cleaned = url.toString().replace(/^postgres:/, "postgresql:");
  return { connectionString: cleaned, ssl: { rejectUnauthorized: false } };
}
