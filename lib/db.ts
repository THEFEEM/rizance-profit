import { Pool, types } from "pg";
import { pgPoolOptions } from "@/lib/pg-config";

// NUMERIC (OID 1700) comes back from pg as a string by default, which is
// exactly what we want for exact-decimal money. We keep it as a string and
// never coerce money through JS floats. This is just an explicit safeguard.
types.setTypeParser(1700, (val) => val);

// DATE (OID 1082): return the raw "YYYY-MM-DD" string instead of a JS Date,
// so calendar days never shift due to the server's local timezone.
types.setTypeParser(1082, (val) => val);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

const pgOpts = pgPoolOptions(connectionString);

// Reuse a single Pool across hot-reloads in development.
const globalForPg = globalThis as unknown as { __rizancePgPool?: Pool };

export const pool =
  globalForPg.__rizancePgPool ??
  new Pool({
    ...pgOpts,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.__rizancePgPool = pool;
}

// Thin query helper so callers in lib/queries.ts stay terse.
export function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params as never[]);
}
