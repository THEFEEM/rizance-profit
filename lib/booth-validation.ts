import { z } from "zod";
import { isValidDate } from "@/lib/date";
import {
  BOOTH_COST_TYPES,
  MEMBER_ROLES,
  PAYMENT_METHODS,
  PROFIT_SPLIT_METHODS,
  WAGE_TYPES,
  type MemberRole,
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

export const boothExpenseSchema = z.object({
  amount: amountPositive,
  costType: z.enum(BOOTH_COST_TYPES),
  label: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z.string().max(120).optional(),
  ),
  note,
  entryDate: boothDate.optional(),
  payerMemberId: uuid.optional(),
  advancePayment: z.boolean().optional(),
});

export const boothSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่องาน").max(120),
    ),
    poolBudget: moneyNonNegative,
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

export const boothMemberSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1, "กรุณาระบุชื่อ").max(120),
    ),
    role: z.enum(MEMBER_ROLES),
    investmentAmount: moneyNonNegative.optional(),
    splitPercent: moneyNonNegative.max(100).optional(),
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
      if (d.splitPercent !== undefined) {
        ctx.addIssue({ code: "custom", message: "พนักงานไม่มี % แบ่งกำไร", path: ["splitPercent"] });
      }
      if (!d.wageAmount || d.wageAmount <= 0 || !d.wageType) {
        ctx.addIssue({ code: "custom", message: "กรุณาระบุค่าแรงและประเภท", path: ["wageAmount"] });
      }
    } else if (d.role === "manager") {
      if (
        (d.investmentAmount !== undefined && d.investmentAmount > 0) ||
        d.splitPercent !== undefined ||
        d.wageAmount !== undefined ||
        d.wageType !== undefined
      ) {
        ctx.addIssue({ code: "custom", message: "ผู้จัดการไม่มีข้อมูลเงิน", path: ["role"] });
      }
    }
  });

export type BoothSchemaInput = z.infer<typeof boothSchema>;
export type BoothMemberSchemaInput = z.infer<typeof boothMemberSchema>;

/** App-layer check: custom_percent investors must sum to 100.00 */
export function validateInvestorSplitPercents(
  members: { role: MemberRole; splitPercent: string | null }[],
  method: string,
): string | null {
  if (method !== "custom_percent") return null;
  const investors = members.filter((m) => m.role === "investor");
  if (investors.length === 0) return "ไม่มีนักลงทุน";
  let sum = 0;
  for (const m of investors) {
    if (m.splitPercent === null) return "นักลงทุนทุกคนต้องมี % แบ่งกำไร";
    sum += Math.round(Number(m.splitPercent) * 100);
  }
  if (sum !== 10_000) return `สัดส่วน % ต้องรวม 100.00 (ได้ ${(sum / 100).toFixed(2)}%)`;
  return null;
}
