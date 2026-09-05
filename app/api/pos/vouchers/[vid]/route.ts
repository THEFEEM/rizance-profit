import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireManagerUnlock, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPublicPosAppUrl } from "@/lib/env";
import { voucherActionSchema } from "@/lib/pos-voucher-schema";
import {
  getVoucherDetail,
  reissueVoucherToken,
  setVoucherStatus,
} from "@/lib/pos-voucher-queries";
import { UUID_RE, notFound, readJson, voucherErrorResponse } from "@/lib/pos-voucher-route-helpers";

type Ctx = { params: Promise<{ vid: string }> };

/** GET /api/pos/vouchers/:vid — รายละเอียดใบ + redemption + events */
export async function GET(req: NextRequest, { params }: Ctx) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const { vid } = await params;
  if (!UUID_RE.test(vid)) return notFound();
  try {
    const voucher = await getVoucherDetail(userId, vid);
    return NextResponse.json({ data: { voucher } });
  } catch (err) {
    return voucherErrorResponse(err) ?? Promise.reject(err);
  }
}

const actionSchema = voucherActionSchema.extend({
  action: z.enum(["block", "unblock", "cancel", "reissue"]),
});

/**
 * PATCH /api/pos/vouchers/:vid  { action, reason? }
 * ทุก action แตะ "เงิน" → manager unlock · redeemed → active ไม่มีทางทำได้ที่นี่ (สเปก §16)
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;
  const locked = await requireManagerUnlock(req, userId);
  if (locked) return locked;

  const { vid } = await params;
  if (!UUID_RE.test(vid)) return notFound();
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    if (parsed.data.action === "reissue") {
      const link = await reissueVoucherToken(userId, vid, getPublicPosAppUrl());
      return NextResponse.json({ data: { link } });
    }
    const next = ({ block: "blocked", unblock: "active", cancel: "cancelled" } as const)[parsed.data.action];
    const voucher = await setVoucherStatus(userId, vid, next, parsed.data.reason ?? null);
    return NextResponse.json({ data: { voucher } });
  } catch (err) {
    return voucherErrorResponse(err) ?? Promise.reject(err);
  }
}
