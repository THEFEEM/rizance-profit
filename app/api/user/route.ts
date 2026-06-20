import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { findUserById, updateUserProfile } from "@/lib/queries";
import { fieldErrorsFrom, userPatchSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = userPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const patch: { shopName?: string; monthlyBudget?: string | null } = {};
  if (parsed.data.shopName !== undefined) {
    patch.shopName = parsed.data.shopName;
  }
  if (parsed.data.monthlyBudget !== undefined) {
    patch.monthlyBudget =
      parsed.data.monthlyBudget === null ? null : parsed.data.monthlyBudget.toFixed(2);
  }

  const user = await updateUserProfile(userId, patch);
  if (!user) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  return NextResponse.json({ data: { user } });
}

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
