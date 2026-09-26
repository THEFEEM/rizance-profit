/**
 * AUTH-HOTFIX-1 — POS HANDOFF · single-use semantics บน Postgres จริง (LOCAL TEST DB ONLY)
 *
 * พิสูจน์สิ่งที่ in-memory store พิสูจน์ไม่ได้: UPDATE … WHERE consumed_at IS NULL เป็น atomic
 * ภายใต้การแข่งกันจริง · FK CASCADE ทำงาน · แถวหมดอายุ consume ไม่ได้
 *
 * ใช้ A3_DATABASE_URL (guard เดียวกับ A-3 harness): localhost เท่านั้น · ชื่อ DB ต้องมี "test" · ปฏิเสธ hosted
 * ต้องมีตาราง users อยู่แล้ว (migration ชุดเดิม) · ไฟล์นี้ apply 0100 ให้เองบน test DB
 *
 *   $env:A3_DATABASE_URL="postgres://postgres:x@127.0.0.1:5433/rizance_a32test"
 *   npm run test:pos-handoff-db
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

function die(msg: string): never { console.error(`🛑 ${msg}`); process.exit(2); }
const url = process.env.A3_DATABASE_URL;
if (!url) die('ไม่พบ A3_DATABASE_URL (จงใจไม่ใช้ DATABASE_URL เพื่อกันยิงโดน production)');
for (const bad of ["supabase", "pooler", "neon.tech", "rds.amazonaws", "azure", "render.com"]) {
  if (url!.toLowerCase().includes(bad)) die(`A3_DATABASE_URL มีคำว่า "${bad}" — ปฏิเสธ`);
}
let parsed: URL;
try { parsed = new URL(url!); } catch { die("A3_DATABASE_URL ไม่ใช่ URL ที่ถูกต้อง"); }
if (!["localhost", "127.0.0.1", "::1"].includes(parsed!.hostname)) die(`host ต้องเป็น localhost เท่านั้น — พบ "${parsed!.hostname}"`);
if (!parsed!.pathname.toLowerCase().includes("test")) die(`ชื่อ DB ต้องมีคำว่า test — พบ "${parsed!.pathname}"`);

process.env.DATABASE_URL = url; // ให้ lib/db ชี้ test DB
process.env.JWT_SECRET = "test-only-secret-for-pos-handoff-db-check-0000";
delete process.env.VERCEL;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 12 });

  // bootstrap DB เปล่า: migrations เรียงลำดับล้วน (0001…0099) — **ห้ามใช้ db/schema.sql**
  // (บทเรียน A-3.0: schema.sql มี forward-reference FK บรรทัด 287 รันบน DB เปล่าไม่ผ่าน)
  // ข้ามถ้ามีตาราง users แล้ว (รันซ้ำได้)
  const { rows: probe } = await pool.query<{ ok: string | null }>(`SELECT to_regclass('public.users')::text AS ok`);
  if (!probe[0]?.ok) {
    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith("0100_")).sort();
    const client = await pool.connect();
    try {
      for (const f of files) await client.query(readFileSync(join(dir, f), "utf8"));
    } finally {
      client.release();
    }
    const { rows: n } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema='public'`);
    check(`0.0 bootstrap DB เปล่าด้วย migrations ${files.length} ไฟล์ → ${n[0]!.n} ตาราง`, Number(n[0]!.n) > 50);
  } else {
    check("0.0 schema มีอยู่แล้ว (users พบ) — ข้าม bootstrap", true);
  }

  const mig = readFileSync(join(process.cwd(), "db/migrations/0100_pos_handoff_tokens.sql"), "utf8");
  await pool.query(mig);
  check("0.1 apply 0100 บน test DB (idempotent)", true);
  await pool.query(mig);
  check("0.2 apply ซ้ำไม่พัง (IF NOT EXISTS)", true);

  const handoff = await import("../lib/pos-handoff");

  // fixture user (synthetic)
  const { rows: u } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, shop_name) VALUES ($1, $2, $3) RETURNING id`,
    [`handoff-test-${Date.now()}@example.invalid`, "x", "handoff test"],
  );
  const userId = u[0]!.id;
  const { rows: u2 } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, shop_name) VALUES ($1, $2, $3) RETURNING id`,
    [`handoff-test-other-${Date.now()}@example.invalid`, "x", "other"],
  );
  const otherId = u2[0]!.id;

  try {
    // 1 · create → consume → consume
    const t = await handoff.createHandoffToken(userId, "https://pos.rizance.app/");
    const v = await handoff.verifyHandoffToken(t);
    check("1.1 verify ok", v.ok);
    if (!v.ok) throw new Error("verify failed");
    check("1.2 consume ครั้งแรก = ok", (await handoff.consumeHandoff(v.claims)).ok);
    const second = await handoff.consumeHandoff(v.claims);
    check("1.3 consume ครั้งสอง = consumed_or_unknown", !second.ok && second.reason === "consumed_or_unknown");
    const { rows: r1 } = await pool.query(`SELECT consumed_at FROM pos_handoff_tokens WHERE jti_hash = $1`, [handoff.hashJti(v.claims.jti)]);
    check("1.4 consumed_at ถูกตั้ง 1 แถว", r1.length === 1 && r1[0]!.consumed_at !== null);

    // 2 · race: N consumes พร้อมกัน → ผ่านได้ 1 เท่านั้น
    const t2 = await handoff.createHandoffToken(userId, "https://pos.rizance.app/");
    const v2 = await handoff.verifyHandoffToken(t2);
    if (!v2.ok) throw new Error("verify2 failed");
    const results = await Promise.all(Array.from({ length: 10 }, () => handoff.consumeHandoff(v2.claims)));
    const wins = results.filter((r) => r.ok).length;
    check("2.1 race 10 ตัวพร้อมกัน → ผ่าน 1 เท่านั้น (atomic)", wins === 1, `wins=${wins}`);

    // 3 · หมดอายุใน DB → consume ไม่ได้ แม้ token ยังไม่ถึง exp (DB เป็นด่านสุดท้าย)
    const t3 = await handoff.createHandoffToken(userId, "https://pos.rizance.app/");
    const v3 = await handoff.verifyHandoffToken(t3);
    if (!v3.ok) throw new Error("verify3 failed");
    await pool.query(`UPDATE pos_handoff_tokens SET expires_at = now() - interval '1 second' WHERE jti_hash = $1`, [handoff.hashJti(v3.claims.jti)]);
    check("3.1 แถวหมดอายุ → consume ล้มเหลว", !(await handoff.consumeHandoff(v3.claims)).ok);

    // 4 · user อื่นถือ token ของคนอื่นไม่ได้ (sub ไม่ตรง user_id)
    const t4 = await handoff.createHandoffToken(userId, "https://pos.rizance.app/");
    const v4 = await handoff.verifyHandoffToken(t4);
    if (!v4.ok) throw new Error("verify4 failed");
    check("4.1 consume ด้วย userId อื่น → ล้มเหลว", !(await handoff.consumeHandoff({ ...v4.claims, userId: otherId })).ok);
    check("4.2 …แล้วเจ้าของจริงยังใช้ได้ (ไม่ถูกเผา)", (await handoff.consumeHandoff(v4.claims)).ok);

    // 5 · FK cascade: ลบ user → แถวหาย → token ที่ยังไม่ใช้ consume ไม่ได้
    const t5 = await handoff.createHandoffToken(otherId, "https://pos.rizance.app/");
    const v5 = await handoff.verifyHandoffToken(t5);
    if (!v5.ok) throw new Error("verify5 failed");
    await pool.query(`DELETE FROM users WHERE id = $1`, [otherId]);
    const { rows: r5 } = await pool.query(`SELECT 1 FROM pos_handoff_tokens WHERE user_id = $1`, [otherId]);
    check("5.1 ลบ user → แถว handoff หาย (CASCADE) — ไม่บล็อก account deletion", r5.length === 0);
    check("5.2 …token ของ user ที่ถูกลบ consume ไม่ได้", !(await handoff.consumeHandoff(v5.claims)).ok);

    // 6 · ไม่มี token ดิบใน DB
    const { rows: r6 } = await pool.query<{ jti_hash: string }>(`SELECT jti_hash FROM pos_handoff_tokens WHERE user_id = $1`, [userId]);
    check("6.1 ทุกแถวเก็บ sha256 hex 64 ตัว", r6.every((r) => /^[0-9a-f]{64}$/.test(r.jti_hash)));
    check("6.2 ไม่มีค่าใดเท่ากับ token/jti ดิบ", r6.every((r) => ![t, t2, t3, t4].includes(r.jti_hash)));
  } finally {
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[userId, otherId]]);
    await pool.end();
    const { pool: appPool } = await import("../lib/db");
    await appPool.end();
  }

  console.log(`\nPASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\n🛑 harness error:", e); process.exit(3); });
