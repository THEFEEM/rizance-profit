import { NextRequest, NextResponse } from "next/server";
import { getShopCreditorOwed } from "@/lib/advance-creditors";
import { creditorRepaymentSchema } from "@/lib/creditor-validation";
import {
  RepaymentExceedsOwedError,
  createCreditorRepayment,
  repaymentExceedsOwedMessage,
} from "@/lib/creditor-repayment-queries";
import {
  ShopOnHandInsufficientError,
  shopOnHandInsufficientMessage,
} from "@/lib/shop-profit-withdrawal-queries";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = creditorRepaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const owedAmount = await getShopCreditorOwed(
    userId,
    parsed.data.payerKind,
    parsed.data.payerName,
  );
  if (!owedAmount) {
    return NextResponse.json({ error: { message: "ไม่พบเจ้าหนี้" } }, { status: 404 });
  }

  try {
    const repayment = await createCreditorRepayment(userId, parsed.data, owedAmount);
    return NextResponse.json({ data: repayment }, { status: 201 });
  } catch (err) {
    if (err instanceof RepaymentExceedsOwedError) {
      return NextResponse.json(
        { error: { message: repaymentExceedsOwedMessage(err.maxAmount) } },
        { status: 400 },
      );
    }
    if (err instanceof ShopOnHandInsufficientError) {
      return NextResponse.json(
        { error: { message: shopOnHandInsufficientMessage(err.paymentMethod) } },
        { status: 400 },
      );
    }
    throw err;
  }
}
