import { z } from "zod";
import { SHOP_MEMBER_ROLES } from "@/types/shop";

const moneyNonNegative = z
  .number()
  .finite()
  .gte(0)
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

export const shopMemberSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณาระบุชื่อ").max(120),
  ),
  role: z.enum(SHOP_MEMBER_ROLES),
  investmentAmount: moneyNonNegative,
});

export const shopMemberPatchSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณาระบุชื่อ").max(120).optional(),
  ),
  role: z.enum(SHOP_MEMBER_ROLES).optional(),
  investmentAmount: moneyNonNegative.optional(),
});

export type ShopMemberInput = z.infer<typeof shopMemberSchema>;
export type ShopMemberPatchInput = z.infer<typeof shopMemberPatchSchema>;
