import { NextRequest, NextResponse } from "next/server";
import { posErrorResponse, posNotFoundResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import {
  PosBillNotFoundError,
  PosBillNotVoidableError,
  PosVoidWindowExpiredError,
  voidPosBill,
} from "@/lib/pos-bill-queries";
import { voidPosBillSchema } from "@/lib/pos-validation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return posErrorResponse("invalid_json", 400);
  }

  const parsed = voidPosBillSchema.safeParse(body);
  if (!parsed.success) {
    return posErrorResponse("invalid_input", 400);
  }

  try {
    const result = await voidPosBill(userId, id, parsed.data.reason);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof PosBillNotFoundError) {
      return posNotFoundResponse();
    }
    if (err instanceof PosBillNotVoidableError) {
      return posErrorResponse("bill_not_voidable", 409);
    }
    if (err instanceof PosVoidWindowExpiredError) {
      return posErrorResponse("void_window_expired", 409);
    }
    throw err;
  }
}
