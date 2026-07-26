import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosBillNotFoundForTicketError,
  createKitchenTicketFromBill,
  listPosOrders,
} from "@/lib/pos-order-queries";

/** GET /api/pos/orders?active=1 — staff order queue. */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const activeOnly = req.nextUrl.searchParams.get("active") === "1";
  const orders = await listPosOrders(userId, { activeOnly });
  return NextResponse.json({ data: { orders } });
}

const createTicketSchema = z.object({ billId: z.string().uuid() });

/** POST /api/pos/orders — ตั๋วครัวจากบิลที่จ่ายแล้ว (idempotent ต่อบิล). */
export async function POST(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = createTicketSchema.safeParse(body);
  if (!parsed.success) return posErrorResponse("invalid_input", 400);

  try {
    const order = await createKitchenTicketFromBill(userId, parsed.data.billId);
    return NextResponse.json({ data: order }, { status: 201 });
  } catch (err) {
    if (err instanceof PosBillNotFoundForTicketError) {
      return posErrorResponse("bill_not_found", 404);
    }
    throw err;
  }
}
