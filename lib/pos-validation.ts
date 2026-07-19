import { z } from "zod";

const cartLine = z.object({
  productId: z.string().uuid(),
  qty: z.number().positive(),
  modifierIds: z.array(z.string().uuid()).max(20).optional(),
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

export const closePosBillSchema = z
  .object({
    items: z.array(cartLine).min(1),
    paymentMethod: paymentMethodEnum.optional(),
    payments: z.array(billPayment).min(1).max(3).optional(),
    entryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
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

export type CreatePosProductInput = z.infer<typeof createPosProductSchema>;
export type UpdatePosProductInput = z.infer<typeof updatePosProductSchema>;
export type CreatePosCategoryInput = z.infer<typeof createPosCategorySchema>;
export type UpdatePosCategoryInput = z.infer<typeof updatePosCategorySchema>;
