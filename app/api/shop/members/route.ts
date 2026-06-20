import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/validation";
import { shopMemberSchema } from "@/lib/shop-validation";
import { createShopMember, listShopMembers } from "@/lib/shop-member-queries";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  const data = await listShopMembers(userId);
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = shopMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid input", fields: fieldErrorsFrom(parsed.error) } },
      { status: 400 },
    );
  }

  const member = await createShopMember(userId, parsed.data);
  if (!member) {
    return NextResponse.json({ error: { message: "Could not create member" } }, { status: 500 });
  }

  return NextResponse.json({ data: member }, { status: 201 });
}
