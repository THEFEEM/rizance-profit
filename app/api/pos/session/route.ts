import { NextRequest, NextResponse } from "next/server";
import {
  getPosSessionUser,
  isUserPosAllowed,
  posUnauthorizedResponse,
  requirePosSession,
} from "@/lib/pos-auth";

export async function GET(req: NextRequest) {
  const userId = await requirePosSession(req);
  if (userId instanceof NextResponse) return userId;

  const user = await getPosSessionUser(userId);
  if (!user) return posUnauthorizedResponse();

  const posAllowed = await isUserPosAllowed(userId);

  return NextResponse.json({
    data: {
      user,
      posAllowed,
    },
  });
}
