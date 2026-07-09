import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const m = readFileSync(join(root, ".env.local"), "utf8").match(/^DATABASE_URL=(.+)$/m);
if (!m) throw new Error("DATABASE_URL missing");
const url = m[1].trim();
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
console.log(r.rows[0]?.id ?? "");
await c.end();
