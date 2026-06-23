import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { capitalTxSchema } from "@/lib/shop-validation";
import {
  CapitalWithdrawalLimitError,
  createCapitalTx,
  listCapitalTxByMember,
  withdrawalLimitMessage,
} from "@/lib/shop-capital-queries";
import { getShopMember } from "@/lib/shop-member-queries";

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = capitalTxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  try {
    const result = await createCapitalTx(userId, parsed.data);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof CapitalWithdrawalLimitError) {
      return NextResponse.json(
        { error: { message: withdrawalLimitMessage(err.maxAmount) } },
        { status: 400 },
      );
    }
    if (err instanceof Error && err.message === "Member not found") {
      return NextResponse.json({ error: { message: "ไม่พบสมาชิก" } }, { status: 404 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: { message: "memberId is required" } }, { status: 400 });
  }

  const member = await getShopMember(userId, memberId);
  if (!member) {
    return NextResponse.json({ error: { message: "ไม่พบสมาชิก" } }, { status: 404 });
  }

  const data = await listCapitalTxByMember(userId, memberId);
  return NextResponse.json({ data });
}
