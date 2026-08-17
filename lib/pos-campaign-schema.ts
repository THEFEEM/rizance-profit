import { z } from "zod";

/**
 * Zod schema ของ Ninenon Campaigns — แยกจาก route โดยจำเป็น ไม่ใช่ความสะอาด:
 * ⚠️ Next.js App Router ห้าม export ค่าอื่นนอกจาก HTTP method จาก route.ts
 *    (export const campaignSchema ใน route = `next build` ล้มทั้ง deploy
 *     และเพราะสคริปต์ deploy ใช้ ";" ไม่ใช่ "&&" — build ล้มแล้ว push ต่อเงียบ ๆ
 *     prod เลยค้างของเก่า — บทเรียนจริง 15 ส.ค. 69)
 */

const money = z.number().finite().min(0).max(999_999.99);

export const campaignBaseSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1).max(120),
    ),
    description: z
      .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(300))
      .nullable()
      .optional(),
    code: z
      .preprocess(
        (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
        z.string().min(2).max(40).regex(/^[A-Z0-9-]+$/, "ใช้ A-Z 0-9 และ - เท่านั้น"),
      )
      .nullable()
      .optional(),
    discountType: z.enum(["percentage", "fixed"]),
    discountValue: z.number().finite().gt(0),
    scope: z.enum(["entire_order", "products"]),
    productIds: z.array(z.string().uuid()).max(100).optional(),
    minimumOrderAmount: money.optional(),
    maximumDiscountAmount: money.nullable().optional(),
    usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
    usageLimitPerCustomer: z.number().int().min(1).max(1_000).nullable().optional(),
    startAt: z.string().datetime({ offset: true }).nullable().optional(),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    timeStartMin: z.number().int().min(0).max(1439).nullable().optional(),
    timeEndMin: z.number().int().min(1).max(1440).nullable().optional(),
    daysOfWeek: z
      .string()
      .regex(/^[0-6]{1,7}$/)
      .nullable()
      .optional(),
    eligibility: z.enum(["all", "members"]).optional(),
  });

export const campaignSchema = campaignBaseSchema
  .superRefine((v, ctx) => {
    if (v.discountType === "percentage" && v.discountValue > 100) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "percentage ≤ 100" });
    }
    if (v.scope === "products" && (v.productIds?.length ?? 0) === 0) {
      ctx.addIssue({ code: "custom", path: ["productIds"], message: "เลือกสินค้าอย่างน้อย 1" });
    }
    if (v.startAt && v.endAt && new Date(v.endAt) <= new Date(v.startAt)) {
      ctx.addIssue({ code: "custom", path: ["endAt"], message: "end ต้องหลัง start" });
    }
  });
