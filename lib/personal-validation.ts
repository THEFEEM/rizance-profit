import { z } from "zod";
import { isValidDate } from "@/lib/date";
import { PERSONAL_EXPENSE_KEYS, PERSONAL_INCOME_KEYS } from "@/lib/personal-categories";

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

export const personalIncomeSchema = z.object({
  amount,
  category: z.enum(PERSONAL_INCOME_KEYS),
  note,
  entryDate,
});

export const personalExpenseSchema = z.object({
  amount,
  category: z.enum(PERSONAL_EXPENSE_KEYS),
  note,
  entryDate,
});

export type PersonalIncomeInput = z.infer<typeof personalIncomeSchema>;
export type PersonalExpenseInput = z.infer<typeof personalExpenseSchema>;
