import { NextRequest, NextResponse } from "next/server";
import {
  getBoothChatMessage,
  isReceiptSplitCard,
  updateBoothChatMessageCardData,
} from "@/lib/booth-chat-queries";
import { getBooth } from "@/lib/booth-queries";
import { getCurrentUser } from "@/lib/session";

type RouteContext = { params: Promise<{ boothId: string; messageId: string }> };

export async function POST(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const { boothId, messageId } = await context.params;
  const booth = await getBooth(user.id, boothId);
  if (!booth) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const msg = await getBoothChatMessage(user.id, boothId, messageId);
  if (!msg || !isReceiptSplitCard(msg.cardData)) {
    return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }

  const card = msg.cardData;
  if (card.status !== "pending") {
    return NextResponse.json({ error: { message: "Invalid state" } }, { status: 400 });
  }

  await updateBoothChatMessageCardData(user.id, boothId, messageId, {
    ...card,
    status: "cancelled" as const,
  });

  return NextResponse.json({ data: { ok: true } });
}
