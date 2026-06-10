import { z } from "zod";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/types";
import { isValidDate } from "@/lib/date";

const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("Enter a valid email").max(255),
);

export const registerSchema = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  shopName: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Shop name is required").max(120),
  ),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(200),
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

export const incomeSchema = z.object({
  amount,
  category: z.enum(INCOME_CATEGORIES).optional(),
  note,
  entryDate,
});

export const expenseSchema = z.object({
  amount,
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  note,
  entryDate,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type IncomeInput = z.infer<typeof incomeSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;

/** Build a { field: [messages] } map from a ZodError (version-safe). */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}
