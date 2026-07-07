import { NextRequest, NextResponse } from "next/server";
import { getBoothCreditorOwed } from "@/lib/advance-creditors";
import {
  BoothOnHandInsufficientError,
  boothOnHandInsufficientMessage,
  createBoothCreditorRepayment,
} from "@/lib/booth-creditor-repayment-queries";
import { getBooth } from "@/lib/booth-queries";
import { creditorRepaymentSchema } from "@/lib/creditor-validation";
import {
  RepaymentExceedsOwedError,
  repaymentExceedsOwedMessage,
} from "@/lib/creditor-repayment-queries";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id: boothId } = await context.params;
  const booth = await getBooth(userId, boothId);
  if (!booth) {
    return NextResponse.json({ error: { message: "ไม่พบงานบูธนี้" } }, { status: 404 });
  }

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

  const owedAmount = await getBoothCreditorOwed(
    userId,
    boothId,
    parsed.data.payerKind,
    parsed.data.payerName,
  );
  if (!owedAmount) {
    return NextResponse.json({ error: { message: "ไม่พบเจ้าหนี้" } }, { status: 404 });
  }

  try {
    const repayment = await createBoothCreditorRepayment(
      userId,
      boothId,
      parsed.data,
      owedAmount,
    );
    return NextResponse.json({ data: repayment }, { status: 201 });
  } catch (err) {
    if (err instanceof RepaymentExceedsOwedError) {
      return NextResponse.json(
        { error: { message: repaymentExceedsOwedMessage(err.maxAmount) } },
        { status: 400 },
      );
    }
    if (err instanceof BoothOnHandInsufficientError) {
      return NextResponse.json(
        { error: { message: boothOnHandInsufficientMessage(err.paymentMethod, err.available) } },
        { status: 400 },
      );
    }
    throw err;
  }
}
