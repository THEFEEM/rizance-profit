import { pool } from "@/lib/db";

export type PosShopSettings = {
  defaultPaymentMethod: "cash" | "promptpay";
  promptpayId: string | null;
  receiptHeader: string | null;
  allowNegativeStock: boolean;
  publicMenuToken: string | null;
  onlineOrderingEnabled: boolean;
  /** เปิดจอครัว — ปิดบิล walk-in แล้วสร้างตั๋วครัวอัตโนมัติ */
  kitchenEnabled: boolean;
  /** NULL = ยังไม่เปิดร้านจริง (ยังล้างข้อมูลเทสได้) */
  liveAt: string | null;
  /** เดลิเวอรี่ */
  deliveryEnabled: boolean;
  deliveryFee: string;
  deliveryMinOrder: string;
  deliveryAreaNote: string | null;
  /** เบอร์โทรร้าน — โชว์ปุ่ม "โทรหาร้าน" บนหน้าสถานะออเดอร์ลูกค้า */
  shopPhone: string | null;
  /** จังหวะเก็บเงินเริ่มต้นของออเดอร์หน้าร้าน (before = เก็บก่อนทำ) */
  defaultPaymentTiming: "before" | "after";
  /** ชั่วโมงตัดวันขาย (0 = ตัดเที่ยงคืน) — บิลที่ปิดก่อนเวลานี้นับเป็นยอดวันก่อน */
  dayCutoffHour: number;
  /** รูป Thai QR ของร้าน (static — ฝังยอดไม่ได้) null = ไม่โชว์แท็บ "QR ร้าน" */
  shopQrUrl: string | null;
  /** ข้อความใต้ QR เช่น ชื่อบัญชี/รหัสร้านค้า */
  shopQrNote: string | null;
  /** ระบบสมาชิก/สะสมแต้ม (0068) — แต้มไม่ใช่เงิน ไม่กระทบบัญชี */
  pointsEnabled: boolean;
  /** ใช้เงินกี่บาทได้ 1 แต้ม (10 = ซื้อ 100 ได้ 10 แต้ม) */
  bahtPerPoint: number;
  /** ข้อความรางวัลที่โชว์บนบัตรสมาชิก เช่น "100 แต้ม = เฟรนฟรายฟรี" */
  rewardNote: string | null;
  /** ธีมสีบัตรสมาชิก (preset — ลูกค้าเปลี่ยนทับได้ที่เครื่องตัวเอง) */
  cardTheme: string;
  /** แต้มที่ต้องมีก่อนบัตรจะขึ้นปุ่มแลกรางวัล (สร้าง QR) */
  redeemPoints: number;
  /** % ของยอดสุทธิที่คืนเป็นมูลค่าให้ลูกค้า (0071) */
  loyaltyReturnPct: number;
  /** 1 แต้ม = กี่สตางค์ (10 = 10 แต้มได้ ฿1) */
  pointValueSatang: number;
  /** true = คิดแต้มจาก % · false = ใช้ baht_per_point แบบเดิม (สวิตช์ถอยกลับ) */
  loyaltyUsePct: boolean;
  /** มูลค่ารางวัลเป็นบาท (0072) — ใช้ตรวจว่าตั้ง redeem_points คืนเกินเป้าไหม */
  rewardValue: string | null;
  /** เปิดรับ feedback จาก QR หน้าร้าน (0073) */
  feedbackEnabled: boolean;
  /** แต้มโบนัสต่อ 1 feedback (0 = ไม่ให้แต้ม แต่ยังรับ feedback) */
  feedbackPoints: number;
};

type SettingsRow = {
  default_payment_method: "cash" | "promptpay";
  promptpay_id: string | null;
  receipt_header: string | null;
  allow_negative_stock: boolean;
  public_menu_token: string | null;
  online_ordering_enabled: boolean;
  kitchen_enabled: boolean;
  live_at: Date | string | null;
  delivery_enabled: boolean;
  delivery_fee: string;
  delivery_min_order: string;
  delivery_area_note: string | null;
  shop_phone: string | null;
  default_payment_timing: string;
  shop_qr_url: string | null;
  shop_qr_note: string | null;
  day_cutoff_hour: number;
  points_enabled: boolean;
  baht_per_point: number;
  reward_note: string | null;
  card_theme: string;
  redeem_points: number;
  loyalty_return_pct: string;
  point_value_satang: number;
  loyalty_use_pct: boolean;
  reward_value: string | null;
  feedback_enabled: boolean;
  feedback_points: number;
};

const SETTINGS_RETURN = `default_payment_method, promptpay_id, receipt_header,
  allow_negative_stock, public_menu_token, online_ordering_enabled, kitchen_enabled, live_at,
  delivery_enabled, delivery_fee::text AS delivery_fee,
  delivery_min_order::text AS delivery_min_order, delivery_area_note, shop_phone, default_payment_timing,
  shop_qr_url, shop_qr_note, day_cutoff_hour, points_enabled, baht_per_point, reward_note,
  card_theme, redeem_points,
  loyalty_return_pct::text AS loyalty_return_pct, point_value_satang, loyalty_use_pct,
  reward_value::text AS reward_value,
  feedback_enabled, feedback_points`;

function mapSettings(r: SettingsRow): PosShopSettings {
  return {
    defaultPaymentMethod: r.default_payment_method,
    promptpayId: r.promptpay_id,
    receiptHeader: r.receipt_header,
    allowNegativeStock: r.allow_negative_stock,
    publicMenuToken: r.public_menu_token,
    onlineOrderingEnabled: r.online_ordering_enabled,
    kitchenEnabled: r.kitchen_enabled,
    liveAt:
      r.live_at == null
        ? null
        : r.live_at instanceof Date
          ? r.live_at.toISOString()
          : String(r.live_at),
    deliveryEnabled: r.delivery_enabled,
    deliveryFee: r.delivery_fee ?? "0.00",
    deliveryMinOrder: r.delivery_min_order ?? "0.00",
    deliveryAreaNote: r.delivery_area_note,
    shopPhone: r.shop_phone,
    defaultPaymentTiming: r.default_payment_timing === "before" ? "before" : "after",
    shopQrUrl: r.shop_qr_url,
    shopQrNote: r.shop_qr_note,
    dayCutoffHour: Number(r.day_cutoff_hour ?? 0),
    pointsEnabled: r.points_enabled ?? false,
    bahtPerPoint: Number(r.baht_per_point ?? 10),
    rewardNote: r.reward_note ?? null,
    cardTheme: r.card_theme ?? "ink",
    redeemPoints: Number(r.redeem_points ?? 100),
    loyaltyReturnPct: Number(r.loyalty_return_pct ?? 8),
    pointValueSatang: Number(r.point_value_satang ?? 10),
    loyaltyUsePct: r.loyalty_use_pct ?? false,
    rewardValue: r.reward_value ?? null,
    feedbackEnabled: r.feedback_enabled ?? true,
    feedbackPoints: Number(r.feedback_points ?? 20),
  };
}

/** Ensures a settings row exists (token generated by column default). */
export async function getPosShopSettings(userId: string): Promise<PosShopSettings> {
  const { rows } = await pool.query<SettingsRow>(
    `INSERT INTO pos_shop_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = pos_shop_settings.updated_at
     RETURNING ${SETTINGS_RETURN}`,
    [userId],
  );
  return mapSettings(rows[0]);
}

export type UpdatePosShopSettingsInput = {
  promptpayId?: string | null;
  receiptHeader?: string | null;
  defaultPaymentMethod?: "cash" | "promptpay";
  onlineOrderingEnabled?: boolean;
  kitchenEnabled?: boolean;
  /** ทางเดียว: ตั้ง live_at ได้ครั้งแรกครั้งเดียว ปลดล็อกไม่ได้ผ่าน API */
  goLive?: boolean;
  deliveryEnabled?: boolean;
  deliveryFee?: number;
  deliveryMinOrder?: number;
  deliveryAreaNote?: string | null;
  shopPhone?: string | null;
  defaultPaymentTiming?: "before" | "after";
  shopQrUrl?: string | null;
  shopQrNote?: string | null;
  dayCutoffHour?: number;
  pointsEnabled?: boolean;
  bahtPerPoint?: number;
  rewardNote?: string | null;
  cardTheme?: string;
  redeemPoints?: number;
  loyaltyReturnPct?: number;
  pointValueSatang?: number;
  loyaltyUsePct?: boolean;
  rewardValue?: number | null;
  feedbackEnabled?: boolean;
  feedbackPoints?: number;
};

export async function upsertPosShopSettings(
  userId: string,
  input: UpdatePosShopSettingsInput,
): Promise<PosShopSettings> {
  const { rows } = await pool.query<SettingsRow>(
    `INSERT INTO pos_shop_settings
       (user_id, promptpay_id, receipt_header, default_payment_method,
        online_ordering_enabled, kitchen_enabled, live_at,
        delivery_enabled, delivery_fee, delivery_min_order, delivery_area_note, shop_phone,
        default_payment_timing, shop_qr_url, shop_qr_note, day_cutoff_hour,
        points_enabled, baht_per_point, reward_note, card_theme, redeem_points,
        loyalty_return_pct, point_value_satang, loyalty_use_pct, reward_value,
        feedback_enabled, feedback_points)
     VALUES (
       $1,
       $2,
       $3,
       COALESCE($4, 'cash'),
       COALESCE($7, false),
       COALESCE($8, false),
       CASE WHEN $9 THEN now() ELSE NULL END,
       COALESCE($10, false),
       COALESCE($11::numeric, 0),
       COALESCE($12::numeric, 0),
       $13,
       $15,
       COALESCE($17, 'after'),
       $18,
       $20,
       COALESCE($22, 0),
       COALESCE($23, false),
       COALESCE($24, 10),
       $25,
       COALESCE($27, 'ink'),
       COALESCE($28, 100),
       COALESCE($29::numeric, 8.00),
       COALESCE($30, 10),
       COALESCE($31, false),
       $32,
       COALESCE($34, true),
       COALESCE($35, 20)
     )
     ON CONFLICT (user_id) DO UPDATE SET
       promptpay_id            = CASE WHEN $5 THEN $2 ELSE pos_shop_settings.promptpay_id END,
       receipt_header          = CASE WHEN $6 THEN $3 ELSE pos_shop_settings.receipt_header END,
       default_payment_method  = COALESCE($4, pos_shop_settings.default_payment_method),
       online_ordering_enabled = COALESCE($7, pos_shop_settings.online_ordering_enabled),
       kitchen_enabled         = COALESCE($8, pos_shop_settings.kitchen_enabled),
       -- one-way: เซ็ตได้เฉพาะตอนยัง NULL เท่านั้น
       live_at                 = COALESCE(pos_shop_settings.live_at,
                                          CASE WHEN $9 THEN now() ELSE NULL END),
       delivery_enabled        = COALESCE($10, pos_shop_settings.delivery_enabled),
       delivery_fee            = COALESCE($11::numeric, pos_shop_settings.delivery_fee),
       delivery_min_order      = COALESCE($12::numeric, pos_shop_settings.delivery_min_order),
       delivery_area_note      = CASE WHEN $14 THEN $13 ELSE pos_shop_settings.delivery_area_note END,
       shop_phone              = CASE WHEN $16 THEN $15 ELSE pos_shop_settings.shop_phone END,
       default_payment_timing  = COALESCE($17, pos_shop_settings.default_payment_timing),
       shop_qr_url             = CASE WHEN $19 THEN $18 ELSE pos_shop_settings.shop_qr_url END,
       shop_qr_note            = CASE WHEN $21 THEN $20 ELSE pos_shop_settings.shop_qr_note END,
       day_cutoff_hour         = COALESCE($22, pos_shop_settings.day_cutoff_hour),
       points_enabled          = COALESCE($23, pos_shop_settings.points_enabled),
       baht_per_point          = COALESCE($24, pos_shop_settings.baht_per_point),
       reward_note             = CASE WHEN $26 THEN $25 ELSE pos_shop_settings.reward_note END,
       card_theme              = COALESCE($27, pos_shop_settings.card_theme),
       redeem_points           = COALESCE($28, pos_shop_settings.redeem_points),
       loyalty_return_pct      = COALESCE($29::numeric, pos_shop_settings.loyalty_return_pct),
       point_value_satang      = COALESCE($30, pos_shop_settings.point_value_satang),
       loyalty_use_pct         = COALESCE($31, pos_shop_settings.loyalty_use_pct),
       reward_value            = CASE WHEN $33 THEN $32::numeric ELSE pos_shop_settings.reward_value END,
       feedback_enabled        = COALESCE($34, pos_shop_settings.feedback_enabled),
       feedback_points         = COALESCE($35, pos_shop_settings.feedback_points),
       updated_at              = now()
     RETURNING ${SETTINGS_RETURN}`,
    [
      userId,
      input.promptpayId ?? null,
      input.receiptHeader ?? null,
      input.defaultPaymentMethod ?? null,
      input.promptpayId !== undefined,
      input.receiptHeader !== undefined,
      input.onlineOrderingEnabled ?? null,
      input.kitchenEnabled ?? null,
      input.goLive === true,
      input.deliveryEnabled ?? null,
      input.deliveryFee != null ? input.deliveryFee.toFixed(2) : null,
      input.deliveryMinOrder != null ? input.deliveryMinOrder.toFixed(2) : null,
      input.deliveryAreaNote ?? null,
      input.deliveryAreaNote !== undefined,
      input.shopPhone ?? null,
      input.shopPhone !== undefined,
      input.defaultPaymentTiming ?? null,
      input.shopQrUrl ?? null,
      input.shopQrUrl !== undefined,
      input.shopQrNote ?? null,
      input.shopQrNote !== undefined,
      input.dayCutoffHour ?? null,
      input.pointsEnabled ?? null,
      input.bahtPerPoint ?? null,
      input.rewardNote ?? null,
      input.rewardNote !== undefined,
      input.cardTheme ?? null,
      input.redeemPoints ?? null,
      input.loyaltyReturnPct != null ? input.loyaltyReturnPct.toFixed(2) : null,
      input.pointValueSatang ?? null,
      input.loyaltyUsePct ?? null,
      input.rewardValue != null ? input.rewardValue.toFixed(2) : null,
      input.rewardValue !== undefined,
      input.feedbackEnabled ?? null,
      input.feedbackPoints ?? null,
    ],
  );
  if (!rows[0]) throw new Error("Could not upsert POS shop settings");
  return mapSettings(rows[0]);
}

/**
 * ชั่วโมงตัดวันขายของร้าน (0 = ตัดเที่ยงคืนตามปกติ)
 * แยกเป็น query เบาๆ เพราะทุก path ที่สร้างบิล/ออเดอร์ต้องใช้ และต้องใช้ได้ทั้งใน
 * transaction ที่กำลังเปิดอยู่ (ส่ง client เข้ามา) และแบบเดี่ยว
 */
export async function getDayCutoffHour(
  userId: string,
  client?: { query: typeof pool.query },
): Promise<number> {
  const q = client ?? pool;
  const { rows } = await q.query<{ day_cutoff_hour: number }>(
    `SELECT day_cutoff_hour FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  const h = Number(rows[0]?.day_cutoff_hour ?? 0);
  return Number.isFinite(h) && h > 0 && h <= 11 ? h : 0;
}
