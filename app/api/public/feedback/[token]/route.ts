import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";
import { getShopByMenuToken, getOrderByAccessToken } from "@/lib/pos-order-queries";
import { listPosCatalog } from "@/lib/pos-queries";
import { pool } from "@/lib/db";
import {
  FEEDBACK_KINDS,
  PosFeedbackDisabledError,
  createPublicFeedback,
} from "@/lib/pos-feedback-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * NINENON Feedback Center — public (ไม่มี session)
 *
 * token = public_menu_token ของร้าน (ตัวเดียวกับ QR เมนู)
 * → QR หน้าร้าน 1 ใบใช้ได้ทั้งสั่งอาหารและส่ง feedback ไม่ต้องพิมพ์ QR เพิ่ม
 *
 * ⚠️ GET ต้องไม่คืนอะไรที่เป็นความลับของร้าน — ไม่มีต้นทุน ไม่มียอดขาย
 *    คืนแค่ชื่อร้าน / เปิดรับ feedback ไหม / แต้มโบนัสเท่าไร / ชื่อเมนู
 */

/** GET — config สำหรับ render ฟอร์ม (+ รายการเมนูของออเดอร์ ถ้าส่ง ?order= มา) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const shop = await getShopByMenuToken(token);
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { rows } = await pool.query<{ feedback_enabled: boolean; feedback_points: number }>(
    `SELECT feedback_enabled, feedback_points FROM pos_shop_settings WHERE user_id = $1`,
    [shop.userId],
  );
  const feedbackEnabled = rows[0]?.feedback_enabled ?? true;
  const feedbackPoints = Number(rows[0]?.feedback_points ?? 0);

  // เมนูของออเดอร์ (ให้คะแนนรายจาน) — ตรวจว่า order token เป็นของร้านเดียวกันจริง
  const orderItems: { productId: string | null; productName: string }[] = [];
  let orderNo: string | null = null;
  const orderToken = req.nextUrl.searchParams.get("order");
  if (orderToken && UUID_RE.test(orderToken)) {
    const order = await getOrderByAccessToken(orderToken);
    if (order && order.publicMenuToken === token) {
      orderNo = order.orderNo;
      // ยุบรายการซ้ำ: สั่งเบอร์เกอร์ 2 ชิ้นต้องให้คะแนนช่องเดียว
      const seen = new Set<string>();
      for (const it of order.items) {
        const key = it.productId ?? it.productName;
        if (seen.has(key)) continue;
        seen.add(key);
        orderItems.push({ productId: it.productId ?? null, productName: it.productName });
      }
    }
  }

  // ไม่มีออเดอร์ → ให้เลือกเมนูที่กินมาเองจากรายการขายจริง (สูงสุด 40 รายการ)
  let menuOptions: { productId: string; productName: string }[] = [];
  if (orderItems.length === 0) {
    const catalog = await listPosCatalog(shop.userId);
    menuOptions = catalog.products
      .filter((p) => p.isActive !== false)
      .slice(0, 40)
      .map((p) => ({ productId: p.id, productName: p.name }));
  }

  return NextResponse.json({
    data: {
      shopName: shop.shopName,
      feedbackEnabled,
      feedbackPoints,
      kinds: FEEDBACK_KINDS,
      orderNo,
      orderItems,
      menuOptions,
    },
  });
}

const ratingField = z.number().int().gte(1).lte(5).nullable().optional();

const submitSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  topic: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(30))
    .nullable()
    .optional(),
  ratings: z
    .object({
      overall: ratingField,
      taste: ratingField,
      portion: ratingField,
      value: ratingField,
      service: ratingField,
      clean: ratingField,
      speed: ratingField,
    })
    .default({}),
  comment: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(2000))
    .nullable()
    .optional(),
  phone: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(30))
    .nullable()
    .optional(),
  orderToken: z.string().uuid().nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid().nullable(),
        productName: z.string().min(1).max(160),
        rating: z.number().int().gte(1).lte(5),
        comment: z
          .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(300))
          .nullable()
          .optional(),
      }),
    )
    .max(30)
    .optional(),
});

/** POST — ส่ง feedback */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // rate limit ต่อ IP — QR สาธารณะต้องกันสแปมยิงรัว
  const retryIn = authRateLimitExceeded(`fbcenter:${clientIp(req)}`);
  if (retryIn !== null) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const shop = await getShopByMenuToken(token);
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const input = parsed.data;

  // ต้องมีคะแนนหรือข้อความอย่างน้อยหนึ่งอย่าง (ตรงกับ CHECK pos_feedback_not_empty)
  const hasRating = Object.values(input.ratings ?? {}).some(
    (v) => typeof v === "number" && v >= 1,
  );
  const hasItemRating = (input.items ?? []).length > 0;
  if (!hasRating && !hasItemRating && !input.comment) {
    return NextResponse.json({ error: "empty_feedback" }, { status: 400 });
  }

  // ผูกออเดอร์: ต้องเป็นออเดอร์ของร้านนี้เท่านั้น (กันเอา token ร้านอื่นมาแปะ)
  let orderId: string | null = null;
  let billId: string | null = null;
  if (input.orderToken) {
    const order = await getOrderByAccessToken(input.orderToken);
    if (order && order.publicMenuToken === token) {
      orderId = order.id;
      billId = order.billId ?? null;
    }
  }

  try {
    const result = await createPublicFeedback(shop.userId, {
      kind: input.kind,
      topic: input.topic ?? null,
      ratings: input.ratings ?? {},
      comment: input.comment ?? null,
      phone: input.phone ?? null,
      orderId,
      billId,
      items: input.items ?? [],
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof PosFeedbackDisabledError) {
      return NextResponse.json({ error: "feedback_disabled" }, { status: 403 });
    }

    /**
     * ⚠️ บทเรียนจากของจริง: ตอน migration 0073 ยังไม่ครบ (ขาดคอลัมน์ source)
     *    ลูกค้าเห็นแค่ "ส่งไม่สำเร็จ ลองอีกครั้ง" แล้วกดซ้ำไปเรื่อย ๆ
     *    เจ้าของร้านก็ไม่รู้ว่าต้องไปรัน migration — เสียเวลาหาสาเหตุนานกว่าที่ควร
     *
     *    error ต้องพูดความจริง: แยก "ระบบยังไม่พร้อม" ออกจาก "ข้อมูลที่ส่งมาไม่ถูก"
     *    และ log ลง server เสมอเพื่อดูใน Vercel Logs ได้ทันที
     */
    const e = err as { code?: string; message?: string; constraint?: string };
    console.error("[feedback] submit failed", {
      pgCode: e.code,
      constraint: e.constraint,
      message: e.message,
    });

    // 42703 undefined_column · 42P01 undefined_table → ฐานข้อมูลตามโค้ดไม่ทัน
    if (e.code === "42703" || e.code === "42P01") {
      return NextResponse.json({ error: "schema_outdated" }, { status: 503 });
    }
    // 23514 check_violation → ข้อมูลที่ส่งมาไม่เข้าเงื่อนไข (ไม่ใช่ความผิดของระบบ)
    if (e.code === "23514") {
      return NextResponse.json({ error: "invalid_feedback" }, { status: 400 });
    }
    throw err;
  }
}
