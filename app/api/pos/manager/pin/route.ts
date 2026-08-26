import { NextRequest, NextResponse } from "next/server";
import {
  posErrorResponse,
  requireManagerUnlock,
  requirePosSessionAndPlan,
} from "@/lib/pos-auth";
import {
  PinAlreadySetError,
  PinFormatError,
  PinWrongCurrentError,
  changePin,
  logManager,
  pinStatus,
  setupPin,
} from "@/lib/manager-pin-queries";
import {
  clearManagerCookieOptions,
  managerCookieOptions,
  signManagerUnlock,
  MANAGER_COOKIE,
} from "@/lib/manager-unlock";
import { requestHostname } from "@/lib/jwt";
import { z } from "zod";

/**
 * รหัสผู้จัดการ — ตั้งครั้งแรก / ดูสถานะ / เปลี่ยนรหัส
 *
 * GET   → สถานะ (ยังไม่ตั้ง / ล็อกอยู่ / พร้อมใช้) — ไม่คืน hash เด็ดขาด
 * POST  → ตั้งครั้งแรก · ทำได้เฉพาะตอนยังไม่มีรหัส
 * PATCH → เปลี่ยนรหัส · ต้องรู้รหัสเดิม + ต้องอยู่ในโหมดผู้จัดการอยู่แล้ว
 *
 * ทุก endpoint ต้องผ่าน requirePosSessionAndPlan ก่อน
 * → ไม่มีทางที่ client นิรนามจะตั้งรหัสของร้านคนอื่นได้
 */

export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const status = await pinStatus(userId);

  // บอกได้แค่ว่า "ปลดล็อกอยู่ไหม" — ไม่บอกเวอร์ชันหรืออะไรที่ช่วยเดา
  const { verifyManagerUnlock } = await import("@/lib/manager-unlock");
  const unlock = await verifyManagerUnlock(req.cookies.get(MANAGER_COOKIE)?.value);
  const unlocked =
    status.state === "ready" &&
    unlock !== null &&
    unlock.userId === userId &&
    unlock.version === status.version;

  return NextResponse.json({
    data: {
      state: status.state,
      retryAfterSeconds: status.state === "locked" ? status.retryAfterSeconds : undefined,
      unlocked,
      expiresAt: unlocked ? unlock!.expiresAt : null,
    },
  });
}

const setupSchema = z
  .object({
    pin: z.string().regex(/^\d{6}$/),
    confirmPin: z.string().regex(/^\d{6}$/),
  })
  .refine((d) => d.pin === d.confirmPin, { message: "pin_mismatch" });

export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((i) => i.message === "pin_mismatch");
    return posErrorResponse(mismatch ? "pin_mismatch" : "invalid_pin_format", 400);
  }

  try {
    const version = await setupPin(userId, parsed.data.pin);
    await logManager(userId, "manager_pin_created");

    // ตั้งเสร็จเข้าโหมดผู้จัดการเลย ไม่ต้องพิมพ์ซ้ำ
    const res = NextResponse.json({ data: { ok: true } }, { status: 201 });
    res.cookies.set(
      MANAGER_COOKIE,
      await signManagerUnlock(userId, version),
      managerCookieOptions(requestHostname(req)),
    );
    return res;
  } catch (err) {
    // มีรหัสอยู่แล้ว → ต้องไปทางเปลี่ยนรหัสเท่านั้น ห้ามทับ
    if (err instanceof PinAlreadySetError) return posErrorResponse("pin_already_set", 409);
    if (err instanceof PinFormatError) return posErrorResponse("weak_pin", 400);
    throw err;
  }
}

const changeSchema = z
  .object({
    currentPin: z.string().regex(/^\d{6}$/),
    newPin: z.string().regex(/^\d{6}$/),
    confirmPin: z.string().regex(/^\d{6}$/),
  })
  .refine((d) => d.newPin === d.confirmPin, { message: "pin_mismatch" });

export async function PATCH(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  // ต้องปลดล็อกอยู่แล้วถึงจะเปลี่ยนได้ — กันคนหยิบเครื่องที่เปิดค้างไปตั้งรหัสใหม่
  const gate = await requireManagerUnlock(req, userId);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((i) => i.message === "pin_mismatch");
    return posErrorResponse(mismatch ? "pin_mismatch" : "invalid_pin_format", 400);
  }

  try {
    const version = await changePin(userId, parsed.data.currentPin, parsed.data.newPin);
    await logManager(userId, "manager_pin_changed");

    // เวอร์ชันเปลี่ยน → คุกกี้เก่าทุกใบตายทันที ออกใบใหม่ให้เครื่องนี้เครื่องเดียว
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.set(
      MANAGER_COOKIE,
      await signManagerUnlock(userId, version),
      managerCookieOptions(requestHostname(req)),
    );
    return res;
  } catch (err) {
    if (err instanceof PinWrongCurrentError) {
      await logManager(userId, "manager_pin_failed", { at: "change" });
      return posErrorResponse("wrong_current_pin", 403);
    }
    if (err instanceof PinFormatError) return posErrorResponse("weak_pin", 400);
    throw err;
  }
}

/** ล็อกทันที — ใช้ตอนส่งเครื่องคืนให้พนักงาน */
export async function DELETE(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  await logManager(userId, "manager_locked");
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(MANAGER_COOKIE, "", clearManagerCookieOptions(requestHostname(req)));
  return res;
}
