import { z } from "zod";
import { SHOP_MEMBER_ROLES } from "@/types/shop";
import { PAYMENT_METHODS } from "@/types/booth";
import { isValidDate } from "@/lib/date";

const moneyPositive = z
  .number()
  .finite()
  .gt(0, "Amount must be greater than 0")
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

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

const entryDate = z
  .string()
  .refine(isValidDate, "Date must be a valid YYYY-MM-DD")
  .optional();

const note = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().max(255).optional(),
);

export const capitalTxSchema = z.object({
  memberId: z.string().uuid("Invalid member id"),
  amount: moneyPositive,
  direction: z.enum(["contribution", "withdrawal"]),
  note,
  entryDate,
});

export type CapitalTxInput = z.infer<typeof capitalTxSchema>;

export const profitWithdrawalSchema = z.object({
  memberId: z.string().uuid("Invalid member id"),
  amount: moneyPositive,
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  note,
  entryDate,
});

export type ProfitWithdrawalInput = z.infer<typeof profitWithdrawalSchema>;
