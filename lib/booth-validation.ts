import { z } from "zod";
import { isValidDate } from "@/lib/date";
import { BOOTH_COST_TYPES, PAYMENT_METHODS } from "@/types/booth";

const moneyNonNegative = z
  .number()
  .finite()
  .gte(0)
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

const amountPositive = moneyNonNegative.refine((n) => n > 0, "จำนวนเงินต้องมากกว่า 0");

const boothDate = z.string().refine(isValidDate, "วันที่ต้องเป็น YYYY-MM-DD");

const note = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().max(255).optional(),
);

export const boothIncomeSchema = z.object({
  amount: amountPositive,
  paymentMethod: z.enum(PAYMENT_METHODS),
  note,
  entryDate: boothDate.optional(),
});

export const boothExpenseSchema = z.object({
  amount: amountPositive,
  costType: z.enum(BOOTH_COST_TYPES),
  label: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z.string().max(120).optional(),
  ),
  note,
  entryDate: boothDate.optional(),
});

export const boothSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่องาน").max(120),
    ),
    startingBudget: moneyNonNegative,
    startDate: boothDate,
    endDate: boothDate,
    note: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
      z.string().max(255).optional(),
    ),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
    path: ["endDate"],
  });

export type BoothSchemaInput = z.infer<typeof boothSchema>;
