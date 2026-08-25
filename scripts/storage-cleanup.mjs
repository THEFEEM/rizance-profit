/**
 * เคลียร์พื้นที่ Supabase Storage — ไฟล์กำพร้า + สลิป/รูปแชตเก่า
 *
 * ═══ ที่มา (24 ส.ค. 2569) ═══════════════════════════════════
 * egress ทะลุโควต้า + อยากลดพื้นที่ให้เหลือน้อยที่สุด
 * pos-menu : รูปสินค้า/คอมโบ — ลบตัวเก่าแบบ best-effort (void catch)
 *            → ถ้าเคยพลาด จะเหลือไฟล์กำพร้าค้างอยู่
 * pos-slips: สลิปโอนเงิน + รูปแชตออเดอร์ — โค้ดไม่เคยลบเลย สะสมถาวร
 *
 * ═══ วิธีใช้ ═══════════════════════════════════════════════════
 *   node scripts/storage-cleanup.mjs                  # รายงานเท่านั้น (ปลอดภัย)
 *   node scripts/storage-cleanup.mjs --delete-orphans # ลบไฟล์ที่ไม่มีใน DB
 *   node scripts/storage-cleanup.mjs --delete-orphans --slips-older-than=30
 *                                                     # + ลบสลิป/รูปแชตเก่ากว่า 30 วัน
 *
 * ⚠️ ลบไฟล์เท่านั้น ไม่แตะ DB — คอลัมน์ slip_url/image_url ที่ชี้ไฟล์ที่ลบแล้ว
 *    ให้เคลียร์ด้วย db/checks/purge-old-slip-urls.sql (รีวิวก่อนรันตามปกติ)
 * ⚠️ เกณฑ์กำพร้า = ไม่ถูกอ้างในตารางใดเลย + ไฟล์เก่ากว่า 1 ชั่วโมง
 *    (กันเคสอัปโหลดค้างอยู่ระหว่าง transaction)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

for (const file of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(root, file), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    // ไม่มีไฟล์ = ใช้ env ของ shell
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const MENU_BUCKET = process.env.SUPABASE_POS_MENU_BUCKET || "pos-menu";
const SLIP_BUCKET = process.env.SUPABASE_POS_SLIP_BUCKET || "pos-slips";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ต้องมี SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("ต้องมี DATABASE_URL (ใช้ตรวจว่าไฟล์ไหนยังถูกอ้างอยู่)");
  process.exit(1);
}

const args = process.argv.slice(2);
const DELETE_ORPHANS = args.includes("--delete-orphans");
const slipsArg = args.find((a) => a.startsWith("--slips-older-than="));
const SLIP_DAYS = slipsArg ? Number(slipsArg.split("=")[1]) : null;
/**
 * รูปในแชตออเดอร์ (prefix "chat/") — ของใหญ่สุดในบัคเก็ตนี้ (3-4 MB/รูป)
 * เป็นรูปคุยกันตอนส่งของ ไม่ใช่หลักฐานการเงิน → ลบเร็วกว่าสลิปได้
 */
const chatArg = args.find((a) => a.startsWith("--chat-older-than="));
const CHAT_DAYS = chatArg ? Number(chatArg.split("=")[1]) : null;

const fmt = (n) =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** list ทุกไฟล์ในบัคเก็ต (ไล่ทุกโฟลเดอร์ย่อย) */
async function listAll(bucket, prefix = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!res.ok) {
      throw new Error(`list ${bucket} ล้มเหลว: ${res.status} ${await res.text()}`);
    }
    const rows = await res.json();
    if (rows.length === 0) break;
    for (const r of rows) {
      // ไม่มี id = โฟลเดอร์ → ไล่ลงไปข้างใน
      if (r.id === null) {
        out.push(...(await listAll(bucket, `${prefix}${r.name}/`)));
      } else {
        out.push({
          path: `${prefix}${r.name}`,
          size: r.metadata?.size ?? 0,
          createdAt: r.created_at ?? r.updated_at ?? null,
        });
      }
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return out;
}

async function removeObjects(bucket, paths) {
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: chunk }),
    });
    if (!res.ok) {
      console.error(`  ลบไม่สำเร็จ (${res.status}): ${await res.text()}`);
      continue;
    }
    removed += chunk.length;
    process.stdout.write(`  ลบแล้ว ${removed}/${paths.length}\r`);
  }
  console.log("");
  return removed;
}

/**
 * pg v8+ ตีความ sslmode=require ใน URL เป็น verify-full → ตายด้วย
 * SELF_SIGNED_CERT_IN_CHAIN บน Supabase/Neon
 * วิธีเดียวกับ lib/pg-config.ts: ถอด sslmode ออกจาก URL แล้วตั้ง ssl เอง
 * (ไม่ใช้ pgClientOptions ของ scripts/ เพราะตัวนั้นมีด่านห้ามต่อ prod
 *  ซึ่งสคริปต์นี้ต้องต่อ prod จริง — แต่ "อ่านอย่างเดียว" ไม่มี UPDATE/DELETE ใน DB)
 */
function clientOptions(connectionString) {
  const needsSsl =
    /sslmode=require/i.test(connectionString) ||
    /\b(pooler\.supabase\.com|neon\.tech|supabase\.co|amazonaws\.com)\b/i.test(connectionString);
  if (!needsSsl) return { connectionString };
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  return {
    connectionString: url.toString().replace(/^postgres:/, "postgresql:"),
    ssl: { rejectUnauthorized: false },
  };
}

const client = new pg.Client(clientOptions(DATABASE_URL));
await client.connect();

/** ทุก URL ที่ DB ยังอ้างถึง (ถ้าไม่อยู่ในนี้ = กำพร้า) */
const { rows: refRows } = await client.query(`
  SELECT image_url AS url FROM pos_products     WHERE image_url IS NOT NULL
  UNION ALL SELECT image_url FROM pos_combos    WHERE image_url IS NOT NULL
  UNION ALL SELECT slip_url  FROM pos_orders    WHERE slip_url  IS NOT NULL
  UNION ALL SELECT image_url FROM pos_order_messages WHERE image_url IS NOT NULL
  UNION ALL SELECT shop_qr_url FROM pos_shop_settings WHERE shop_qr_url IS NOT NULL
`);
const referenced = new Set(
  refRows
    .map((r) => {
      const m = String(r.url).match(/\/object\/public\/[^/]+\/(.+)$/);
      return m ? decodeURIComponent(m[1]) : null;
    })
    .filter(Boolean),
);

console.log(`\nURL ที่ DB อ้างถึงอยู่: ${referenced.size} รายการ\n`);

const HOUR_AGO = Date.now() - 3600_000;
const cutoff = SLIP_DAYS ? Date.now() - SLIP_DAYS * 86400_000 : null;
let grandTotal = 0;
let grandFreed = 0;

for (const bucket of [MENU_BUCKET, SLIP_BUCKET]) {
  let files;
  try {
    files = await listAll(bucket);
  } catch (err) {
    console.log(`── ${bucket}: อ่านไม่ได้ (${err.message})\n`);
    continue;
  }

  const total = files.reduce((s, f) => s + f.size, 0);
  grandTotal += total;

  const orphans = files.filter(
    (f) => !referenced.has(f.path) && (!f.createdAt || Date.parse(f.createdAt) < HOUR_AGO),
  );
  const chatCutoff = CHAT_DAYS ? Date.now() - CHAT_DAYS * 86400_000 : null;
  const oldSlips =
    bucket === SLIP_BUCKET
      ? files.filter((f) => {
          if (!referenced.has(f.path) || !f.createdAt) return false;
          const at = Date.parse(f.createdAt);
          const isChat = f.path.startsWith("chat/");
          if (isChat && chatCutoff !== null) return at < chatCutoff;
          if (!isChat && cutoff !== null) return at < cutoff;
          return false;
        })
      : [];

  const orphanSize = orphans.reduce((s, f) => s + f.size, 0);
  const oldSize = oldSlips.reduce((s, f) => s + f.size, 0);

  console.log(`── ${bucket}`);
  console.log(`   ไฟล์ทั้งหมด   ${files.length} ไฟล์ · ${fmt(total)}`);
  console.log(`   กำพร้า        ${orphans.length} ไฟล์ · ${fmt(orphanSize)}`);
  if (bucket === SLIP_BUCKET) {
    const chatFiles = files.filter((f) => f.path.startsWith("chat/"));
    const chatSize = chatFiles.reduce((s, f) => s + f.size, 0);
    console.log(`   ในนั้นเป็นรูปแชต ${chatFiles.length} ไฟล์ · ${fmt(chatSize)}`);
    if (cutoff !== null || chatCutoff !== null) {
      console.log(`   เข้าเกณฑ์ลบ  ${oldSlips.length} ไฟล์ · ${fmt(oldSize)}`);
    }
  }
  const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
  if (biggest.length > 0) {
    console.log("   ไฟล์ใหญ่สุด:");
    for (const f of biggest) console.log(`     ${fmt(f.size).padStart(8)}  ${f.path}`);
  }

  const toDelete = [...(DELETE_ORPHANS ? orphans : []), ...oldSlips];
  if (toDelete.length > 0) {
    console.log(`   → กำลังลบ ${toDelete.length} ไฟล์ (${fmt(orphanSize + oldSize)})`);
    const n = await removeObjects(bucket, toDelete.map((f) => f.path));
    grandFreed += toDelete.slice(0, n).reduce((s, f) => s + f.size, 0);
  }
  console.log("");
}

await client.end();

console.log(`พื้นที่ที่ใช้อยู่ก่อนลบ: ${fmt(grandTotal)}`);
if (grandFreed > 0) {
  console.log(`คืนพื้นที่ได้:          ${fmt(grandFreed)}`);
  console.log(`เหลือประมาณ:            ${fmt(grandTotal - grandFreed)}`);
  if (SLIP_DAYS) {
    console.log(
      `\n⚠️ อย่าลืมเคลียร์ URL ที่ชี้ไฟล์ที่ลบแล้วใน DB:\n` +
        `   db/checks/purge-old-slip-urls.sql (รีวิวก่อนรัน)`,
    );
  }
} else {
  console.log("\n(โหมดรายงานเท่านั้น — ใส่ --delete-orphans เพื่อลบจริง)");
}
