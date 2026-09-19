/**
 * A-3.2 — ACCOUNT DELETION FOUNDATION   ⚠️ LOCAL DESTRUCTIVE TEST ONLY
 *
 * พิสูจน์ T1–T25 ของสเปก A-3.2 บนฐานข้อมูลใช้แล้วทิ้ง
 * ไม่แตะ production · ไม่เรียก Supabase Storage จริง (mock ขอบเขตผู้ให้บริการ)
 *
 * วิธีรัน
 *   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=x \
 *     -e POSTGRES_DB=rizance_a32test postgres:16
 *   $env:A3_DATABASE_URL="postgres://postgres:x@127.0.0.1:5433/rizance_a32test"
 *   npm run test:account-deletion
 *
 *   มีของค้างจากรอบก่อน → $env:A3_RESET="1"
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// ══ §0 SAFETY GUARD — ต้องผ่านก่อนแตะอะไรทั้งสิ้น ═══════════════════
const url = process.env.A3_DATABASE_URL;
const die = (m: string): never => { console.error(`\n🛑 STOP — ${m}\n`); process.exit(2); };

if (!url) die('ไม่พบ A3_DATABASE_URL (จงใจไม่ใช้ DATABASE_URL เพื่อกันยิงโดน production)');
for (const bad of ["supabase", "pooler", "neon.tech", "rds.amazonaws", "azure", "render.com"]) {
  if (url!.toLowerCase().includes(bad)) die(`A3_DATABASE_URL มีคำว่า "${bad}" — ปฏิเสธ`);
}
let parsed: URL;
try { parsed = new URL(url!); } catch { die("A3_DATABASE_URL ไม่ใช่ URL ที่ถูกต้อง"); }
if (!["localhost", "127.0.0.1", "::1"].includes(parsed!.hostname)) {
  die(`host ต้องเป็น localhost/127.0.0.1 เท่านั้น — พบ "${parsed!.hostname}"`);
}
if (!parsed!.pathname.toLowerCase().includes("test")) {
  die(`ชื่อฐานข้อมูลต้องมีคำว่า "test" — พบ "${parsed!.pathname.slice(1)}"`);
}

// lib/db อ่าน DATABASE_URL ตอน import — ต้องตั้งก่อน dynamic import เสมอ
process.env.DATABASE_URL = url!;
process.env.SUPABASE_URL ??= "https://fake-storage.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "fake-service-key-for-tests";
process.env.JWT_SECRET ??= "a32-test-secret-value-32-characters";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");

let pass = 0, fail = 0;
const ok = (n: string) => { pass++; console.log(`PASS ${n}`); };
const bad = (n: string, d = "") => { fail++; console.log(`FAIL ${n}${d ? ` — ${d}` : ""}`); };
const check = (n: string, cond: boolean, d = "") => (cond ? ok(n) : bad(n, d));
const head = (t: string) => console.log(`\n== ${t} ${"=".repeat(Math.max(0, 58 - t.length))}`);

const MENU_BUCKET = "pos-menu";
const SLIP_BUCKET = "pos-slips";
const publicUrl = (bucket: string, key: string) =>
  `https://fake-storage.invalid/storage/v1/object/public/${bucket}/${key}`;

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: url! });
  await client.connect();
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    (await client.query<T>(sql, p as never[])).rows;

  console.log("A-3.2 ACCOUNT DELETION FOUNDATION");
  console.log(`DB: ${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`);
  console.log(`PostgreSQL: ${(await q<{ server_version: string }>("SHOW server_version"))[0].server_version}`);

  // ══ T1 · migrate from zero ════════════════════════════════════════
  head("T1 · FRESH MIGRATION FROM ZERO");
  const existing = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'`);
  if (existing[0].n > 0) {
    if (process.env.A3_RESET === "1") {
      await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
      console.log(`  รีเซ็ต schema public (มี ${existing[0].n} ตารางค้าง)`);
    } else {
      die(`schema public ไม่ว่าง (${existing[0].n} ตาราง) — ใช้ DB ใหม่ หรือ $env:A3_RESET="1"`);
    }
  }

  const migFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migFiles) {
    try {
      await client.query(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    } catch (e) {
      die(`migration ${f} ล้มเหลว — ${(e as { code?: string }).code ?? "?"} ${(e as Error).message}`);
    }
  }
  check("T1.1 migrations applied from zero", true, `${migFiles.length} ไฟล์`);
  check("T1.2 มี 0099_account_deletion_requests.sql", migFiles.includes("0099_account_deletion_requests.sql"));
  const tableCount = (await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'`))[0].n;
  console.log(`  migrations=${migFiles.length} · public tables=${tableCount}`);

  // FK → users ต้องไม่เปลี่ยนจาก 0099
  const fk = (await q<{ total: string; cascade: string; set_null: string; no_action: string; restrict: string }>(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE c.confdeltype='c') AS cascade,
           count(*) FILTER (WHERE c.confdeltype='n') AS set_null,
           count(*) FILTER (WHERE c.confdeltype='a') AS no_action,
           count(*) FILTER (WHERE c.confdeltype='r') AS restrict
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=cl.relnamespace
     WHERE c.contype='f' AND c.confrelid='public.users'::regclass AND n.nspname='public'`))[0];
  check("T1.3 FK→public.users ยัง 92/90/2/0/0 (0099 ไม่เพิ่ม FK)",
    fk.total === "92" && fk.cascade === "90" && fk.set_null === "2" && fk.no_action === "0" && fk.restrict === "0",
    `${fk.total}/${fk.cascade}/${fk.set_null}/${fk.no_action}/${fk.restrict}`);

  // ══ T3 · ไม่มี FK บนตารางคำขอ ═════════════════════════════════════
  head("T3 · NO FK ON account_deletion_requests");
  const adrFks = await q<{ conname: string }>(`
    SELECT c.conname FROM pg_constraint c
    JOIN pg_class cl ON cl.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=cl.relnamespace
   WHERE c.contype='f' AND n.nspname='public' AND cl.relname='account_deletion_requests'`);
  check("T3.1 account_deletion_requests ไม่มี FOREIGN KEY เลย", adrFks.length === 0,
    adrFks.map((r) => r.conname).join(", "));
  const adrIdx = await q<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='account_deletion_requests'`);
  check("T3.2 มี partial unique index กันคำขอซ้ำ",
    adrIdx.some((r) => r.indexname === "idx_account_deletion_requests_active"));

  // ══ โหลดโมดูลจริง (หลังตั้ง DATABASE_URL แล้วเท่านั้น) ════════════
  const pure = await import("../lib/account-deletion");
  const svc = await import("../lib/account-deletion-queries");

  // ══ fixtures ══════════════════════════════════════════════════════
  /**
   * insert แถวเดียว · เติมคอลัมน์ NOT NULL ที่ไม่มี default ให้อัตโนมัติตามชนิด
   * (ยกมาจาก harness A-3.0 ซึ่งพิสูจน์แล้วว่าทนต่อการเพิ่มคอลัมน์ในอนาคต —
   *  การระบุคอลัมน์เองทำให้ fixture พังทุกครั้งที่มี migration เพิ่ม NOT NULL)
   *
   * · uuid NOT NULL ที่ไม่มี default → throw เพราะน่าจะเป็น FK ที่ต้องระบุเอง
   * · ตารางที่ไม่มีคอลัมน์ id (PK ผสม เช่น production_recipe_items) → ไม่ใช้ RETURNING
   */
  const colCache = new Map<string, Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>>();
  async function insertRow(table: string, values: Record<string, unknown>): Promise<string | null> {
    let cols = colCache.get(table);
    if (!cols) {
      cols = await q<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1`, [table]);
      if (cols.length === 0) throw new Error(`ไม่พบตาราง ${table}`);
      colCache.set(table, cols);
    }

    const row: Record<string, unknown> = { ...values };
    for (const c of cols) {
      if (c.column_name in row) continue;
      if (c.is_nullable === "YES" || c.column_default !== null) continue;
      const t = c.data_type;
      if (t === "uuid") {
        throw new Error(`${table}.${c.column_name} เป็น uuid NOT NULL ไม่มี default — fixture ต้องระบุเอง (น่าจะเป็น FK)`);
      } else if (["character varying", "text", "character"].includes(t)) row[c.column_name] = "a32test";
      else if (["numeric", "integer", "bigint", "smallint", "double precision", "real"].includes(t)) row[c.column_name] = 1;
      else if (t === "boolean") row[c.column_name] = false;
      else if (t === "date") row[c.column_name] = "2026-01-01";
      else if (t.startsWith("timestamp")) row[c.column_name] = new Date().toISOString();
      else if (["json", "jsonb"].includes(t)) row[c.column_name] = "{}";
      else throw new Error(`${table}.${c.column_name} ชนิด ${t} — เติมค่าอัตโนมัติไม่ได้`);
    }

    const hasId = cols.some((c) => c.column_name === "id");
    const keys = Object.keys(row);
    const ph = keys.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${ph})` +
      (hasId ? " RETURNING id" : ""),
      keys.map((k) => row[k]) as never[],
    );
    return hasId ? (rows[0]?.id ?? null) : null;
  }

  const mkUser = async (tag: string): Promise<string> =>
    (await insertRow("users", {
      email: `a32-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@a32.invalid`,
      password_hash: "x",
      shop_name: `A32 ${tag}`,
    }))!;

  async function recipeFixture(uid: string) {
    const ing = (await insertRow("ingredients", { user_id: uid, name: "ING" }))!;
    const menu = (await insertRow("menu_items", { user_id: uid, name: "MENU" }))!;
    await insertRow("recipe_items", { menu_item_id: menu, ingredient_id: ing, quantity: 1 });
    return { ing, menu };
  }
  async function comboFixture(uid: string) {
    const p = (await insertRow("pos_products", {
      user_id: uid, name: "PROD", sell_price: 10, cost_price: 5,
    }))!;
    const c = (await insertRow("pos_combos", { user_id: uid, name: "COMBO", combo_price: 20 }))!;
    await insertRow("pos_combo_items", { combo_id: c, product_id: p });
    return { p, c };
  }
  async function productionFixture(uid: string) {
    const out = (await insertRow("ingredients", { user_id: uid, name: "SAUCE" }))!;
    const inp = (await insertRow("ingredients", { user_id: uid, name: "MAYO" }))!;
    const r = (await insertRow("production_recipes", {
      user_id: uid, output_ingredient_id: out, name: "PRD", expected_output_qty: 10,
    }))!;
    // trigger trg_production_recipe_no_self: ingredient ต้องไม่ใช่ output ของสูตรเดียวกัน
    await insertRow("production_recipe_items", { recipe_id: r, ingredient_id: inp, quantity: 1 });
    return { out, inp, r };
  }
  /** ไฟล์ที่ key ไม่มี userId — กู้ไม่ได้หลัง cascade */
  async function storageFixture(uid: string, tag: string) {
    const token = (await q<{ t: string }>(`SELECT gen_random_uuid()::text AS t`))[0].t;
    const order = (await insertRow("pos_orders", {
      user_id: uid, access_token: token, slip_url: publicUrl(SLIP_BUCKET, `${token}/1.jpg`),
    }))!;
    const chatUrl = publicUrl(SLIP_BUCKET, `chat/${order}/2.jpg`);
    await insertRow("pos_order_messages", { order_id: order, sender: "customer", kind: "chat", image_url: chatUrl });
    // ซ้ำโดยตั้งใจ — พิสูจน์ dedupe (T23)
    await insertRow("pos_order_messages", { order_id: order, sender: "shop", kind: "chat", image_url: chatUrl });
    await client.query(
      `UPDATE pos_products SET image_url=$2 WHERE user_id=$1 AND image_url IS NULL`,
      [uid, publicUrl(MENU_BUCKET, `${uid}/prod-${tag}.jpg`)]);
    return { token, order };
  }

  // ══ CONTROL user — ต้องไม่ถูกแตะเลยตลอดการทดลอง ═══════════════════
  head("CONTROL FIXTURE");
  const ctl = await mkUser("control");
  const ctlRecipe = await recipeFixture(ctl);
  const ctlCombo = await comboFixture(ctl);
  const ctlProd = await productionFixture(ctl);
  const ctlStorage = await storageFixture(ctl, "ctl");
  ok(`control user พร้อม (${ctl})`);

  const countOwned = async (uid: string): Promise<number> => {
    const tables = await q<{ table_name: string }>(`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
       WHERE c.table_schema='public' AND c.column_name='user_id' AND t.table_type='BASE TABLE'
         AND c.table_name <> 'account_deletion_requests'`);
    let n = 0;
    for (const t of tables) {
      n += Number((await q<{ c: string }>(`SELECT count(*) AS c FROM "${t.table_name}" WHERE user_id=$1`, [uid]))[0].c);
    }
    return n;
  };
  const ctlBefore = await countOwned(ctl);

  // ══ T4–T8 · deterministic deletion ต่อ fixture ════════════════════
  head("T4-T8 · DETERMINISTIC DELETION PER FIXTURE");
  const scenarios: Array<[string, (uid: string) => Promise<unknown>]> = [
    ["T4 EMPTY", async () => undefined],
    ["T5 RECIPE", recipeFixture],
    ["T6 COMBO", comboFixture],
    ["T7 PRODUCTION", productionFixture],
    ["T8 COMBINED", async (uid) => {
      await recipeFixture(uid); await comboFixture(uid);
      await productionFixture(uid); await storageFixture(uid, "t8");
    }],
  ];

  let combinedRequestId = "";
  let combinedUid = "";
  for (const [name, build] of scenarios) {
    const uid = await mkUser(name.split(" ")[0]);
    await build(uid);
    const req = await svc.createDeletionRequest(uid);
    const beforeManifest = (await q<{ n: number }>(
      `SELECT jsonb_array_length(storage_manifest)::int AS n FROM account_deletion_requests WHERE id=$1`,
      [req.id]))[0].n;
    const res = await svc.executeAccountDeletion({ requestId: req.id, authenticatedUserId: uid });
    if (!res.ok) { bad(`${name} deletion`, `${res.code} ${res.detail ?? ""}`); continue; }
    const gone = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [uid]))[0].n === 0;
    const left = await countOwned(uid);
    check(`${name} · ลบสำเร็จ`, res.ok && gone && left === 0,
      `gone=${gone} leftover=${left} pre=${JSON.stringify(res.rowsDeleted)}`);
    if (name.startsWith("T8")) {
      combinedRequestId = req.id; combinedUid = uid;
      check("T20.1 manifest ว่างก่อนเริ่มธุรกรรม", beforeManifest === 0, `${beforeManifest}`);
    }
  }

  // ══ T11–T14 · หลังลบ combined ═════════════════════════════════════
  head("T11-T14 · POST-DELETE INVARIANTS (COMBINED)");
  const adr = (await q<{
    status: string; db_deleted_at: string | null; storage_object_count: number;
    manifest: unknown[]; rows_deleted: Record<string, number> | null;
  }>(`SELECT status, db_deleted_at, storage_object_count,
             storage_manifest AS manifest, rows_deleted
        FROM account_deletion_requests WHERE id=$1`, [combinedRequestId]))[0];

  check("T11 ผู้ใช้เป้าหมายหายจริง",
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [combinedUid]))[0].n === 0);
  check("T12 ไม่มีแถว user_id ของเป้าหมายเหลือ", (await countOwned(combinedUid)) === 0);
  check("T13 คำขอยังอยู่หลังผู้ใช้ถูกลบ", !!adr);
  check("T14 status = db_deleted และมี db_deleted_at",
    adr.status === "db_deleted" && adr.db_deleted_at !== null, `${adr.status}`);
  check("T14.1 rows_deleted บันทึกครบ 4 รายการ",
    !!adr.rows_deleted && Object.keys(adr.rows_deleted).length === 4, JSON.stringify(adr.rows_deleted));

  // ══ T20–T23 · manifest ════════════════════════════════════════════
  head("T20-T23 · STORAGE MANIFEST");
  const manifest = (adr.manifest ?? []) as Array<{ bucket: string; key: string; kind: string }>;
  check("T20.2 manifest ถูกเก็บก่อนลบและอยู่ในคำขอ", manifest.length > 0, `${manifest.length} entries`);
  check("T21.1 มีสลิปที่ key ไม่ใช่ userId", manifest.some((m) => m.kind === "order_slip"));
  check("T21.2 มีรูปแชทที่ key ขึ้นต้น chat/", manifest.some((m) => m.kind === "order_chat" && m.key.startsWith("chat/")));
  check("T22 ไม่มี object ของ control user ปนมา",
    !manifest.some((m) => m.key.includes(ctl) || m.key.includes(ctlStorage.token) || m.key.includes(ctlStorage.order)));
  const keys = manifest.map((m) => `${m.bucket} ${m.key}`);
  check("T23 manifest ไม่มีคีย์ซ้ำ (มีรูปแชทซ้ำใน fixture)", new Set(keys).size === keys.length,
    `${keys.length} → ${new Set(keys).size}`);

  // ══ T9–T10 · control isolation ════════════════════════════════════
  head("T9-T10 · CONTROL ISOLATION");
  check("T9 control user ยังอยู่",
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [ctl]))[0].n === 1);
  check("T10.1 จำนวนแถวของ control ไม่เปลี่ยน", (await countOwned(ctl)) === ctlBefore,
    `${ctlBefore} → ${await countOwned(ctl)}`);
  for (const [label, sql, id] of [
    ["recipe_items", `SELECT count(*)::int AS n FROM recipe_items WHERE ingredient_id=$1`, ctlRecipe.ing],
    ["pos_combo_items", `SELECT count(*)::int AS n FROM pos_combo_items WHERE combo_id=$1`, ctlCombo.c],
    ["production_recipe_items", `SELECT count(*)::int AS n FROM production_recipe_items WHERE recipe_id=$1`, ctlProd.r],
  ] as const) {
    check(`T10.2 control ${label} ยังอยู่`, (await q<{ n: number }>(sql, [id]))[0].n === 1);
  }

  // ══ T15–T17 · rollback ════════════════════════════════════════════
  head("T15-T17 · FORCED FAILURE ROLLBACK");
  const boom = () => { throw new Error("injected_fault"); };
  for (const [name, hook] of [
    ["T15 ล้มก่อน pre-delete", { beforePreDeletes: boom }],
    ["T16 ล้มหลัง pre-delete ก่อนลบ users", { afterPreDeletes: boom }],
    ["T17 ล้มหลังลบ users ก่อนอัปเดตสถานะ", { afterUserDelete: boom }],
  ] as const) {
    const uid = await mkUser("rollback");
    await recipeFixture(uid); await comboFixture(uid); await productionFixture(uid);
    const before = await countOwned(uid);
    const req = await svc.createDeletionRequest(uid);
    const res = await svc.executeAccountDeletion({ requestId: req.id, authenticatedUserId: uid, faults: hook });
    const stillHere = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [uid]))[0].n === 1;
    const after = await countOwned(uid);
    const status = (await q<{ s: string }>(
      `SELECT status AS s FROM account_deletion_requests WHERE id=$1`, [req.id]))[0].s;
    check(`${name} → rollback ครบ`,
      !res.ok && stillHere && after === before && status === "requested",
      `ok=${res.ok} user=${stillHere} rows ${before}→${after} status=${status}`);
  }

  // ══ T25 · ไม่มีช่องว่าง user หาย แต่คำขอยัง requested ═════════════
  head("T25 · NO CRASH GAP");
  const orphan = await q<{ n: number }>(`
    SELECT count(*)::int AS n FROM account_deletion_requests r
     WHERE r.status = 'requested'
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)`);
  check("T25 ไม่มีคำขอ requested ที่ผู้ใช้หายไปแล้ว", orphan[0].n === 0, `${orphan[0].n}`);

  // ══ T18 · idempotency ═════════════════════════════════════════════
  head("T18 · IDEMPOTENCY");
  const idemUid = await mkUser("idem");
  await recipeFixture(idemUid);
  const r1 = await svc.createDeletionRequest(idemUid);
  const r2 = await svc.createDeletionRequest(idemUid);
  check("T18.1 createDeletionRequest ซ้ำ → ใบเดิม", r1.id === r2.id);
  const e1 = await svc.executeAccountDeletion({ requestId: r1.id, authenticatedUserId: idemUid });
  const e2 = await svc.executeAccountDeletion({ requestId: r1.id, authenticatedUserId: idemUid });
  check("T18.2 ลบครั้งแรกสำเร็จ", e1.ok && !("alreadyDone" in e1 && e1.alreadyDone));
  check("T18.3 ลบซ้ำ → alreadyDone ไม่ error ไม่ทำซ้ำ",
    e2.ok === true && "alreadyDone" in e2 && e2.alreadyDone === true);
  const dbDeletedCount = (await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM account_deletion_requests WHERE user_id=$1`, [idemUid]))[0].n;
  check("T18.4 มีคำขอใบเดียวเท่านั้น", dbDeletedCount === 1, `${dbDeletedCount}`);

  // ══ T19 · concurrency ═════════════════════════════════════════════
  head("T19 · CONCURRENCY");
  const ccUid = await mkUser("concurrent");
  await recipeFixture(ccUid); await comboFixture(ccUid);
  const ccReq = await svc.createDeletionRequest(ccUid);
  const [c1, c2] = await Promise.all([
    svc.executeAccountDeletion({ requestId: ccReq.id, authenticatedUserId: ccUid }),
    svc.executeAccountDeletion({ requestId: ccReq.id, authenticatedUserId: ccUid }),
  ]);
  const bothOk = c1.ok && c2.ok;
  const exactlyOneDidWork =
    (c1.ok && c2.ok) &&
    [("alreadyDone" in c1 && c1.alreadyDone), ("alreadyDone" in c2 && c2.alreadyDone)].filter((x) => x === false).length === 1;
  check("T19.1 ทั้งสองคำขอไม่ error", bothOk, `${JSON.stringify([c1, c2])}`);
  check("T19.2 มีแค่ตัวเดียวที่ลบจริง อีกตัวเป็น idempotent", exactlyOneDidWork);
  check("T19.3 ผู้ใช้หายไปครั้งเดียว สถานะไม่เพี้ยน",
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [ccUid]))[0].n === 0 &&
    (await q<{ s: string }>(`SELECT status AS s FROM account_deletion_requests WHERE id=$1`, [ccReq.id]))[0].s === "db_deleted");

  // ══ T2 · คำขอรอดหลังผู้ใช้หาย ═════════════════════════════════════
  head("T2 · DELETION REQUEST SURVIVES");
  check("T2 คำขอทุกใบยังอยู่แม้ผู้ใช้ถูกลบหมด",
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM account_deletion_requests`))[0].n >= 8);

  // ══ T24 + storage worker ══════════════════════════════════════════
  head("T24 + STORAGE CLEANUP");
  const unsafe = [
    "../../etc/passwd", "/absolute/key.jpg", "a//b.jpg", "a/../b.jpg", "a/./b.jpg",
    "key with space.jpg", "key\\back.jpg", "trailing/", "", "ก.jpg",
  ];
  check("T24.1 isSafeObjectKey ปฏิเสธคีย์อันตรายทุกแบบ",
    unsafe.every((k) => !pure.isSafeObjectKey(k)),
    unsafe.filter((k) => pure.isSafeObjectKey(k)).join(" | "));
  check("T24.2 isSafeObjectKey ยอมรับคีย์จริงของระบบ",
    ["abc/def-1.jpg", "chat/uuid/1.png", "brand/uuid/logo-1.webp", "shop-qr/uuid/1.jpg"]
      .every((k) => pure.isSafeObjectKey(k)));
  check("T24.3 bucket นอก allowlist ถูกปฏิเสธ",
    !pure.isValidManifestEntry({ bucket: "secrets", key: "a.jpg", kind: "order_slip" }, [MENU_BUCKET, SLIP_BUCKET]));

  // ฉีด entry อันตรายเข้า JSONB โดยตรง แล้วพิสูจน์ว่า worker ไม่ยิงลบมัน
  const injectUid = await mkUser("inject");
  await storageFixture(injectUid, "inj");
  const injReq = await svc.createDeletionRequest(injectUid);
  await svc.executeAccountDeletion({ requestId: injReq.id, authenticatedUserId: injectUid });
  await client.query(
    `UPDATE account_deletion_requests
        SET storage_manifest = storage_manifest || $2::jsonb
      WHERE id = $1`,
    [injReq.id, JSON.stringify([
      { bucket: "secrets", key: "../../etc/passwd", kind: "order_slip" },
      { bucket: SLIP_BUCKET, key: "../escape.jpg", kind: "order_slip" },
    ])]);

  const attemptedKeys: string[] = [];
  const mockDelete = async (bucket: string, key: string) => { attemptedKeys.push(`${bucket}/${key}`); };
  const cleanup = await svc.runStorageCleanup(injReq.id, { deleteObject: mockDelete });
  check("T24.4 worker ปฏิเสธ entry ที่ไม่ปลอดภัย ไม่ส่งไปลบ",
    !attemptedKeys.some((k) => k.includes("..") || k.startsWith("secrets/")),
    attemptedKeys.join(" | "));
  check("T24.5 worker รายงานจำนวนที่ถูกปฏิเสธ", (cleanup?.rejected ?? 0) === 2, `${cleanup?.rejected}`);
  check("S1 DB deletion commit ได้ก่อน storage cleanup", (cleanup?.attempted ?? 0) > 0);

  // storage ล้มบางส่วน → ไม่สร้างผู้ใช้กลับมา · สถานะบันทึกไว้ · retry ได้
  const failUid = await mkUser("storagefail");
  await storageFixture(failUid, "sf");
  const failReq = await svc.createDeletionRequest(failUid);
  await svc.executeAccountDeletion({ requestId: failReq.id, authenticatedUserId: failUid });
  let boomOnce = true;
  const flaky = async (_b: string, _k: string) => {
    if (boomOnce) { boomOnce = false; throw new Error("network"); }
  };
  const r3 = await svc.runStorageCleanup(failReq.id, { deleteObject: flaky });
  check("S2 storage ล้มบางส่วน → ไม่ complete", r3?.completed === false, JSON.stringify(r3));
  check("S3 ผู้ใช้ไม่ถูกสร้างกลับมาเมื่อ storage ล้ม",
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [failUid]))[0].n === 0);
  const failState = (await q<{ s: string; f: unknown[]; a: number }>(
    `SELECT storage_status AS s, storage_failed AS f, storage_attempts AS a
       FROM account_deletion_requests WHERE id=$1`, [failReq.id]))[0];
  check("S4 บันทึกสถานะล้มเหลวไว้ retry ได้", failState.s !== "done" && failState.a === 1, JSON.stringify(failState));
  const r4 = await svc.runStorageCleanup(failReq.id, { deleteObject: async () => undefined });
  check("S5 retry สำเร็จ → completed", r4?.completed === true, JSON.stringify(r4));
  const finalState = (await q<{ s: string; c: string | null }>(
    `SELECT status AS s, completed_at AS c FROM account_deletion_requests WHERE id=$1`, [failReq.id]))[0];
  check("S6 status=completed และมี completed_at", finalState.s === "completed" && finalState.c !== null);
  const r5 = await svc.runStorageCleanup(failReq.id, { deleteObject: async () => { throw new Error("should not run"); } });
  check("S7 cleanup ซ้ำหลัง completed ปลอดภัย (no-op)", r5?.completed === true && r5.attempted === 0);

  // ══ SECURITY ══════════════════════════════════════════════════════
  head("SECURITY");
  const victim = await mkUser("victim");
  await recipeFixture(victim);
  const attacker = await mkUser("attacker");
  const victimReq = await svc.createDeletionRequest(victim);
  const crossed = await svc.executeAccountDeletion({
    requestId: victimReq.id, authenticatedUserId: attacker,
  });
  check("SEC1 A ใช้ requestId ของ B ไม่ได้",
    crossed.ok === false && crossed.code === "request_not_owned", JSON.stringify(crossed));
  check("SEC2 requestId เพียงอย่างเดียวไม่ใช่ใบอนุญาต · victim ยังอยู่",
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [victim]))[0].n === 1);
  const ghost = await svc.executeAccountDeletion({
    requestId: victimReq.id, authenticatedUserId: "00000000-0000-4000-8000-000000000000",
  });
  check("SEC3 userId ที่ไม่มีจริงถูกปฏิเสธ", ghost.ok === false && ghost.code === "request_not_owned");
  const noReq = await svc.executeAccountDeletion({
    requestId: "00000000-0000-4000-8000-000000000001", authenticatedUserId: victim,
  });
  check("SEC4 requestId ที่ไม่มีจริงถูกปฏิเสธ", noReq.ok === false && noReq.code === "request_not_found");

  const cols = await q<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='account_deletion_requests'`);
  const forbidden = ["password", "token", "jwt", "secret", "session", "email", "stripe"];
  const leak = cols.filter((c) => forbidden.some((f) => c.column_name.toLowerCase().includes(f)));
  check("SEC5 ไม่มีคอลัมน์ที่เก็บความลับ/PII", leak.length === 0, leak.map((c) => c.column_name).join(", "));

  // ══ STATE MACHINE (pure) ══════════════════════════════════════════
  head("STATE MACHINE");
  check("SM1 requested→db_deleted อนุญาต", pure.canTransition("requested", "db_deleted"));
  check("SM2 db_deleted→completed อนุญาต", pure.canTransition("db_deleted", "completed"));
  check("SM3 db_deleted→requested ห้าม", !pure.canTransition("db_deleted", "requested"));
  check("SM4 requested→completed ห้าม (ข้ามขั้น)", !pure.canTransition("requested", "completed"));
  check("SM5 completed→อะไรก็ห้าม",
    pure.DELETION_STATUSES.every((s) => !pure.canTransition("completed", s)));
  check("SM6 failed→อะไรก็ห้าม",
    pure.DELETION_STATUSES.every((s) => !pure.canTransition("failed", s)));
  check("SM7 isActiveStatus ตรงกับ partial index",
    pure.isActiveStatus("requested") && pure.isActiveStatus("db_deleted") &&
    !pure.isActiveStatus("completed") && !pure.isActiveStatus("failed"));
  check("SM8 normalizeManifest dedupe + reject",
    (() => {
      const r = pure.normalizeManifest(
        [{ bucket: MENU_BUCKET, key: "a/b.jpg", kind: "brand_logo" },
         { bucket: MENU_BUCKET, key: "a/b.jpg", kind: "brand_logo" },
         { bucket: "evil", key: "a.jpg", kind: "brand_logo" },
         { bucket: MENU_BUCKET, key: "../x", kind: "brand_logo" }],
        [MENU_BUCKET, SLIP_BUCKET]);
      return r.entries.length === 1 && r.rejected === 2;
    })());

  // ══ PRECHECK ══════════════════════════════════════════════════════
  head("PRECHECK");
  const pcUid = await mkUser("precheck");
  await recipeFixture(pcUid); await storageFixture(pcUid, "pc");
  await insertRow("payroll_periods", {
    user_id: pcUid, period_start: "2026-01-01", period_end: "2026-01-15", status: "draft",
  });
  const pc = await svc.runAccountDeletionPrecheck(pcUid);
  check("PC1 ไม่มี blocker สำหรับผู้ใช้ปกติ", pc.canRequest === true && pc.blockers.length === 0,
    JSON.stringify(pc.blockers));
  check("PC2 เตือนงวดเงินเดือนที่เปิดอยู่", pc.warnings.some((w) => w.code === "open_payroll_period"));
  check("PC3 นับไฟล์ที่จะถูกลบได้", pc.storageObjectCount > 0, `${pc.storageObjectCount}`);
  check("PC4 รายงานนโยบายที่ยังไม่ปิดครบ 4 ข้อ", pc.policyPending.length === 4);
  check("PC5 รหัสทุกตัวเป็น machine-readable",
    [...pc.blockers, ...pc.warnings, ...pc.policyPending].every((f) => /^[a-z0-9_]+$/.test(f.code)));
  await svc.createDeletionRequest(pcUid);
  const pc2 = await svc.runAccountDeletionPrecheck(pcUid);
  check("PC6 มีคำขอค้างอยู่ → block", pc2.canRequest === false &&
    pc2.blockers.some((b) => b.code === "deletion_already_in_progress"));
  const goneUser = "00000000-0000-4000-8000-0000000000ff";
  const pc3 = await svc.runAccountDeletionPrecheck(goneUser);
  check("PC7 ผู้ใช้ไม่มีจริง → no_live_user", pc3.blockers.some((b) => b.code === "no_live_user"));

  // ══ FINAL CONTROL RE-CHECK ════════════════════════════════════════
  head("FINAL CONTROL RE-CHECK");
  check("FINAL control user ยังอยู่ครบหลังทุกการทดลอง",
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id=$1`, [ctl]))[0].n === 1 &&
    (await countOwned(ctl)) === ctlBefore);

  head("SUMMARY");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  console.log("\n⚠️ ฐานข้อมูลนี้ใช้แล้วทิ้ง — dropdb ได้เลย");
  await client.end();
  const db = await import("../lib/db");
  await db.pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\n🛑 harness ล้มเหลว:", e);
  process.exit(3);
});
