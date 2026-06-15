import { NextRequest, NextResponse } from "next/server";
import { listProjectSummaries } from "@/lib/project-summary";
import { getUserId } from "@/lib/session";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const data = await listProjectSummaries(userId);
  return NextResponse.json({ data });
}
