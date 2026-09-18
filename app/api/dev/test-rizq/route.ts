import { NextRequest, NextResponse } from "next/server";
import { parseUserMessage } from "@/lib/ai-chat";
import { today } from "@/lib/date";
import { isProduction } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { authRateLimitExceeded, clientIp } from "@/lib/rate-limit";

/**
 * A-3.SEC · SEC-1 — เดิม route นี้เป็น POST เปิดโล่ง ไม่มี auth · ไม่มี rate limit
 * · ไม่มี guard production และ middleware ไม่ครอบ /api/* (middleware.ts matcher)
 * ⇒ เป็น proxy สาธารณะไปยัง OPENAI_API_KEY
 *
 * ยังไม่ลบทิ้งเพราะ scripts/test-rizq-parse.mjs ใช้อยู่จริง (dev workflow)
 * จึงปิดด้วย 3 ชั้นตามสเปก: production 404 → ผู้ใช้จริงจาก DB → rate limit
 */
export async function POST(req: NextRequest) {
  // 1 · ไม่มีอยู่จริงบน production (404 ไม่ใช่ 403 — ไม่บอกใบ้ว่ามี route นี้)
  if (isProduction()) {
    return new NextResponse(null, { status: 404 });
  }

  // 2 · ต้องเป็นผู้ใช้ที่มีแถวจริงใน DB (getCurrentUser แตะ DB · getUserId ไม่แตะ)
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 3 · rate limit ด้วยกลไกเดิมของ repo
  const retryAfter = authRateLimitExceeded(`dev-rizq:${clientIp(req)}`);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const action = await parseUserMessage(text.trim(), today());
  return NextResponse.json({ action });
}
