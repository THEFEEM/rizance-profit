import { z } from "zod";
import { isValidDate } from "@/lib/date";
import {
  BOOTH_COST_TYPES,
  MEMBER_ROLES,
  PAYMENT_METHODS,
  PROFIT_SPLIT_METHODS,
  WAGE_TYPES,
} from "@/types/booth";

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

const uuid = z.string().uuid();

export const boothIncomeSchema = z.object({
  amount: amountPositive,
  paymentMethod: z.enum(PAYMENT_METHODS),
  note,
  entryDate: boothDate.optional(),
});

const externalPayerName = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().max(120).optional(),
);

export const boothExpenseSchema = z
  .object({
    amount: amountPositive,
    costType: z.enum(BOOTH_COST_TYPES),
    label: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
      z.string().max(120).optional(),
    ),
    note,
    entryDate: boothDate.optional(),
    payerMemberId: uuid.optional(),
    externalPayerName,
    advancePayment: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    const hasMember = d.payerMemberId !== undefined;
    const hasExternal = !!d.externalPayerName && d.externalPayerName.length > 0;
    if (hasMember && hasExternal) {
      ctx.addIssue({
        code: "custom",
        message: "ระบุผู้จ่ายแทนได้อย่างใดอย่างหนึ่ง — สมาชิกหรือบุคคลภายนอก",
        path: ["externalPayerName"],
      });
    }
    if (d.advancePayment && !hasMember && !hasExternal) {
      ctx.addIssue({
        code: "custom",
        message: "กรุณาระบุผู้จ่ายแทน (สมาชิกหรือบุคคลภายนอก)",
        path: ["payerMemberId"],
      });
    }
  });

export const boothSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่องาน").max(120),
    ),
    poolBudget: moneyNonNegative,
    poolGetsShare: z.boolean().optional(),
    profitSplitMethod: z.enum(PROFIT_SPLIT_METHODS).optional(),
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

function wagePairRefine(
  d: { wageAmount?: number; wageType?: string },
  ctx: z.RefinementCtx,
  pathPrefix: string,
) {
  const hasWage = d.wageAmount !== undefined && d.wageAmount > 0;
  const hasType = d.wageType !== undefined;
  if (hasWage && !hasType) {
    ctx.addIssue({ code: "custom", message: "กรุณาระบุประเภทค่าแรง", path: [`${pathPrefix}wageType`] });
  }
  if (hasType && !hasWage) {
    ctx.addIssue({ code: "custom", message: "กรุณาระบุค่าแรง", path: [`${pathPrefix}wageAmount`] });
  }
}

export const boothMemberSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่อ").max(120),
    ),
    role: z.enum(MEMBER_ROLES),
    investmentAmount: moneyNonNegative.optional(),
    wageAmount: moneyNonNegative.optional(),
    wageType: z.enum(WAGE_TYPES).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.role === "investor") {
      if (d.wageAmount !== undefined || d.wageType !== undefined) {
        ctx.addIssue({ code: "custom", message: "นักลงทุนไม่มีค่าแรง", path: ["wageAmount"] });
      }
    } else if (d.role === "employee") {
      if (d.investmentAmount !== undefined && d.investmentAmount > 0) {
        ctx.addIssue({ code: "custom", message: "พนักงานไม่มีเงินลงทุน", path: ["investmentAmount"] });
      }
      if (!d.wageAmount || d.wageAmount <= 0 || !d.wageType) {
        ctx.addIssue({ code: "custom", message: "กรุณาระบุค่าแรงและประเภท", path: ["wageAmount"] });
      }
    } else if (d.role === "manager") {
      wagePairRefine(d, ctx, "");
    }
  });

/** PATCH bodies — no .partial() on refined schemas (Zod restriction). */
export const boothPatchSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณาระบุชื่องาน").max(120).optional(),
  ),
  poolBudget: moneyNonNegative.optional(),
  poolGetsShare: z.boolean().optional(),
  profitSplitMethod: z.enum(PROFIT_SPLIT_METHODS).optional(),
  startDate: boothDate.optional(),
  endDate: boothDate.optional(),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z.string().max(255).optional(),
  ),
});

export const boothMemberPatchSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่อ").max(120).optional(),
    ),
    role: z.enum(MEMBER_ROLES).optional(),
    investmentAmount: moneyNonNegative.optional(),
    wageAmount: moneyNonNegative.optional(),
    wageType: z.enum(WAGE_TYPES).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.role === "manager" || (d.wageAmount !== undefined || d.wageType !== undefined)) {
      wagePairRefine(d, ctx, "");
    }
  });

export type BoothSchemaInput = z.infer<typeof boothSchema>;
export type BoothMemberSchemaInput = z.infer<typeof boothMemberSchema>;
export type BoothPatchSchemaInput = z.infer<typeof boothPatchSchema>;
export type BoothMemberPatchSchemaInput = z.infer<typeof boothMemberPatchSchema>;
