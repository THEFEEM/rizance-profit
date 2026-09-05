import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  brandingPatchSchema,
  getMerchantBranding,
  updateMerchantColors,
} from "@/lib/pos-branding-queries";

/** GET /api/pos/branding — โปรไฟล์แบรนด์ร้าน (ชื่อ · โลโก้ · สี) */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  return NextResponse.json({ data: { branding: await getMerchantBranding(userId) } });
}

/** PATCH /api/pos/branding  { primaryColor?, secondaryColor? } — null = ล้าง */
export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = brandingPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  return NextResponse.json({ data: { branding: await updateMerchantColors(userId, parsed.data) } });
}
