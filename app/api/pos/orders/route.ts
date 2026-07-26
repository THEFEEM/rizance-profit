import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { posErrorResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosBillNotFoundForTicketError,
  PosOrderProductError,
  createKitchenTicketFromBill,
  createStaffOrder,
  listPosOrders,
} from "@/lib/pos-order-queries";
import {
  PosInvalidModifierError,
  PosModifierRuleError,
} from "@/lib/pos-modifier-queries";
import { staffOrderSchema } from "@/lib/pos-validation";

/** GET /api/pos/orders?active=1 — staff order queue. */
export async function GET(req: NextRequest) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const activeOnly = req.nextUrl.searchParams.get("active") === "1";
  const orders = await listPosOrders(userId, { activeOnly });
  return NextResponse.json({ data: { orders } });
}

const createTicketSchema = z.object({ billId: z.string().uuid() });

/**
 * POST /api/pos/orders — สองแบบ:
 *   { billId }        → ตั๋วครัวจากบิลที่จ่ายแล้ว (idempotent ต่อบิล)
 *   { items, note? }  → ออเดอร์หน้าร้านที่ยังไม่จ่าย (เก็บเงินตอนลูกค้ามารับ)
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

  const ticket = createTicketSchema.safeParse(body);
  if (ticket.success) {
    try {
      const order = await createKitchenTicketFromBill(userId, ticket.data.billId);
      return NextResponse.json({ data: order }, { status: 201 });
    } catch (err) {
      if (err instanceof PosBillNotFoundForTicketError) {
        return posErrorResponse("bill_not_found", 404);
      }
      throw err;
    }
  }

  const staff = staffOrderSchema.safeParse(body);
  if (!staff.success) return posErrorResponse("invalid_input", 400);

  try {
    const order = await createStaffOrder(userId, staff.data);
    return NextResponse.json({ data: order }, { status: 201 });
  } catch (err) {
    if (err instanceof PosOrderProductError) {
      return posErrorResponse("invalid_product", 400);
    }
    if (err instanceof PosInvalidModifierError) {
      return posErrorResponse("invalid_modifier", 400);
    }
    if (err instanceof PosModifierRuleError) {
      return posErrorResponse("modifier_required", 400);
    }
    throw err;
  }
}
