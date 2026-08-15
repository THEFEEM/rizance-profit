import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { createPosCampaign, listPosCampaigns } from "@/lib/pos-campaign-queries";
import { displayStatus } from "@/lib/pos-campaign-engine";

/** Ninenon Campaigns — CRUD (staff เท่านั้น · public ไม่มีทางเห็น endpoint นี้) */

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

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const includeArchived = req.nextUrl.searchParams.get("archived") === "1";
  const campaigns = await listPosCampaigns(userId, { includeArchived });
  return NextResponse.json({
    data: {
      campaigns: campaigns.map((c) => ({ ...c, displayStatus: displayStatus(c) })),
    },
  });
}

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", data: { issues: parsed.error.issues.slice(0, 3) } },
      { status: 400 },
    );
  }

  try {
    const campaign = await createPosCampaign(userId, parsed.data);
    return NextResponse.json({ data: { campaign } }, { status: 201 });
  } catch (err) {
    // 23505 บน idx_pos_campaigns_user_code = โค้ดคูปองซ้ำ
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "code_taken" }, { status: 409 });
    }
    throw err;
  }
}
