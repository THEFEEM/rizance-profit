import type { PoolClient } from "pg";
import { pool, query } from "@/lib/db";
import {
  deleteObject as realDeleteObject,
  objectPathFromPublicUrl,
  posMenuBucket,
  posSlipBucket,
} from "@/lib/supabase-storage";
import {
  type AccountDeletionPrecheck,
  type DeletionExecutionResult,
  type DeletionStatus,
  type PrecheckFinding,
  type PrecheckWarnCode,
  type StorageManifestEntry,
  type StorageObjectKind,
  isSafeObjectKey,
  isValidManifestEntry,
  nextStorageStatus,
  normalizeManifest,
  pendingPolicyFindings,
} from "@/lib/account-deletion";

/**
 * A-3.2 — Account deletion engine (ฐานราก · ยังไม่มี endpoint ยังไม่มี UI)
 *
 * ═══ สิ่งที่ไฟล์นี้ **ไม่** ทำ ═══════════════════════════════════════
 *   · ไม่รับ userId จาก client — ผู้เรียกต้องส่ง user ที่ยืนยันจาก DB แล้ว
 *   · ไม่ค้นหา constraint ตอน runtime — ลำดับการลบเป็นค่าคงที่ที่ review แล้ว
 *   · ไม่มี DELETE ที่ไม่มีขอบเขต — ทุก predicate ผูกกับเจ้าของเสมอ
 *   · ไม่แตะ schema นอก public (jarvis เป็นเรื่องนโยบาย ไม่ใช่โค้ด)
 *   · ไม่ยกเลิก subscription · ไม่แตะ Stripe · ไม่คืนเงิน
 */

export const ALLOWED_STORAGE_BUCKETS = (): string[] => [posMenuBucket(), posSlipBucket()];

// ══════════════════════════════════════════════════════════════════════
//  ลำดับการลบที่กำหนดตายตัว (deterministic pre-deletes)
// ══════════════════════════════════════════════════════════════════════
//
// ทำไมมีแค่ 3 ตาราง — พิสูจน์จาก catalog ปัจจุบัน ไม่ใช่จากเอกสาร:
//
//   FK ที่เป็น RESTRICT/NO ACTION ในทรีของ users มีหลายตัว แต่เกือบทั้งหมด
//   อยู่บนตารางที่ **มีคอลัมน์ user_id เอง** จึงถูกลบพร้อมกันในคลื่น cascade
//   แรกจาก users → ตัวที่ RESTRICT ชี้ไปหาจึงไม่เหลืออะไรให้ห้าม
//
//   เหลือเพียง 3 ตารางที่ **ไม่มี user_id** และมี FK RESTRICT ชี้ออกไปหา
//   ตารางที่ user_id cascade:
//
//     recipe_items              menu_item_id→menu_items CASCADE  · ingredient_id→ingredients RESTRICT
//                               (db/schema.sql:202-208 · 0003_cost_pricing.sql:29-35)
//     production_recipe_items   recipe_id→production_recipes CASCADE · ingredient_id→ingredients RESTRICT
//                               (0089_production.sql:96-103 — PK ผสม ไม่มีคอลัมน์ id)
//     pos_combo_items           combo_id→pos_combos CASCADE · product_id→pos_products RESTRICT
//                               (0071_loyalty_economy_and_combos.sql:159-166)
//
//   ตรงกับผลการทดลอง A-3.0 บน PostgreSQL 16 ทุกประการ (T1/T2/T4/T7 BLOCKED
//   แล้วผ่านหลังลบสามตารางนี้)
//
// ⚠️ ความเปราะบางที่ต้องรู้: PostgreSQL ไม่รับประกันลำดับของ cascade action
//    ระหว่างกัน ตารางที่ "ไม่บล็อกวันนี้" อาจบล็อกในเวอร์ชันหน้าได้
//    → integration test ต้องรันลำดับนี้บน DB สดทุกครั้งใน CI ไม่ใช่เชื่อครั้งเดียว
//
// ⚠️ ถ้ามีแถวข้ามผู้เช่า (recipe_item ที่ menu_item เป็นของคนอื่นแต่ ingredient
//    เป็นของเรา — สภาพที่ไม่ควรเกิดในระบบ single-tenant) predicate นี้จะ
//    **ไม่ลบให้** และธุรกรรมจะล้มด้วย 23503 แล้ว rollback ทั้งหมด
//    นั่นคือพฤติกรรมที่ถูกต้อง: ล้มแบบปิด ดีกว่าลบข้อมูลของผู้เช่ารายอื่นเงียบ ๆ

type PreDeleteStep = { table: string; sql: string };

export const PRE_DELETE_SEQUENCE: readonly PreDeleteStep[] = [
  {
    table: "recipe_items",
    sql: `DELETE FROM recipe_items
           WHERE menu_item_id IN (SELECT id FROM menu_items WHERE user_id = $1)`,
  },
  {
    table: "production_recipe_items",
    sql: `DELETE FROM production_recipe_items
           WHERE recipe_id IN (SELECT id FROM production_recipes WHERE user_id = $1)`,
  },
  {
    table: "pos_combo_items",
    sql: `DELETE FROM pos_combo_items
           WHERE combo_id IN (SELECT id FROM pos_combos WHERE user_id = $1)`,
  },
] as const;

// ══════════════════════════════════════════════════════════════════════
//  Storage manifest collector
// ══════════════════════════════════════════════════════════════════════
//
// ต้องเก็บ **ก่อน** แถว DB หาย เพราะสองตระกูลนี้กู้คืนไม่ได้เลยหลัง cascade:
//
//   pos_orders.slip_url          key = "{access_token}/{ms}.{ext}"  ← ไม่มี userId
//   pos_order_messages.image_url key = "chat/{order_id}/{ms}.{ext}" ← ไม่มี userId
//
// ทั้งสองแถวถูก CASCADE ทิ้ง (pos_orders.user_id→users · pos_order_messages.order_id
// →pos_orders ที่ 0062_pos_order_chat.sql:19) ⇒ access_token และ order_id ที่ใช้
// ประกอบ key หายไปพร้อมกัน และ list ด้วย prefix ก็ทำไม่ได้
//
// อีกห้าตระกูลมี userId อยู่ในคีย์ จึงกู้ด้วย prefix listing ได้ถ้าพลาด
// แต่เก็บไว้ด้วยเพื่อให้ลบได้ตรงและนับจำนวนได้แม่น

type UrlRow = { url: string | null };

async function collectFromUrls(
  client: PoolClient,
  sql: string,
  userId: string,
  bucket: string,
  kind: StorageObjectKind,
  out: StorageManifestEntry[],
): Promise<void> {
  const { rows } = await client.query<UrlRow>(sql, [userId]);
  for (const row of rows) {
    if (!row.url) continue;
    const key = objectPathFromPublicUrl(bucket, row.url);
    // key ที่ parse ไม่ได้ (เช่นถูกเปลี่ยนไปใช้ signed URL) จะถูกทิ้งที่นี่
    // แล้วไปโผล่เป็น `rejected` ให้ผู้เรียกเห็น ไม่กลืนเงียบ
    if (key !== null) out.push({ bucket, key, kind });
  }
}

/**
 * รวบรวม object ทั้งหมดของผู้ใช้ — เรียกภายในธุรกรรมเดียวกับการลบเสมอ
 * (snapshot สอดคล้องกัน และถูกบันทึกลงคำขอแบบ atomic)
 */
export async function collectStorageManifest(
  client: PoolClient,
  userId: string,
): Promise<{ entries: StorageManifestEntry[]; rejected: number }> {
  const menu = posMenuBucket();
  const slip = posSlipBucket();
  const raw: StorageManifestEntry[] = [];

  await collectFromUrls(client,
    `SELECT image_url AS url FROM pos_products WHERE user_id = $1 AND image_url IS NOT NULL`,
    userId, menu, "pos_product_image", raw);

  await collectFromUrls(client,
    `SELECT image_url AS url FROM pos_combos WHERE user_id = $1 AND image_url IS NOT NULL`,
    userId, menu, "pos_combo_image", raw);

  await collectFromUrls(client,
    `SELECT brand_logo_url AS url FROM pos_shop_settings WHERE user_id = $1 AND brand_logo_url IS NOT NULL`,
    userId, menu, "brand_logo", raw);

  // hero image ของ voucher ไม่มีคอลัมน์ของตัวเอง — อยู่ใน JSONB (0094:60)
  await collectFromUrls(client,
    `SELECT design_config->>'heroImageUrl' AS url
       FROM pos_voucher_campaigns
      WHERE user_id = $1 AND design_config->>'heroImageUrl' IS NOT NULL`,
    userId, menu, "voucher_hero", raw);

  // ⚠️ shop QR อยู่ใน bucket pos-slips ไม่ใช่ pos-menu แม้คอมเมนต์ใน
  //    0066_pos_shop_qr.sql:15 จะบอกว่า "bucket เดิม" — โค้ดจริงใช้ posSlipBucket()
  await collectFromUrls(client,
    `SELECT shop_qr_url AS url FROM pos_shop_settings WHERE user_id = $1 AND shop_qr_url IS NOT NULL`,
    userId, slip, "shop_qr", raw);

  // ★ กู้ไม่ได้หลังลบ DB
  await collectFromUrls(client,
    `SELECT slip_url AS url FROM pos_orders WHERE user_id = $1 AND slip_url IS NOT NULL`,
    userId, slip, "order_slip", raw);

  // ★ กู้ไม่ได้หลังลบ DB
  await collectFromUrls(client,
    `SELECT m.image_url AS url
       FROM pos_order_messages m
       JOIN pos_orders o ON o.id = m.order_id
      WHERE o.user_id = $1 AND m.image_url IS NOT NULL`,
    userId, slip, "order_chat", raw);

  return normalizeManifest(raw, [menu, slip]);
}

// ══════════════════════════════════════════════════════════════════════
//  วงจรชีวิตคำขอ
// ══════════════════════════════════════════════════════════════════════

export type DeletionRequestRow = {
  id: string;
  user_id: string;
  status: DeletionStatus;
  storage_status: string;
  storage_object_count: number;
  storage_deleted_count: number;
  storage_attempts: number;
  created_at: Date | string;
  db_deleted_at: Date | string | null;
  completed_at: Date | string | null;
  failure_code: string | null;
};

const REQUEST_RETURN = `id, user_id, status, storage_status, storage_object_count,
  storage_deleted_count, storage_attempts, created_at, db_deleted_at, completed_at, failure_code`;

/** คำขอที่ยังทำงานอยู่ของผู้ใช้ (ไม่เกินหนึ่งใบ — บังคับด้วย partial unique index ใน 0099) */
export async function findActiveDeletionRequest(userId: string): Promise<DeletionRequestRow | null> {
  const { rows } = await query<DeletionRequestRow>(
    `SELECT ${REQUEST_RETURN} FROM account_deletion_requests
      WHERE user_id = $1 AND status IN ('requested', 'db_deleted')
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function getDeletionRequest(requestId: string): Promise<DeletionRequestRow | null> {
  const { rows } = await query<DeletionRequestRow>(
    `SELECT ${REQUEST_RETURN} FROM account_deletion_requests WHERE id = $1`,
    [requestId],
  );
  return rows[0] ?? null;
}

/**
 * สร้างคำขอ — idempotent: ถ้ามีใบที่ยังทำงานอยู่แล้ว คืนใบเดิม
 * การกันซ้ำจริงอยู่ที่ฐานข้อมูล (unique index) ไม่ใช่ที่โค้ดนี้
 */
export async function createDeletionRequest(userId: string): Promise<DeletionRequestRow> {
  const { rows } = await query<DeletionRequestRow>(
    `INSERT INTO account_deletion_requests (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) WHERE status IN ('requested', 'db_deleted') DO NOTHING
     RETURNING ${REQUEST_RETURN}`,
    [userId],
  );
  if (rows[0]) return rows[0];

  // ชน index = มีใบเดิมอยู่แล้ว → คืนใบเดิม (retry ต้องได้ใบเดียวกัน)
  const existing = await findActiveDeletionRequest(userId);
  if (!existing) throw new Error("deletion_request_conflict_without_row");
  return existing;
}

// ══════════════════════════════════════════════════════════════════════
//  เครื่องยนต์ลบข้อมูลใน PostgreSQL — ธุรกรรมเดียว
// ══════════════════════════════════════════════════════════════════════

/**
 * จุดแทรกความล้มเหลว **สำหรับเทสเท่านั้น**
 * ไม่มี route ใดส่งค่านี้ และจะไม่มี — มันมีไว้พิสูจน์ว่า rollback ทำงานจริง
 */
export type DeletionFaultHooks = {
  beforePreDeletes?: () => void | Promise<void>;
  afterPreDeletes?: () => void | Promise<void>;
  afterUserDelete?: () => void | Promise<void>;
};

/**
 * ลบข้อมูลของผู้ใช้ออกจาก PostgreSQL ทั้งหมด ในธุรกรรมเดียว
 *
 * ขอบเขต atomic (สำคัญที่สุดของเฟสนี้):
 *   BEGIN
 *     ล็อกแถวคำขอ (FOR UPDATE) + ตรวจว่าเป็นของผู้ใช้คนนี้จริง
 *     ล็อกแถว users (FOR UPDATE)
 *     เก็บ manifest แล้วบันทึกลงคำขอ
 *     pre-delete 3 ตารางตามลำดับตายตัว
 *     DELETE FROM users  (ต้องได้ rowCount = 1 พอดี)
 *     UPDATE คำขอ → db_deleted + db_deleted_at
 *   COMMIT
 *
 * ⇒ ไม่มีช่องว่างที่ "ผู้ใช้ถูกลบแล้วแต่คำขอยังเป็น requested"
 *    ถ้า process ตายก่อน COMMIT ทุกอย่างย้อนกลับหมด
 *
 * @param authenticatedUserId ต้องมาจาก getCurrentUser() ที่ตรวจ DB แล้วเท่านั้น
 */
export async function executeAccountDeletion(params: {
  requestId: string;
  authenticatedUserId: string;
  /** เทสเท่านั้น */
  faults?: DeletionFaultHooks;
}): Promise<DeletionExecutionResult> {
  const { requestId, authenticatedUserId, faults } = params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1 · ล็อกคำขอ + ผูกกับผู้ใช้ที่ยืนยันแล้ว (ไม่เชื่อ requestId เพียงอย่างเดียว)
    const reqRes = await client.query<{ id: string; status: DeletionStatus; user_id: string }>(
      `SELECT id, status, user_id FROM account_deletion_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = reqRes.rows[0];
    if (!request) {
      await client.query("ROLLBACK");
      return { ok: false, code: "request_not_found" };
    }
    if (request.user_id !== authenticatedUserId) {
      // requestId ไม่ใช่ใบอนุญาต — ต้องเป็นของผู้ใช้ที่ล็อกอินอยู่เท่านั้น
      await client.query("ROLLBACK");
      return { ok: false, code: "request_not_owned" };
    }
    if (request.status === "db_deleted" || request.status === "completed") {
      // idempotent: ทำไปแล้ว ไม่ทำซ้ำ
      await client.query("ROLLBACK");
      return {
        ok: true, status: request.status, alreadyDone: true,
        rowsDeleted: {}, storageObjectCount: 0,
      };
    }
    if (request.status === "failed") {
      await client.query("ROLLBACK");
      return { ok: false, code: "request_failed_state" };
    }

    // 2 · ผู้ใช้ต้องยังมีอยู่จริง และถูกล็อกไว้จนจบธุรกรรม
    const userRes = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
      [authenticatedUserId],
    );
    if (userRes.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { ok: false, code: "user_not_found" };
    }

    // 3 · manifest ต้องถูกเก็บก่อนแถวหาย และบันทึกใน transaction เดียวกัน
    const manifest = await collectStorageManifest(client, authenticatedUserId);
    await client.query(
      `UPDATE account_deletion_requests
          SET storage_manifest = $2::jsonb,
              storage_object_count = $3,
              storage_status = CASE WHEN $3 = 0 THEN 'done' ELSE 'pending' END,
              updated_at = now()
        WHERE id = $1`,
      [requestId, JSON.stringify(manifest.entries), manifest.entries.length],
    );

    await faults?.beforePreDeletes?.();

    // 4 · pre-delete ตามลำดับตายตัว (ไม่มีการค้นหา constraint ตอน runtime)
    const rowsDeleted: Record<string, number> = {};
    for (const step of PRE_DELETE_SEQUENCE) {
      const res = await client.query(step.sql, [authenticatedUserId]);
      rowsDeleted[step.table] = res.rowCount ?? 0;
    }

    await faults?.afterPreDeletes?.();

    // 5 · ลบผู้ใช้เป็นลำดับสุดท้าย — ที่เหลือ 89 FK CASCADE จัดการเอง
    const del = await client.query(`DELETE FROM users WHERE id = $1`, [authenticatedUserId]);
    if (del.rowCount !== 1) {
      throw Object.assign(new Error("user_delete_rowcount"), { __code: "user_delete_rowcount" });
    }
    rowsDeleted.users = del.rowCount;

    await faults?.afterUserDelete?.();

    // 6 · ปิดสถานะในธุรกรรมเดียวกัน — นี่คือหัวใจของเฟสนี้
    await client.query(
      `UPDATE account_deletion_requests
          SET status = 'db_deleted',
              db_deleted_at = now(),
              updated_at = now(),
              rows_deleted = $2::jsonb
        WHERE id = $1`,
      [requestId, JSON.stringify(rowsDeleted)],
    );

    await client.query("COMMIT");
    return {
      ok: true, status: "db_deleted", alreadyDone: false,
      rowsDeleted, storageObjectCount: manifest.entries.length,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection อาจตายไปแล้ว */ }
    const code = (err as { __code?: string }).__code === "user_delete_rowcount"
      ? "user_delete_rowcount" as const
      : "db_error" as const;
    return { ok: false, code, detail: (err as Error)?.message?.slice(0, 300) };
  } finally {
    client.release();
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Storage cleanup — หลัง COMMIT เท่านั้น
// ══════════════════════════════════════════════════════════════════════
//
// ห้ามถือ transaction ของ Postgres ค้างไว้ระหว่างรอเครือข่าย
// ห้ามให้ความล้มเหลวของ storage ย้อนกลับการลบใน DB (ทำไม่ได้อยู่แล้ว
// เพราะ commit ไปแล้ว — จึงต้องออกแบบให้ retry ได้แทน)

export type StorageCleanupResult = {
  requestId: string;
  attempted: number;
  deleted: number;
  failed: number;
  rejected: number;
  status: string;
  completed: boolean;
};

export async function runStorageCleanup(
  requestId: string,
  deps?: { deleteObject?: (bucket: string, key: string) => Promise<void> },
): Promise<StorageCleanupResult | null> {
  const remove = deps?.deleteObject ?? realDeleteObject;
  const allowed = ALLOWED_STORAGE_BUCKETS();

  const { rows } = await query<{
    id: string; status: DeletionStatus; storage_status: string;
    storage_manifest: unknown[]; storage_failed: unknown[]; storage_deleted_count: number;
  }>(
    `SELECT id, status, storage_status, storage_manifest, storage_failed, storage_deleted_count
       FROM account_deletion_requests WHERE id = $1`,
    [requestId],
  );
  const req = rows[0];
  if (!req) return null;
  if (req.status === "completed") {
    return { requestId, attempted: 0, deleted: 0, failed: 0, rejected: 0, status: "done", completed: true };
  }
  if (req.status !== "db_deleted") return null; // ยังไม่ถึงขั้นนี้ หรือ failed ก่อนลบ

  // retry ต้องหยิบเฉพาะรายการที่ยังค้าง ถ้าไม่มีค้างค่อยใช้ manifest เต็ม
  const pool_ = (req.storage_failed?.length ? req.storage_failed : req.storage_manifest) ?? [];

  // ★ ตรวจซ้ำก่อนยิงลบทุกครั้ง — แม้ manifest จะมาจาก collector ที่เชื่อถือได้
  //   ถ้ามีใครแก้ JSONB ในฐานข้อมูล entry นั้นจะถูกปฏิเสธที่นี่ ไม่ถึง deleteObject
  const safe: StorageManifestEntry[] = [];
  let rejected = 0;
  for (const entry of pool_) {
    if (isValidManifestEntry(entry, allowed) && isSafeObjectKey(entry.key)) safe.push(entry);
    else rejected++;
  }

  const stillFailed: StorageManifestEntry[] = [];
  let deleted = 0;
  for (const entry of safe) {
    try {
      await remove(entry.bucket, entry.key); // 404 = สำเร็จ (idempotent)
      deleted++;
    } catch {
      stillFailed.push(entry);
    }
  }

  const total = req.storage_manifest?.length ?? 0;
  const totalDeleted = Math.min(total, (req.storage_deleted_count ?? 0) + deleted);
  const status = nextStorageStatus(total, totalDeleted, stillFailed.length + rejected);
  const completed = status === "done";

  await query(
    `UPDATE account_deletion_requests
        SET storage_deleted_count = $2,
            storage_failed = $3::jsonb,
            storage_attempts = storage_attempts + 1,
            storage_status = $4,
            storage_completed_at = CASE WHEN $5 THEN now() ELSE storage_completed_at END,
            status = CASE WHEN $5 THEN 'completed' ELSE status END,
            completed_at = CASE WHEN $5 THEN now() ELSE completed_at END,
            updated_at = now()
      WHERE id = $1`,
    [requestId, totalDeleted, JSON.stringify(stillFailed), status, completed],
  );

  return { requestId, attempted: safe.length, deleted, failed: stillFailed.length, rejected, status, completed };
}

// ══════════════════════════════════════════════════════════════════════
//  Precheck
// ══════════════════════════════════════════════════════════════════════
//
// ตรวจเฉพาะสิ่งที่ยืนยันจากสคีมาปัจจุบันได้จริง — ไม่ใส่เพราะเอกสารเก่าเคยเอ่ยถึง

export async function runAccountDeletionPrecheck(userId: string): Promise<AccountDeletionPrecheck> {
  const blockers: AccountDeletionPrecheck["blockers"] = [];
  const warnings: PrecheckFinding<PrecheckWarnCode>[] = [];

  const live = await query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [userId]);
  if (live.rows[0]?.n !== 1) {
    blockers.push({ code: "no_live_user" });
    return {
      canRequest: false, blockers, warnings,
      policyPending: pendingPolicyFindings(), storageObjectCount: 0,
    };
  }

  const active = await findActiveDeletionRequest(userId);
  if (active) {
    blockers.push({
      code: active.status === "db_deleted" ? "deletion_already_completed" : "deletion_already_in_progress",
    });
  }

  // subscription ที่ยังใช้งานได้ (0032:10-12)
  const sub = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users
      WHERE id = $1 AND subscription_plan <> 'free'
        AND (subscription_expires_at IS NULL OR subscription_expires_at > now())`,
    [userId],
  );
  if ((sub.rows[0]?.n ?? 0) > 0) warnings.push({ code: "active_subscription" });

  // ออเดอร์ที่ลูกค้ายังรออยู่ (0055:29 — นับทุกสถานะที่ไม่ใช่ปิด/ยกเลิก
  // เพื่อให้ปลอดภัยเมื่อมีสถานะใหม่เพิ่มในอนาคต)
  const orders = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pos_orders
      WHERE user_id = $1 AND status NOT IN ('completed', 'cancelled')`,
    [userId],
  );
  if ((orders.rows[0]?.n ?? 0) > 0) warnings.push({ code: "open_orders", count: orders.rows[0].n });

  // งวดเงินเดือนที่ยังไม่ปิด (0080:24-25)
  const payroll = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payroll_periods
      WHERE user_id = $1 AND status IN ('draft', 'review', 'approved')`,
    [userId],
  );
  if ((payroll.rows[0]?.n ?? 0) > 0) warnings.push({ code: "open_payroll_period", count: payroll.rows[0].n });

  // เช็คเงินสดที่ยังเปิดค้าง (0091:211-212)
  const cash = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM daily_cash_checks WHERE user_id = $1 AND status = 'open'`,
    [userId],
  );
  if ((cash.rows[0]?.n ?? 0) > 0) warnings.push({ code: "open_cash_check", count: cash.rows[0].n });

  // ข้อมูลบุคคลที่สามที่จะหายไปด้วย — ลูกค้า · ไรเดอร์ · พนักงาน
  const third = await query<{ n: number }>(
    `SELECT (SELECT count(*) FROM pos_members WHERE user_id = $1)
          + (SELECT count(*) FROM pos_riders  WHERE user_id = $1)
          + (SELECT count(*) FROM employees   WHERE user_id = $1) AS n`,
    [userId],
  );
  const thirdCount = Number(third.rows[0]?.n ?? 0);
  if (thirdCount > 0) warnings.push({ code: "third_party_records", count: thirdCount });

  // นับไฟล์ด้วย collector ตัวเดียวกับที่ใช้ลบจริง (ไม่มีตรรกะซ้ำสองชุด)
  const client = await pool.connect();
  let storageObjectCount = 0;
  try {
    const manifest = await collectStorageManifest(client, userId);
    storageObjectCount = manifest.entries.length;
  } finally {
    client.release();
  }

  return {
    canRequest: blockers.length === 0,
    blockers,
    warnings,
    policyPending: pendingPolicyFindings(),
    storageObjectCount,
  };
}
