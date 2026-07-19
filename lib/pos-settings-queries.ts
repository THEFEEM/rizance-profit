import { pool } from "@/lib/db";

export type PosShopSettings = {
  defaultPaymentMethod: "cash" | "promptpay";
  promptpayId: string | null;
  receiptHeader: string | null;
  allowNegativeStock: boolean;
};

type SettingsRow = {
  default_payment_method: "cash" | "promptpay";
  promptpay_id: string | null;
  receipt_header: string | null;
  allow_negative_stock: boolean;
};

const SETTINGS_RETURN = `default_payment_method, promptpay_id, receipt_header, allow_negative_stock`;

const DEFAULT_SETTINGS: PosShopSettings = {
  defaultPaymentMethod: "cash",
  promptpayId: null,
  receiptHeader: null,
  allowNegativeStock: true,
};

function mapSettings(r: SettingsRow): PosShopSettings {
  return {
    defaultPaymentMethod: r.default_payment_method,
    promptpayId: r.promptpay_id,
    receiptHeader: r.receipt_header,
    allowNegativeStock: r.allow_negative_stock,
  };
}

export async function getPosShopSettings(userId: string): Promise<PosShopSettings> {
  const { rows } = await pool.query<SettingsRow>(
    `SELECT ${SETTINGS_RETURN} FROM pos_shop_settings WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ? mapSettings(rows[0]) : DEFAULT_SETTINGS;
}

export type UpdatePosShopSettingsInput = {
  promptpayId?: string | null;
  receiptHeader?: string | null;
  defaultPaymentMethod?: "cash" | "promptpay";
};

export async function upsertPosShopSettings(
  userId: string,
  input: UpdatePosShopSettingsInput,
): Promise<PosShopSettings> {
  const { rows } = await pool.query<SettingsRow>(
    `INSERT INTO pos_shop_settings (user_id, promptpay_id, receipt_header, default_payment_method)
     VALUES (
       $1,
       $2,
       $3,
       COALESCE($4, 'cash')
     )
     ON CONFLICT (user_id) DO UPDATE SET
       promptpay_id           = CASE WHEN $5 THEN $2 ELSE pos_shop_settings.promptpay_id END,
       receipt_header         = CASE WHEN $6 THEN $3 ELSE pos_shop_settings.receipt_header END,
       default_payment_method = COALESCE($4, pos_shop_settings.default_payment_method),
       updated_at             = now()
     RETURNING ${SETTINGS_RETURN}`,
    [
      userId,
      input.promptpayId ?? null,
      input.receiptHeader ?? null,
      input.defaultPaymentMethod ?? null,
      input.promptpayId !== undefined,
      input.receiptHeader !== undefined,
    ],
  );
  if (!rows[0]) throw new Error("Could not upsert POS shop settings");
  return mapSettings(rows[0]);
}
