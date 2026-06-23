import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { profitWithdrawalSchema } from "@/lib/shop-validation";
import { getMemberProfitWithdrawable } from "@/lib/shop-profit-withdrawable";
import {
  ProfitWithdrawalLimitError,
  ShopOnHandInsufficientError,
  createProfitWithdrawal,
  listProfitWithdrawalsByMember,
  profitWithdrawalLimitMessage,
  shopOnHandInsufficientMessage,
} from "@/lib/shop-profit-withdrawal-queries";
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

  const parsed = profitWithdrawalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const withdrawable = await getMemberProfitWithdrawable(userId, parsed.data.memberId);
  if (!withdrawable) {
    return NextResponse.json({ error: { message: "ไม่พบสมาชิก" } }, { status: 404 });
  }

  try {
    const transaction = await createProfitWithdrawal(
      userId,
      parsed.data,
      withdrawable.accumulatedShare,
    );
    return NextResponse.json({ data: transaction }, { status: 201 });
  } catch (err) {
    if (err instanceof ProfitWithdrawalLimitError) {
      return NextResponse.json(
        { error: { message: profitWithdrawalLimitMessage(err.maxAmount) } },
        { status: 400 },
      );
    }
    if (err instanceof ShopOnHandInsufficientError) {
      return NextResponse.json(
        { error: { message: shopOnHandInsufficientMessage(err.paymentMethod) } },
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

  const data = await listProfitWithdrawalsByMember(userId, memberId);
  return NextResponse.json({ data });
}
