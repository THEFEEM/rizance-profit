import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { ShopIsLiveError, wipePosTestData } from "@/lib/pos-admin-queries";

/** ต้องพิมพ์วลีนี้เป๊ะๆ จาก UI — กันยิงพลาด/สคริปต์เดา */
const CONFIRM_PHRASE = "ล้างข้อมูลเทส";

const bodySchema = z.object({
  confirm: z.literal(CONFIRM_PHRASE),
});

/**
 * POST /api/pos/admin/wipe-test-data — pre-launch only.
 * Server-side guard: refuses when the shop is already live (live_at set).
 */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("confirm_mismatch", 400);

  try {
    const result = await wipePosTestData(userId);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof ShopIsLiveError) {
      return posErrorResponse("shop_is_live", 403);
    }
    throw err;
  }
}
