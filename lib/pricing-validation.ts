import { z } from "zod";
import { OVERHEAD_CATEGORIES, PURCHASE_UNITS } from "@/types/pricing";

const moneyPositive = z
  .number()
  .finite()
  .gte(0)
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

const moneyStrictPositive = moneyPositive.refine((n) => n > 0, "Must be greater than 0");

const quantityPositive = z
  .number()
  .finite()
  .gt(0)
  .max(9_999_999_999.9999)
  .refine((n) => Math.abs(n * 10_000 - Math.round(n * 10_000)) < 1e-4, {
    message: "At most 4 decimal places",
  });

export const ingredientSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณาระบุวัตถุดิบ").max(120),
  ),
  purchaseQuantity: quantityPositive,
  purchaseUnit: z.enum(PURCHASE_UNITS),
  purchasePrice: moneyPositive,
});

export const ingredientPatchSchema = ingredientSchema.partial();

export const menuItemSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณาระบุเมนู").max(120),
  ),
  desiredProfit: moneyPositive.nullable().optional(),
});

export const recipeLineSchema = z.object({
  ingredientId: z.string().uuid(),
  quantity: quantityPositive,
});

export const recipeSchema = z.object({
  items: z.array(recipeLineSchema).min(1, "เพิ่มวัตถุดิบอย่างน้อย 1 รายการ"),
});

export const overheadSchema = z.object({
  category: z.enum(OVERHEAD_CATEGORIES),
  label: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z.string().max(120).optional(),
  ),
  monthlyAmount: moneyPositive,
});

export const overheadPatchSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  monthlyAmount: moneyPositive.optional(),
});

export const pricingSettingsSchema = z.object({
  estimatedCupsPerMonth: z.number().int().min(0).max(9_999_999),
  defaultProfitPerCup: moneyPositive.nullable().optional(),
});
