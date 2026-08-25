import { NextRequest, NextResponse } from "next/server";
import { requirePosSessionAndPlan } from "@/lib/pos-auth";
import { listPartners, updatePartner } from "@/lib/pos-partner-queries";
import { z } from "zod";

/**
 * GET   /api/pos/partners            รายชื่อหุ้นส่วน
 * PATCH /api/pos/partners            แก้ชื่อ/เล่นชื่อ/เปิด-ปิด
 *
 * ไม่มี POST/DELETE โดยตั้งใจ — MVP กำหนดไว้ 4 คน (seed ใน 0086)
 * เจ้าของแก้ชื่อได้ ปิดใช้งานได้ แต่ไม่ต้องมี CRUD เต็มให้ดูแลเพิ่ม
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const activeOnly = new URL(req.url).searchParams.get("active") === "1";
  return NextResponse.json({ data: { partners: await listPartners(userId, activeOnly) } });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  nickname: z.string().trim().max(60).nullish(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { id, ...input } = parsed.data;
  const partner = await updatePartner(userId, id, input);
  if (!partner) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: { partner } });
}
