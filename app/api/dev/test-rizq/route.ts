import { NextRequest, NextResponse } from "next/server";
import { parseUserMessage } from "@/lib/ai-chat";
import { today } from "@/lib/date";

export async function POST(req: NextRequest) {
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
