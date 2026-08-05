import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosInvalidPhoneError,
  findPosMemberByPhone,
  listPosMembers,
  upsertPosMember,
} from "@/lib/pos-member-queries";
import { z } from "zod";

const createSchema = z.object({
  phone: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(9).max(20)),
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(80).nullable().optional(),
  ),
});

/**
 * GET /api/pos/members            → อันดับลูกค้าประจำ (ฝั่งร้าน)
 * GET /api/pos/members?phone=08x  → ค้นสมาชิกจากเบอร์ (ตอนเก็บเงิน)
 */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const phone = req.nextUrl.searchParams.get("phone");
  if (phone) {
    const member = await findPosMemberByPhone(userId, phone);
    return NextResponse.json({ data: { member } });
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const members = await listPosMembers(userId, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ data: { members } });
}

/** POST /api/pos/members — สมัคร/หาสมาชิกจากเบอร์ (idempotent) */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const member = await upsertPosMember(userId, parsed.data);
    return NextResponse.json({ data: { member } }, { status: 201 });
  } catch (err) {
    if (err instanceof PosInvalidPhoneError) return posErrorResponse("invalid_phone", 400);
    throw err;
  }
}
