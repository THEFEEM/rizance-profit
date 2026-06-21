import { z } from "zod";
import { isValidDate } from "@/lib/date";
import {
  PERSONAL_EXPENSE_KEYS,
  PERSONAL_INCOME_KEYS,
  PERSONAL_SAVINGS_DEPOSIT,
  PERSONAL_SAVINGS_WITHDRAWAL,
} from "@/lib/personal-categories";

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

const savingsGoalId = z.string().uuid("Invalid savings goal id").optional();

export const personalIncomeSchema = z
  .object({
    amount,
    category: z.enum(PERSONAL_INCOME_KEYS),
    note,
    entryDate,
    savingsGoalId,
  })
  .superRefine((data, ctx) => {
    if (data.category === PERSONAL_SAVINGS_WITHDRAWAL) {
      if (!data.savingsGoalId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "กรุณาเลือกเป้าหมายออม",
          path: ["savingsGoalId"],
        });
      }
    } else if (data.savingsGoalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "เป้าหมายออมใช้ได้เฉพาะถอนเงินออม",
        path: ["savingsGoalId"],
      });
    }
  });

export const personalExpenseSchema = z
  .object({
    amount,
    category: z.enum(PERSONAL_EXPENSE_KEYS),
    note,
    entryDate,
    savingsGoalId,
  })
  .superRefine((data, ctx) => {
    if (data.category === PERSONAL_SAVINGS_DEPOSIT) {
      if (!data.savingsGoalId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "กรุณาเลือกเป้าหมายออม",
          path: ["savingsGoalId"],
        });
      }
    } else if (data.savingsGoalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "เป้าหมายออมใช้ได้เฉพาะออมเงิน",
        path: ["savingsGoalId"],
      });
    }
  });

export type PersonalIncomeInput = z.infer<typeof personalIncomeSchema>;
export type PersonalExpenseInput = z.infer<typeof personalExpenseSchema>;

const goalName = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1, "กรุณาระบุชื่อ").max(160),
);

export const savingsGoalSchema = z.object({
  name: goalName,
  targetAmount: amount,
});

export const savingsGoalPatchSchema = z
  .object({
    name: goalName.optional(),
    targetAmount: amount.optional(),
  })
  .refine((d) => d.name !== undefined || d.targetAmount !== undefined, {
    message: "กรุณาระบุข้อมูลที่ต้องการแก้ไข",
  });

export type SavingsGoalInput = z.infer<typeof savingsGoalSchema>;
export type SavingsGoalPatchInput = z.infer<typeof savingsGoalPatchSchema>;
