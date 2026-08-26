import { NextRequest, NextResponse } from "next/server";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PartnerDuplicateNameError,
  createPartner,
  listPartners,
  updatePartner,
} from "@/lib/pos-partner-queries";
import { logManager } from "@/lib/manager-pin-queries";
import { z } from "zod";

/**
 * GET   /api/pos/partners        รายชื่อหุ้นส่วน (?active=1 = เฉพาะที่เปิดใช้)
 * POST  /api/pos/partners        เพิ่มหุ้นส่วนใหม่
 * PATCH /api/pos/partners        แก้ชื่อ/ชื่อเล่น/โน้ต/เปิด-ปิด
 *
 * ═══ ใครทำอะไรได้ ═════════════════════════════════════════════
 * GET   → แค่มีเซสชันร้าน (หน้าเก็บเงินต้องเห็นรายชื่อเพื่อเลือก)
 * POST  · PATCH → ต้องอยู่ในโหมดผู้จัดการ (0087)
 *   เพราะเพิ่มหุ้นส่วน = เพิ่มคนที่ได้ส่วนลดถาวร แคชเชียร์ทำเองไม่ได้
 *
 * ไม่มี DELETE โดยตั้งใจ — ปิดใช้งานแทน เพื่อไม่ให้ประวัติขาดตอน
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const activeOnly = new URL(req.url).searchParams.get("active") === "1";
  return NextResponse.json({ data: { partners: await listPartners(userId, activeOnly) } });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nickname: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(255).nullish(),
});

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const partner = await createPartner(userId, parsed.data);
    await logManager(userId, "partner_created", { partnerId: partner.id });
    return NextResponse.json({ data: { partner } }, { status: 201 });
  } catch (err) {
    if (err instanceof PartnerDuplicateNameError) {
      return NextResponse.json({ error: "partner_duplicate_name" }, { status: 409 });
    }
    throw err;
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  nickname: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(255).nullish(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { id, ...input } = parsed.data;
  try {
    const partner = await updatePartner(userId, id, input);
    if (!partner) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await logManager(userId, "partner_updated", { partnerId: id });
    return NextResponse.json({ data: { partner } });
  } catch (err) {
    if (err instanceof PartnerDuplicateNameError) {
      return NextResponse.json({ error: "partner_duplicate_name" }, { status: 409 });
    }
    throw err;
  }
}
