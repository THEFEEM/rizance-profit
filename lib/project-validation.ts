import { z } from "zod";
import { isValidDate } from "@/lib/date";
import {
  PROJECT_EXPENSE_KEYS,
  PROJECT_FUNDING_KEYS,
} from "@/lib/project-categories";
import { PROJECT_MEMBER_ROLES, PROJECT_STATUSES, PROJECT_TYPES, PAYMENT_STATUSES } from "@/types/project";

const moneyNonNegative = z
  .number()
  .finite()
  .gte(0)
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

const amountPositive = moneyNonNegative.refine((n) => n > 0, "จำนวนเงินต้องมากกว่า 0");

const projectDate = z
  .string()
  .refine(isValidDate, "วันที่ต้องเป็น YYYY-MM-DD")
  .optional();

const noteText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().max(2000).optional(),
);

const shortLabel = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().max(160).optional(),
);

const payerName = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().max(120).optional(),
);

export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    projectType: z.enum(PROJECT_TYPES),
    orgName: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
      z.string().max(160).optional(),
    ),
    projectCode: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
      z.string().max(40).optional(),
    ),
    objective: noteText,
    status: z.enum(PROJECT_STATUSES).optional(),
    budgetTarget: moneyNonNegative.optional(),
    startDate: projectDate,
    endDate: projectDate,
    note: noteText,
  })
  .superRefine((d, ctx) => {
    if (d.startDate && d.endDate && d.endDate < d.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
        path: ["endDate"],
      });
    }
  });

export const projectActivitySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    budgetTarget: moneyNonNegative.optional(),
    startDate: projectDate,
    endDate: projectDate,
    note: noteText,
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.startDate && d.endDate && d.endDate < d.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
        path: ["endDate"],
      });
    }
  });

export const projectIncomeSchema = z.object({
  amount: amountPositive,
  source: z.enum(PROJECT_FUNDING_KEYS),
  label: shortLabel,
  entryDate: z.string().refine(isValidDate, "วันที่ต้องเป็น YYYY-MM-DD"),
  note: noteText,
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
});

export const projectExpenseSchema = z.object({
  amount: amountPositive,
  category: z.enum(PROJECT_EXPENSE_KEYS),
  label: shortLabel,
  payerName,
  entryDate: z.string().refine(isValidDate, "วันที่ต้องเป็น YYYY-MM-DD"),
  note: noteText,
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
});

export const projectMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(PROJECT_MEMBER_ROLES).optional(),
  note: noteText,
});

export type ProjectInput = z.infer<typeof projectSchema>;
export type ProjectActivityInput = z.infer<typeof projectActivitySchema>;
export type ProjectIncomeInput = z.infer<typeof projectIncomeSchema>;
export type ProjectExpenseInput = z.infer<typeof projectExpenseSchema>;
export type ProjectMemberInput = z.infer<typeof projectMemberSchema>;

export const ACTIVITY_STATUSES = ["active", "closed"] as const;

export const projectPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    orgName: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : v === "" ? null : undefined),
      z.union([z.string().max(160), z.null()]).optional(),
    ),
    projectCode: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : v === "" ? null : undefined),
      z.union([z.string().max(40), z.null()]).optional(),
    ),
    objective: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : v === "" ? null : undefined),
      z.union([z.string().max(2000), z.null()]).optional(),
    ),
    status: z.enum(PROJECT_STATUSES).optional(),
    budgetTarget: moneyNonNegative.optional(),
    startDate: z.union([projectDate, z.null()]).optional(),
    endDate: z.union([projectDate, z.null()]).optional(),
    note: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : v === "" ? null : undefined),
      z.union([z.string().max(2000), z.null()]).optional(),
    ),
  })
  .superRefine((d, ctx) => {
    if (d.startDate && d.endDate && d.endDate < d.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
        path: ["endDate"],
      });
    }
  });

export const projectActivityPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    budgetTarget: moneyNonNegative.optional(),
    startDate: z.union([projectDate, z.null()]).optional(),
    endDate: z.union([projectDate, z.null()]).optional(),
    note: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : v === "" ? null : undefined),
      z.union([z.string().max(2000), z.null()]).optional(),
    ),
    status: z.enum(ACTIVITY_STATUSES).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.startDate && d.endDate && d.endDate < d.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
        path: ["endDate"],
      });
    }
  });

export type ProjectPatchInput = z.infer<typeof projectPatchSchema>;
export type ProjectActivityPatchInput = z.infer<typeof projectActivityPatchSchema>;
