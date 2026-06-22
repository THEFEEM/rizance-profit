import { z } from "zod";
import {
  EXPENSE_CATEGORY_KEYS,
  INCOME_CATEGORY_KEYS,
  LEGACY_EXPENSE_FORM_KEYS,
  LEGACY_INCOME_FORM_KEYS,
  PAYMENT_METHODS,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
} from "@/lib/expense-categories";
import { isValidDate } from "@/lib/date";

const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("Enter a valid email").max(255),
);

export const registerModeSchema = z.enum(["personal", "regular", "booth", "org"]);

export const registerSchema = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  shopName: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Shop name is required").max(120),
  ),
  mode: registerModeSchema.default("personal"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(200),
});

export const userPatchSchema = z
  .object({
    shopName: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่อ").max(120).optional(),
    ),
    monthlyBudget: z
      .union([
        z
          .number()
          .finite()
          .gt(0, "งบประมาณต้องมากกว่า 0")
          .max(9_999_999_999.99, "จำนวนมากเกินไป"),
        z.null(),
      ])
      .optional(),
  })
  .refine((d) => d.shopName !== undefined || d.monthlyBudget !== undefined, {
    message: "กรุณาระบุข้อมูลที่ต้องการแก้ไข",
  });

// Amount: a positive money value with at most 2 decimals. Sent as a number,
// re-validated server-side as > 0 so empty/zero entries are blocked.
const amount = z
  .number()
  .finite("Amount must be a number")
  .gt(0, "Amount must be greater than 0")
  .max(9_999_999_999.99, "Amount is too large")
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

const note = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().max(255).optional(),
);

const entryDate = z
  .string()
  .refine(isValidDate, "Date must be a valid YYYY-MM-DD")
  .optional();

/** Accept canonical + legacy form keys; normalize to DB keys on parse. */
const incomeCategory = z
  .union([z.enum(INCOME_CATEGORY_KEYS), z.enum(LEGACY_INCOME_FORM_KEYS)])
  .optional()
  .transform((v) => normalizeIncomeCategory(v));

const expenseCategory = z
  .union([z.enum(EXPENSE_CATEGORY_KEYS), z.enum(LEGACY_EXPENSE_FORM_KEYS)])
  .optional()
  .transform((v) => normalizeExpenseCategory(v));

const paymentMethod = z.enum(PAYMENT_METHODS).optional();

export const incomeSchema = z.object({
  amount,
  category: incomeCategory,
  paymentMethod,
  note,
  entryDate,
});

export const expenseSchema = z
  .object({
    amount,
    category: expenseCategory,
    paymentMethod,
    note,
    entryDate,
    isAdvance: z.boolean().optional(),
    payerName: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
      z.string().max(120).optional(),
    ),
  })
  .refine((d) => !d.isAdvance || d.payerName, {
    message: "กรุณาระบุชื่อผู้จ่ายล่วงหน้า",
    path: ["payerName"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type IncomeInput = z.infer<typeof incomeSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;

const transferDirection = z.enum(["cash_to_transfer", "transfer_to_cash"]);

export const transferSchema = z.object({
  amount,
  direction: transferDirection,
  note,
  entryDate,
});

export type TransferInput = z.infer<typeof transferSchema>;

/** Build a { field: [messages] } map from a ZodError (version-safe). */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}
