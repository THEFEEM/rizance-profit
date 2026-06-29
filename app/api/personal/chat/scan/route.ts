import { NextRequest, NextResponse } from "next/server";
import { handlePersonalChatImage } from "@/lib/personal-chat-scan";
import { checkAndDeductTokens, resolveTokenScope } from "@/lib/token-budget";
import {
  getActiveSubscriptionPlan,
  tokenQuotaExceededResponse,
} from "@/lib/subscription-user";
import { getCurrentUser } from "@/lib/session";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const { imageBase64, mediaType, kind, slipType, thumbnail, caption } = body as {
    imageBase64?: unknown;
    mediaType?: unknown;
    kind?: unknown;
    slipType?: unknown;
    thumbnail?: unknown;
    caption?: unknown;
  };

  if (typeof imageBase64 !== "string" || imageBase64.trim() === "") {
    return NextResponse.json({ error: { message: "Invalid input" } }, { status: 400 });
  }

  const activePlan = await getActiveSubscriptionPlan(user.id);
  const scope = resolveTokenScope("personal", activePlan);
  const check = await checkAndDeductTokens(user.id, scope, "scan_slip");
  if (!check.allowed) {
    return tokenQuotaExceededResponse(check);
  }

  return handlePersonalChatImage(user.id, {
    imageBase64,
    mediaType,
    kind,
    slipType,
    thumbnail,
    caption,
  });
}
