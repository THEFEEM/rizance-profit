import { z } from "zod";

const cartLine = z.object({
  productId: z.string().uuid(),
  qty: z.number().positive(),
});

export const closePosBillSchema = z.object({
  items: z.array(cartLine).min(1),
  paymentMethod: z.enum(["cash", "promptpay"]),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

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
