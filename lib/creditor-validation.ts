import { z } from "zod";
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

const entryDate = z
  .string()
  .refine(isValidDate, "Date must be a valid YYYY-MM-DD")
  .optional();

const note = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().max(255).optional(),
);

export const creditorRepaymentSchema = z.object({
  payerKind: z.enum(["member", "external"]),
  payerName: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณาระบุชื่อเจ้าหนี้").max(160),
  ),
  amount: moneyPositive,
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  note,
  entryDate,
});

export type CreditorRepaymentInput = z.infer<typeof creditorRepaymentSchema>;
