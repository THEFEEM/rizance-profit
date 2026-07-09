import { NextRequest, NextResponse } from "next/server";
import { posNotFoundResponse, requirePosSessionAndPlan } from "@/lib/pos-auth";
import { getPosBillDetail } from "@/lib/pos-bill-queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requirePosSessionAndPlan(req);
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const bill = await getPosBillDetail(userId, id);
  if (!bill) return posNotFoundResponse();

  return NextResponse.json({ data: bill });
}
