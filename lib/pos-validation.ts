import { z } from "zod";

const cartLine = z.object({
  productId: z.string().uuid(),
  qty: z.number().positive(),
  modifierIds: z.array(z.string().uuid()).max(20).optional(),
  /** โน้ตต่อรายการ เช่น "ไม่ใส่ผัก" — ไม่มีผลต่อราคา */
  note: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
});

const paymentMethodEnum = z.enum(["cash", "promptpay", "thai_chuay_thai"]);

const billPayment = z.object({
  method: paymentMethodEnum,
  amount: z
    .number()
    .finite()
    .gt(0)
    .max(9_999_999_999.99)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
      message: "Amount can have at most 2 decimal places",
    }),
});

const surcharge = z.object({
  label: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1).max(80),
  ),
  amount: z
    .number()
    .finite()
    .gte(0)
    .max(9_999_999.99)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
      message: "Amount can have at most 2 decimal places",
    }),
});

export const closePosBillSchema = z
  .object({
    items: z.array(cartLine).min(1),
    surcharges: z.array(surcharge).max(3).optional(),
    paymentMethod: paymentMethodEnum.optional(),
    payments: z.array(billPayment).min(1).max(3).optional(),
    entryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** ผูกบิลเข้าออเดอร์ใน transaction เดียว (กันบิลกำพร้า) */
    linkOrderId: z.string().uuid().optional(),
  })
  .refine((d) => d.paymentMethod !== undefined || (d.payments?.length ?? 0) > 0, {
    message: "paymentMethod or payments is required",
  })
  .refine(
    (d) => {
      // A method may appear at most once per bill.
      const methods = (d.payments ?? []).map((p) => p.method);
      return new Set(methods).size === methods.length;
    },
    { message: "Duplicate payment method" },
  );

export type ClosePosBillBody = z.infer<typeof closePosBillSchema>;

export const voidPosBillSchema = z.object({
  reason: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1).max(200),
  ),
});

export type VoidPosBillBody = z.infer<typeof voidPosBillSchema>;

export const listPosBillsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const moneyNonNegative = z
  .number()
  .finite()
  .gte(0)
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

const stockQtyNonNegative = z
  .number()
  .finite()
  .gte(0)
  .max(9_999_999_999.999)
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, {
    message: "Stock quantity can have at most 3 decimal places",
  });

const productName = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(120),
);

const categoryName = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(80),
);

export const createPosProductSchema = z.object({
  name: productName,
  sellPrice: moneyNonNegative,
  costPrice: moneyNonNegative.default(0),
  trackStock: z.boolean().default(true),
  stockQty: stockQtyNonNegative.default(0),
  categoryId: z.string().uuid().optional(),
  unit: z.string().max(20).optional(),
  modifierGroupIds: z.array(z.string().uuid()).max(10).optional(),
});

export const updatePosProductSchema = z
  .object({
    name: productName.optional(),
    sellPrice: moneyNonNegative.optional(),
    costPrice: moneyNonNegative.optional(),
    trackStock: z.boolean().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    unit: z.string().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    modifierGroupIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

// --- Modifiers -------------------------------------------------------------

const modifierName = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(80),
);

const priceDelta = z
  .number()
  .finite()
  .gte(-9_999_999_999.99)
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Price delta can have at most 2 decimal places",
  });

export const createPosModifierGroupSchema = z
  .object({
    name: modifierName,
    minSelect: z.number().int().gte(0).default(0),
    maxSelect: z.number().int().gte(1).default(1),
    sortOrder: z.number().int().default(0),
  })
  .refine((d) => d.minSelect <= d.maxSelect, { message: "minSelect must be <= maxSelect" });

export const updatePosModifierGroupSchema = z
  .object({
    name: modifierName.optional(),
    minSelect: z.number().int().gte(0).optional(),
    maxSelect: z.number().int().gte(1).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const createPosModifierSchema = z.object({
  name: modifierName,
  priceDelta: priceDelta.default(0),
  sortOrder: z.number().int().default(0),
});

export const updatePosModifierSchema = z
  .object({
    name: modifierName.optional(),
    priceDelta: priceDelta.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const createPosCategorySchema = z.object({
  name: categoryName,
  color: z.string().max(20).optional(),
  sortOrder: z.number().int().default(0),
});

export const updatePosCategorySchema = z
  .object({
    name: categoryName.optional(),
    color: z.string().max(20).nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

// --- Ingredients / recipes ---------------------------------------------------

const PURCHASE_UNIT_ENUM = z.enum(["ml", "g", "kg", "l", "piece", "shot", "pump"]);

const positiveQty = z
  .number()
  .finite()
  .gt(0)
  .max(9_999_999)
  .refine((n) => Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-6, {
    message: "Quantity can have at most 4 decimal places",
  });

const ingredientName = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(120),
);

const ingredientCategory = z
  .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(40))
  .nullable()
  .optional();

const supplierName = z
  .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(120))
  .nullable()
  .optional();

export const createPosIngredientSchema = z.object({
  name: ingredientName,
  purchaseQuantity: positiveQty,
  purchaseUnit: PURCHASE_UNIT_ENUM,
  purchasePrice: moneyNonNegative,
  trackStock: z.boolean().default(true),
  lowStockThreshold: z.number().finite().gte(0).nullable().optional(),
  category: ingredientCategory,
  supplierName: supplierName,
});

/** ไปตลาด 1 รอบ — รับของหลายตัว + ของนอกลิสต์ ในครั้งเดียว */
export const marketTripSchema = z.object({
  lines: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        quantity: positiveQty,
        lineCost: moneyNonNegative.optional(),
      }),
    )
    .max(60),
  extraItems: z
    .array(
      z.object({
        label: z.preprocess(
          (v) => (typeof v === "string" ? v.trim() : v),
          z.string().min(1).max(80),
        ),
        amount: moneyNonNegative,
      }),
    )
    .max(20)
    .optional(),
  paymentMethod: z.enum(["cash", "transfer"]).optional(),
  note: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
});

export const updatePosIngredientSchema = z
  .object({
    name: ingredientName.optional(),
    purchaseQuantity: positiveQty.optional(),
    purchaseUnit: PURCHASE_UNIT_ENUM.optional(),
    purchasePrice: moneyNonNegative.optional(),
    trackStock: z.boolean().optional(),
    lowStockThreshold: z.number().finite().gte(0).nullable().optional(),
    category: ingredientCategory,
    supplierName: supplierName,
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

export const setRecipeSchema = z.object({
  lines: z.array(z.object({ ingredientId: z.string().uuid(), quantity: positiveQty })).max(30),
});

export const restockIngredientSchema = z.object({
  ingredientId: z.string().uuid(),
  quantity: positiveQty,
  totalCost: moneyNonNegative.optional(),
  paymentMethod: z.enum(["cash", "transfer"]).optional(),
  updatePurchasePrice: z.boolean().optional(),
  note: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
});

export const adjustIngredientSchema = z.object({
  ingredientId: z.string().uuid(),
  actualQty: z.number().finite().gte(0).max(9_999_999),
  note: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
});

// --- Public QR orders --------------------------------------------------------

export const publicOrderSchema = z.object({
  token: z.string().uuid(),
  customerName: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(80))
    .optional(),
  customerPhone: z
    .preprocess(
      (v) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v),
      z.string().regex(/^0\d{8,9}$/),
    )
    .optional(),
  note: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
  pickupAtText: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(40))
    .optional(),
  /** ลูกค้าเลือกโอนก่อน หรือจ่ายที่ร้าน (default at_shop) */
  paymentIntent: z.enum(["at_shop", "prepaid_transfer"]).optional(),
  /** pickup = มารับเอง · delivery = ให้ไปส่ง */
  orderType: z.enum(["pickup", "delivery"]).optional(),
  deliveryAddress: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(3).max(300))
    .optional(),
  /** พิกัดที่ลูกค้าแชร์ (ถ้ามี ไม่ต้องพิมพ์ที่อยู่) */
  deliveryLat: z.number().finite().gte(-90).lte(90).optional(),
  deliveryLng: z.number().finite().gte(-180).lte(180).optional(),
  deliveryAccuracyM: z.number().finite().gte(0).max(100_000).optional(),
  deliveryNote: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
  items: z.array(cartLine).min(1).max(20),
});

export type PublicOrderBody = z.infer<typeof publicOrderSchema>;

/** ออเดอร์หน้าร้าน (พนักงานจดให้) — ยังไม่จ่าย */
export const staffOrderSchema = z.object({
  /** ไม่ส่ง = ใช้ค่าเริ่มต้นจังหวะเก็บเงินของร้าน */
  paymentTiming: z.enum(["before", "after"]).optional(),
  items: z.array(cartLine).min(1).max(50),
  customerName: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(80))
    .optional(),
  note: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
});

/** ความเห็นลูกค้าหลังรับอาหาร (public — ยืนยันด้วย access_token ของออเดอร์) */
export const orderFeedbackSchema = z.object({
  rating: z.number().int().gte(1).lte(5),
  comment: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(500))
    .optional(),
});

export const updatePosOrderSchema = z.object({
  status: z.enum(["accepted", "cooking", "ready", "completed", "cancelled"]),
  cancelReason: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1).max(200))
    .optional(),
  billId: z.string().uuid().optional(),
  /** สลับจังหวะเก็บเงินรายออเดอร์ (before = เก็บก่อนทำ · after = เก็บตอนรับ) */
  paymentTiming: z.enum(["before", "after"]).optional(),
});

/** เปลี่ยนจังหวะเก็บเงินรายออเดอร์อย่างเดียว ไม่แตะสถานะ */
export const setPaymentTimingSchema = z.object({
  paymentTiming: z.enum(["before", "after"]),
});

/** ทะเบียนคนส่ง (ลิงก์ /r/<token> แยกรายคน) */
const riderName = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(80),
);
const riderPhone = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().max(20),
);

export const riderCreateSchema = z.object({
  name: riderName,
  phone: riderPhone.nullish().transform((v) => (v ? String(v) : null)),
});

export const riderUpdateSchema = z.object({
  name: riderName.optional(),
  phone: riderPhone.nullish().transform((v) => (v ? String(v) : null)).optional(),
  isActive: z.boolean().optional(),
  /** ออกลิงก์ใหม่ — ลิงก์เดิมใช้ไม่ได้ทันที (ทำมือถือหาย/ลาออก) */
  rotateToken: z.boolean().optional(),
  /** ร้านยืนยันว่ารับเงินสดจากคนส่งครบแล้ว */
  settleCash: z.boolean().optional(),
});

export type CreatePosProductInput = z.infer<typeof createPosProductSchema>;
export type UpdatePosProductInput = z.infer<typeof updatePosProductSchema>;
export type CreatePosCategoryInput = z.infer<typeof createPosCategorySchema>;
export type UpdatePosCategoryInput = z.infer<typeof updatePosCategorySchema>;
