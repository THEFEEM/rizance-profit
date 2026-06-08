import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { findUserById } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  return NextResponse.json({ data: { user } });
}
