import { NextRequest, NextResponse } from "next/server";
import { summarizeActivity } from "@/lib/project-summary";
import { getUserId } from "@/lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const { id, aid } = await params;
  const data = await summarizeActivity(userId, id, aid);
  if (!data) return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  return NextResponse.json({ data });
}
